import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { WelcomePage } = await import('../src/ui/welcomePage');

let page: InstanceType<typeof WelcomePage>;
let receive: InstanceType<typeof vscode.EventEmitter<unknown>>;
let dispose: InstanceType<typeof vscode.EventEmitter<void>>;
let panel: any;
let values: Map<string, unknown>;
let update: ReturnType<typeof vi.fn>;
let globalState: any;

beforeEach(() => {
  values = new Map();
  update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => values.get(key) ?? fallback,
    inspect: (key: string) => ({ globalValue: values.get(key) }), update,
  } as any);
  receive = new vscode.EventEmitter();
  dispose = new vscode.EventEmitter();
  panel = {
    webview: { html: '', onDidReceiveMessage: receive.event, postMessage: vi.fn(async () => true) },
    reveal: vi.fn(), onDidDispose: dispose.event, dispose: () => dispose.fire(),
  };
  vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(panel);
  const saved = new Map();
  globalState = { get: (key: string) => saved.get(key), update: vi.fn(async (key: string, value: unknown) => { saved.set(key, value); }) };
  page = new WelcomePage(globalState);
});

afterEach(() => { page.dispose(); vi.restoreAllMocks(); vscode.workspace.workspaceFolders = undefined; });

test('Welcome and Settings opens one restricted, reusable configuration page', () => {
  page.show();
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith('searchPlusPlus.welcome', 'search++: Welcome & Settings', 1, { enableScripts: true, localResourceRoots: [] });
  expect(panel.webview.html).toContain('Arrange your search modes');
  expect(panel.webview.html).toContain("default-src 'none'");
  expect(panel.webview.html).toMatch(/script-src 'nonce-[a-f0-9]+'/);
  page.show();
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  expect(panel.reveal).toHaveBeenCalled();
});


test('the page loads current settings and saves a valid shortcut choice to user defaults', async () => {
  page.show(); receive.fire({ type: 'ready' });
  await new Promise(setImmediate);
  expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'state', scope: 'user', values: expect.objectContaining({ shortcutPreset: 'none', rememberLastMode: false }) }));
  receive.fire({ type: 'update', key: 'shortcutPreset', value: 'intellij' });
  await new Promise(setImmediate);
  expect(update).toHaveBeenCalledWith('shortcutPreset', 'intellij', vscode.ConfigurationTarget.Global);
});


test('workspace scope saves and resets settings only in the selected workspace', async () => {
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
  page.show(); receive.fire({ type: 'scope', scope: 'workspace' });
  receive.fire({ type: 'update', key: 'rememberLastMode', value: true });
  await new Promise(setImmediate);
  expect(update).toHaveBeenLastCalledWith('rememberLastMode', true, vscode.ConfigurationTarget.Workspace);
  receive.fire({ type: 'reset', key: 'rememberLastMode' });
  await new Promise(setImmediate);
  expect(update).toHaveBeenLastCalledWith('rememberLastMode', undefined, vscode.ConfigurationTarget.Workspace);
});


test('the shortcut action opens the filtered native keyboard editor', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  page.show(); receive.fire({ type: 'action', action: 'shortcuts' });
  await new Promise(setImmediate);
  expect(command).toHaveBeenCalledWith('workbench.action.openGlobalKeybindings', 'search++');
});


test('the welcome page appears once on first use and can be opted into on later startups', async () => {
  await page.showOnStartup();
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  panel.dispose();
  await page.showOnStartup();
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  values.set('showWelcomeOnStartup', true);
  await page.showOnStartup();
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
});

test('unsupported settings, invalid order values, and arbitrary commands cannot cause effects', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  page.show();
  receive.fire({ type: 'update', key: 'unknownSetting', value: true });
  receive.fire({ type: 'update', key: 'tabOrder', value: ['file', 'file'] });
  receive.fire({ type: 'update', key: 'everywhere.sections', value: ['unknown'] });
  receive.fire({ type: 'update', key: 'rememberLastMode', value: 'true' });
  receive.fire({ type: 'reset', key: '__proto__' });
  receive.fire({ type: 'action', action: 'workbench.action.closeWindow' });
  await new Promise(setImmediate);
  expect(update).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
  expect(panel.webview.postMessage.mock.calls.filter(([message]: any[]) => message.type === 'error')).toHaveLength(6);
});

test('an update failure is shown and does not prevent a later valid setting change', async () => {
  page.show(); update.mockRejectedValueOnce(new Error('Cannot save settings'));
  receive.fire({ type: 'update', key: 'rememberLastMode', value: true });
  await new Promise(setImmediate);
  expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Cannot save settings' });
  receive.fire({ type: 'update', key: 'rememberLastMode', value: false });
  await new Promise(setImmediate);
  expect(update).toHaveBeenLastCalledWith('rememberLastMode', false, vscode.ConfigurationTarget.Global);
});

test('workspace overrides are explained separately from user defaults', async () => {
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
  const inspect = (key: string) => key === 'rememberLastMode' ? { globalValue: false, workspaceValue: true } : undefined;
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (_key: string, fallback: unknown) => fallback, inspect, update } as any);
  page.show(); receive.fire({ type: 'ready' });
  await new Promise(setImmediate);
  expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ values: expect.objectContaining({ rememberLastMode: false }), overrides: ['rememberLastMode'] }));
  receive.fire({ type: 'scope', scope: 'workspace' });
  await new Promise(setImmediate);
  expect(panel.webview.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ values: expect.objectContaining({ rememberLastMode: true }), overrides: [] }));
});
