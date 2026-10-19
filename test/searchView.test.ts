import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchView } = await import('../src/ui/searchView');
const { SearchMode } = await import('../src/providers/types');
let view: InstanceType<typeof SearchView>;
let message: InstanceType<typeof vscode.EventEmitter<any>>;
let closed: InstanceType<typeof vscode.EventEmitter<void>>;
let panel: any;
let requests: Array<{ query: string; options: any; publish: (results: any[]) => void; dispose: ReturnType<typeof vi.fn> }>;
let states: any[];
let history: any;
beforeEach(() => {
  vi.useFakeTimers();
  message = new vscode.EventEmitter();
  closed = new vscode.EventEmitter();
  states = [];
  panel = { active: true, webview: { html: '', cspSource: 'vscode-webview:', asWebviewUri: (uri: any) => uri, onDidReceiveMessage: message.event, postMessage: (state: any) => { states.push(state); return Promise.resolve(true); } }, reveal: vi.fn(), onDidDispose: closed.event, onDidChangeViewState: () => ({ dispose() {} }), dispose: () => closed.fire() };
  vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(panel);
  requests = [];
  const provider = { search: (query: string, options: any, publish: (results: any[]) => void) => { const dispose = vi.fn(); requests.push({ query, options, publish, dispose }); return { dispose }; } };
  history = { getRecentItems: vi.fn(() => []), addOpened: vi.fn(), removeEntry: vi.fn() };
  view = new SearchView(vscode.Uri.file('/extension') as any, { state: 'ready', onDidChangeState: () => ({ dispose() {} }) } as any, history, new Map(Object.values(SearchMode).map(mode => [mode, provider])) as any);
});
afterEach(() => { vscode.window.activeTextEditor = undefined; view.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function show(mode = SearchMode.File) { const ready = view.show(mode); message.fire({ type: 'ready' }); await ready; }
function input(query: string, scope = '') { message.fire({ type: 'input', query, scope }); }

test('the two input values dispatch a scoped provider request', async () => {
  vscode.workspace.workspaceFolders = [{ name: 'workspace', index: 0, uri: vscode.Uri.file('/workspace') }];
  await show();
  input('index', 'src');
  expect(requests).toHaveLength(1);
  expect(requests[0].query).toBe('index');
  expect(requests[0].options.pathFilter(vscode.Uri.file('/workspace/src/index.ts'))).toBe(true);
  expect(requests[0].options.pathFilter(vscode.Uri.file('/workspace/test/index.ts'))).toBe(false);
});

test('clearing the query cancels the old request and ignores late results', async () => {
  await show();
  input('old');
  input('');
  requests[0].publish([{ label: 'obsolete', mode: SearchMode.File }]);
  expect(requests).toHaveLength(1);
  expect(requests[0].dispose).toHaveBeenCalled();
  expect(states.at(-1).results).toEqual([]);
});

test('invalid path regex cancels pending work and displays an error', async () => {
  await show();
  input('old');
  message.fire({ type: 'toggle', option: 'scopeRegex' });
  input('old', '[');
  expect(states.at(-1).error).toMatch(/regular expression|regex/i);
  expect(states.at(-1).results).toEqual([]);
  expect(requests[0].dispose).toHaveBeenCalled();
});

test('file:line:column opens the selected result at the requested position', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  await show();
  input('index.ts:42:5');
  requests[0].publish([{ label: 'index.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/index.ts') }]);
  message.fire({ type: 'open', id: states.at(-1).results[0].id });
  await vi.runAllTimersAsync();
  expect(open).toHaveBeenCalledWith(vscode.Uri.file('/workspace/index.ts'), expect.objectContaining({ selection: new vscode.Selection(new vscode.Position(41, 4), new vscode.Position(41, 4)) }));
});

test('switching modes retains both fields and debounces text searches', async () => {
  await show();
  input('token:42', 'src');
  message.fire({ type: 'mode', mode: SearchMode.Text });
  expect(requests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(requests[1].query).toBe('token:42');
  expect(states.at(-1)).toMatchObject({ mode: SearchMode.Text, query: 'token:42', scope: 'src' });
  input('');
  await vi.runAllTimersAsync();
  expect(requests.at(-1)?.query).toBe('token:42');
});

test('finding usages from a symbol captures its location and preserves the path scope', async () => {
  await show(SearchMode.Symbol);
  input('greet', 'src');
  await vi.runAllTimersAsync();
  const uri = vscode.Uri.file('/workspace/src/a.ts');
  requests[0].publish([{ label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri, lineNumber: 2, column: 9 }]);
  message.fire({ type: 'usages', id: states.at(-1).results[0].id });
  await vi.runAllTimersAsync();
  expect(requests.at(-1)?.options.usageTarget).toMatchObject({ uri, position: new vscode.Position(2, 9), name: 'greet' });
  expect(requests.at(-1)?.query).toBe('');
  expect(states.at(-1)).toMatchObject({ mode: SearchMode.Usages, scope: 'src', usageName: 'greet' });
});

test('result actions from a previous query and arbitrary URI messages are ignored', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  await show(); input('old');
  requests[0].publish([{ label: 'old.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/old.ts') }]);
  const id = states.at(-1).results[0].id;
  input('new');
  message.fire({ type: 'open', id });
  message.fire({ type: 'open', id: '/arbitrary.ts', uri: 'file:///arbitrary.ts' });
  await vi.runAllTimersAsync();
  expect(open).not.toHaveBeenCalled();
});

test('absolute path lookup respects scope and cannot replace a newer request', async () => {
  let finish!: (stat: { type: number }) => void;
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await show(); input('/workspace/src/old.ts');
  expect(vscode.workspace.fs.stat).toHaveBeenCalled();
  input('new');
  requests[0].publish([{ label: 'new.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/new.ts') }]);
  finish({ type: vscode.FileType.File }); await vi.runAllTimersAsync();
  expect(states.at(-1).results.map((result: any) => result.label)).toEqual(['new.ts']);
});

test('the view loads local assets with a restrictive content security policy', async () => {
  await show();
  expect(panel.webview.html).toContain("default-src 'none'");
  expect(panel.webview.html).toContain('nonce-');
  expect(panel.webview.html).toContain('dist/webview/search.js');
  expect(panel.webview.html).not.toContain('unsafe-inline');
});

test('mode shortcuts are scoped to the active view and cleared on close', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  await show();
  expect(command).toHaveBeenCalledWith('setContext', 'searchPlusPlusModalOpen', true);
  view.nextTab();
  expect(states.at(-1).mode).toBe(SearchMode.Folder);
  view.prevTab();
  expect(states.at(-1).mode).toBe(SearchMode.File);
  view.dispose();
  expect(command).toHaveBeenCalledWith('setContext', 'searchPlusPlusModalOpen', false);
});

test('autofill keeps the selected resource path and lets the user append a line', async () => {
  await show(); input('index');
  requests[0].publish([{ label: 'index.ts', description: 'src/index.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/src/index.ts') }]);
  vi.spyOn(vscode.workspace, 'asRelativePath').mockReturnValue('src/index.ts');
  message.fire({ type: 'select', id: states.at(-1).results[0].id });
  view.autofillSelectedPath();
  expect(states.at(-1).query).toBe('src/index.ts:');
  expect(requests.at(-1)?.query).toBe('src/index.ts');
});

test('Everything keeps section labels and resource icons without interpreting filenames as markup', async () => {
  await show(SearchMode.Everywhere); input('file');
  requests[0].publish([{ label: '$(odd) file.ts', mode: SearchMode.File, belongsToSection: 'files', uri: vscode.Uri.file('/workspace/file.ts') }, { label: '$(symbol-function) file', mode: SearchMode.Symbol, belongsToSection: 'symbols', uri: vscode.Uri.file('/workspace/source.ts') }]);
  expect(states.at(-1).results).toMatchObject([{ label: '$(odd) file.ts', section: 'files', icon: 'file' }, { label: 'file', section: 'symbols', icon: 'symbol-function' }]);
});

test('Find Usages from an editor reveals an existing inactive search view', async () => {
  await show(); panel.active = false;
  vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file('/workspace/source.ts'), getWordRangeAtPosition: () => new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)), getText: () => 'greet' }, selection: { active: new vscode.Position(0, 2) } } as any;
  await view.findUsages();
  expect(panel.reveal).toHaveBeenCalled();
  expect(states.at(-1).usageName).toBe('greet');
});

test('shortcuts stop intercepting keys when focus leaves the search webview', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  await show(); command.mockClear();
  message.fire({ type: 'focus', focused: false });
  expect(command).toHaveBeenCalledWith('setContext', 'searchPlusPlusModalOpen', false);
  message.fire({ type: 'focus', focused: true });
  expect(command).toHaveBeenLastCalledWith('setContext', 'searchPlusPlusEverythingTab', false);
  expect(command).toHaveBeenCalledWith('setContext', 'searchPlusPlusModalOpen', true);
});

test('clearing a line-suffixed query resets navigation before opening recent files', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  await show(); input('index.ts:42:5');
  history.getRecentItems.mockReturnValue([{ label: '$(history) other.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/other.ts') }]);
  input('');
  message.fire({ type: 'open', id: states.at(-1).results[0].id });
  await vi.runAllTimersAsync();
  expect(open).toHaveBeenCalledWith(vscode.Uri.file('/workspace/other.ts'), expect.objectContaining({ selection: undefined }));
});

test('clearing input cancels a text search still waiting for its debounce', async () => {
  await show(SearchMode.Text);
  input('pending'); input('');
  await vi.runAllTimersAsync();
  expect(requests).toEqual([]);
  expect(states.at(-1).results).toEqual([]);
});
