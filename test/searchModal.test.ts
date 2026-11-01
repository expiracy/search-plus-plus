import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchModal } = await import('../src/ui/searchModal');
const { SearchMode } = await import('../src/providers/types');

let modal: InstanceType<typeof SearchModal>;
let picker: ReturnType<typeof vscode.window.createQuickPick>;
let input: InstanceType<typeof vscode.EventEmitter<string>>;
let accept: InstanceType<typeof vscode.EventEmitter<void>>;
let activeChanged: InstanceType<typeof vscode.EventEmitter<any>>;
let state: InstanceType<typeof vscode.EventEmitter<string>>;
let itemButton: InstanceType<typeof vscode.EventEmitter<any>>;
let button: InstanceType<typeof vscode.EventEmitter<any>>;
let configurationChanged: InstanceType<typeof vscode.EventEmitter<any>>;
let hide: InstanceType<typeof vscode.EventEmitter<void>>;
let workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let history: { getRecentItems: () => any[]; addOpened: ReturnType<typeof vi.fn> };
let requests: Array<{ mode: string; query: string; options: any; publish: (results: any[]) => void; dispose: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.useFakeTimers();
  input = new vscode.EventEmitter();
  accept = new vscode.EventEmitter();
  activeChanged = new vscode.EventEmitter();
  state = new vscode.EventEmitter();
  hide = new vscode.EventEmitter();
  itemButton = new vscode.EventEmitter();
  button = new vscode.EventEmitter();
  configurationChanged = new vscode.EventEmitter();
  vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(listener => configurationChanged.event(listener));
  picker = {
    ...vscode.window.createQuickPick(),
    onDidChangeValue: input.event,
    onDidAccept: accept.event,
    onDidChangeActive: activeChanged.event,
    onDidHide: hide.event,
    onDidTriggerItemButton: itemButton.event,
    onDidTriggerButton: button.event,
    hide: () => hide.fire(),
  };
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  const manager = {
    state: 'ready', fileIndex: {}, textSearch: {}, gitIgnore: {}, onDidChangeState: state.event,
  };
  requests = [];
  const provider = (mode: string) => ({
    search: (query: string, options: any, publish: (results: any[]) => void) => {
      const dispose = vi.fn();
      requests.push({ mode, query, options, publish, dispose });
      return { dispose };
    },
  });
  const saved = new Map<string, unknown>();
  workspaceState = { get: vi.fn((key: string) => saved.get(key)), update: vi.fn(async (key: string, value: unknown) => { saved.set(key, value); }) };
  history = { getRecentItems: () => [], addOpened: vi.fn() };
  modal = new SearchModal(manager as any, history as any,
    new Map(Object.values(SearchMode).map(mode => [mode, provider(mode)])) as any, undefined, workspaceState as any);
});

afterEach(() => {
  vscode.window.activeTextEditor = undefined;
  picker.hide();
  modal.dispose();
  configurationChanged.dispose();
  activeChanged.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function type(value: string) {
  picker.value = value;
  input.fire(value);
}

function configureSearch(settings: Record<string, unknown>) {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
}

function reopen(mode?: typeof SearchMode[keyof typeof SearchMode]) {
  picker = { ...picker, value: '', items: [], activeItems: [], selectedItems: [], busy: false };
  vi.mocked(vscode.window.createQuickPick).mockReturnValue(picker);
  modal.show(mode);
}

test('Remember Last Search restores the accepted query and tab with fresh results and selection', async () => {
  configureSearch({ rememberLastSearch: true });
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  const showDocument = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.File); type('checkout:42:5');
  const first = { label: 'checkout.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/checkout.ts') };
  const chosen = { label: 'checkout.test.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/checkout.test.ts') };
  requests[0].publish([first, chosen]);
  picker.activeItems = [picker.items[1]] as any;
  picker.selectedItems = [picker.items[1]] as any;
  accept.fire();
  await vi.runAllTimersAsync();
  expect(open).toHaveBeenCalledWith('vscode.open', chosen.uri);
  expect(workspaceState.update).not.toHaveBeenCalled();

  reopen();
  expect(picker.value).toBe('checkout:42:5');
  expect(picker.placeholder).toContain('Search files...');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.File, query: 'checkout' });
  const refreshed = { ...chosen, label: 'updated checkout.test.ts' };
  requests.at(-1)!.publish([first, refreshed]);
  expect(picker.items).toHaveLength(2);
  expect(picker.activeItems[0]).toMatchObject(refreshed);
  picker.selectedItems = [picker.activeItems[0]] as any;
  accept.fire(); await vi.runAllTimersAsync();
  expect(showDocument).toHaveBeenCalledWith(chosen.uri, {
    selection: new vscode.Selection(new vscode.Position(41, 4), new vscode.Position(41, 4)),
  });
});

test('clearing the last query returns to the configured opening tab instead of an older search', () => {
  configureSearch({ rememberLastSearch: true, whenSearchOpens: 'text' });
  modal.show(SearchMode.File); type('checkout'); picker.hide();
  reopen();
  type(''); picker.hide();
  reopen();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toBe('Search text content...');
});

test('turning Remember Last Search off while closed forgets the query even if re-enabled', () => {
  const settings = { rememberLastSearch: true };
  configureSearch(settings);
  modal.show(SearchMode.File); type('private-query'); picker.hide();
  settings.rememberLastSearch = false;
  configurationChanged.fire({ affectsConfiguration: (key: string) => key === 'searchPlusPlus.rememberLastSearch' });
  settings.rememberLastSearch = true;
  configurationChanged.fire({ affectsConfiguration: (key: string) => key === 'searchPlusPlus.rememberLastSearch' });
  reopen();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toBe('Search everywhere...');
});

test('reopening a usages lookup restores its filter, semantic target and Back navigation', async () => {
  configureSearch({ rememberLastSearch: true });
  modal.show(SearchMode.Symbol); type('gre'); await vi.runAllTimersAsync();
  const symbol = { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 2, column: 4 };
  requests[0].publish([symbol]); picker.activeItems = [picker.items[0]] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('consumer'); await vi.runAllTimersAsync();
  const reference = { label: 'greet();', mode: SearchMode.Usages, uri: vscode.Uri.file('/workspace/consumer.ts'), lineNumber: 7, column: 3 };
  requests.at(-1)!.publish([reference]);
  picker.activeItems = [picker.items[0]] as any;
  picker.selectedItems = [picker.items[0]] as any;
  accept.fire(); await vi.runAllTimersAsync();

  reopen(); await vi.runAllTimersAsync();
  expect(picker.value).toBe('consumer');
  expect(picker.buttons).toContain(vscode.QuickInputButtons.Back);
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Usages, query: 'consumer',
    options: { usageTarget: { uri: symbol.uri, name: 'greet', position: new vscode.Position(2, 4) } },
  });
  requests.at(-1)!.publish([{ ...reference }]);
  expect(picker.activeItems[0]).toMatchObject(reference);
  button.fire(vscode.QuickInputButtons.Back);
  expect(picker.value).toBe('gre');
  expect(picker.items[0]).toMatchObject(symbol);
  expect(picker.activeItems[0]).toMatchObject(symbol);
});

test('Remember Last Search is off by default even when Last used tab is enabled', () => {
  configureSearch({ whenSearchOpens: 'last' });
  modal.show(SearchMode.File); type('checkout'); picker.hide();
  reopen();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toContain('Search files...');
  expect(requests).toHaveLength(1);
});

test('direct commands restore a matching last search but open a different requested mode with an empty query', () => {
  configureSearch({ rememberLastSearch: true });
  modal.show(SearchMode.File); type('checkout'); picker.hide();
  reopen(SearchMode.File);
  expect(picker.value).toBe('checkout');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.File, query: 'checkout' });
  picker.hide();
  reopen(SearchMode.Text);
  expect(picker.value).toBe('');
  expect(picker.placeholder).toBe('Search text content...');
});

test('a hidden remembered tab falls back to the opening tab without restoring its query', () => {
  const settings: Record<string, unknown> = { rememberLastSearch: true };
  configureSearch(settings);
  modal.show(SearchMode.Symbol); type('greet'); picker.hide();
  settings.everythingTabSources = { Symbols: false };
  reopen();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toBe('Search everywhere...');
});

test('reopening after dismissal preserves text whitespace and search options', async () => {
  configureSearch({ rememberLastSearch: true });
  modal.show(SearchMode.Text); type('  price  ');
  modal.toggleCaseSensitive(); modal.toggleGitIgnore();
  await vi.runAllTimersAsync();
  picker.hide();
  reopen(); await vi.runAllTimersAsync();
  expect(picker.value).toBe('  price  ');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Text, query: '  price  ',
    options: { caseSensitive: true, excludeGitIgnored: false },
  });
});

test('reopened streaming results restore a later symbol without accepting old callbacks or overriding a later selection', () => {
  configureSearch({ rememberLastSearch: true });
  modal.show(); type('greet');
  const file = { label: 'greet.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/greet.ts') };
  const symbol = { ...file, label: 'greet', mode: SearchMode.Symbol };
  requests[0].publish([file, symbol]); picker.activeItems = [picker.items[1]] as any;
  picker.hide(); reopen();
  requests[0].publish([{ ...file, label: 'obsolete result' }]);
  expect(picker.items).toEqual([]);
  requests.at(-1)!.publish([file]);
  picker.activeItems = [picker.items[0]] as any;
  requests.at(-1)!.publish([file, { ...symbol }]);
  expect(picker.activeItems[0]).toMatchObject(symbol);
  picker.activeItems = [picker.items[0]] as any; activeChanged.fire(picker.activeItems);
  requests.at(-1)!.publish([{ ...file }, { ...symbol }]);
  expect(picker.activeItems[0]).toMatchObject(file);
});

test('symbol selection enables drilldown in Everything and clears on another row or hide', () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.Everywhere); type('greet');
  const symbol = { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  const file = { label: 'greet.ts', mode: SearchMode.File, uri: symbol.uri };
  requests[0].publish([symbol, file]);
  picker.activeItems = [symbol] as any; activeChanged.fire([symbol]);
  expect(command).toHaveBeenLastCalledWith('setContext', 'searchPlusPlusSymbolSelected', true);
  picker.activeItems = [file] as any; activeChanged.fire([file]);
  expect(command).toHaveBeenLastCalledWith('setContext', 'searchPlusPlusSymbolSelected', false);
  picker.activeItems = [symbol] as any; activeChanged.fire([symbol]);
  command.mockClear(); picker.hide();
  expect(command).toHaveBeenCalledWith('setContext', 'searchPlusPlusSymbolSelected', false);
  const count = command.mock.calls.length;
  activeChanged.fire([symbol]);
  expect(command.mock.calls).toHaveLength(count);
});

test('the settings cog at the end of the input row closes search and opens VS Code Settings directly', () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const hidden = vi.spyOn(picker, 'hide');
  modal.show(SearchMode.File);
  type('file');
  const settings = picker.buttons.find((item: any) => item.tooltip === 'Open search++ Settings') as any;
  expect(settings).toMatchObject({
    iconPath: { id: 'gear' },
    tooltip: 'Open search++ Settings',
    location: vscode.QuickInputButtonLocation.Inline,
  });
  expect(picker.buttons.at(-1)).toBe(settings);
  expect(settings.toggle).toBeUndefined();
  expect(command).not.toHaveBeenCalledWith('workbench.action.openSettings', '@ext:expiracy.search-plus-plus');
  button.fire(settings);
  expect(hidden).toHaveBeenCalledOnce();
  expect(requests[0].dispose).toHaveBeenCalledOnce();
  expect(command).toHaveBeenCalledWith('workbench.action.openSettings', '@ext:expiracy.search-plus-plus');
});

test('saved ignore-rule defaults apply immediately without restarting the extension', () => {
  const settings: Record<string, unknown> = { gitIgnoreRules: false, searchIgnoreRules: false };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  configurationChanged.fire({ affectsConfiguration: (name: string) => ['searchPlusPlus.gitIgnoreRules', 'searchPlusPlus.searchIgnoreRules'].includes(name) });
  modal.show(SearchMode.File); type('rules');
  expect(requests[0].options).toMatchObject({ excludeGitIgnored: false, excludeSearchIgnored: false });
  settings.gitIgnoreRules = true;
  configurationChanged.fire({ affectsConfiguration: (name: string) => name === 'searchPlusPlus.gitIgnoreRules' });
  expect(requests.at(-1)?.options).toMatchObject({ excludeGitIgnored: true, excludeSearchIgnored: false });
});

test('macOS search controls and empty-result hints show Option shortcuts', () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  modal.show(SearchMode.File);
  expect(picker.buttons.slice(6, -1).map((item: any) => item.tooltip)).toEqual([
    'Exclude Git Ignored (Option+G)',
    'Exclude Search Ignored (Option+S)',
    'Case Sensitive (Option+C)',
    'Regex (Option+R)',
    'Match Whole Word (Option+W)',
    'Fuzzy Search (Option+F)',
  ]);
  type('missing');
  requests[0].publish([]);
  expect(picker.items[0].description).toContain('gitignore (Option+G), search-ignore (Option+S)');
});

test('Windows search controls and empty-result hints show Alt shortcuts', () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
  modal.show(SearchMode.File);
  expect(picker.buttons.slice(6, -1).map((item: any) => item.tooltip)).toEqual([
    'Exclude Git Ignored (Alt+G)',
    'Exclude Search Ignored (Alt+S)',
    'Case Sensitive (Alt+C)',
    'Regex (Alt+R)',
    'Match Whole Word (Alt+W)',
    'Fuzzy Search (Alt+F)',
  ]);
  type('missing');
  requests[0].publish([]);
  expect(picker.items[0].description).toContain('gitignore (Alt+G), search-ignore (Alt+S)');
});

test.each([
  ['darwin', 'Return', 'Cmd+Return'],
  ['win32', 'Enter', 'Ctrl+Enter'],
  ['linux', 'Enter', 'Ctrl+Enter'],
])('%s symbol hints match the platform, with Right Arrow for preview', async (platform, enter, usages) => {
  vi.stubGlobal('process', { ...process, platform });
  modal.show(SearchMode.Symbol);
  expect(picker.placeholder).toBe(`Search symbols... (${enter} to open, ${usages} for usages)`);
  type('greet'); await vi.runAllTimersAsync();
  requests[0].publish([{label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts')}]);
  expect((picker.items[0] as any).buttons.map((button: any) => button.tooltip)).toEqual([
    `Find Usages (${usages} or Shift+F12)`, `Go to Symbol (${enter})`, 'Preview (Right Arrow)',
  ]);
});

test('the modal dispatches through the supplied search providers', () => {
  modal.show(SearchMode.File);
  type('file');
  expect(requests.map(r => r.query)).toEqual(['file']);
});

test('clearing input invalidates callbacks from the previous request', () => {
  modal.show(SearchMode.File);
  type('old');
  type('');
  requests[0].publish([{ label: 'obsolete', mode: SearchMode.File }]);
  expect(picker.items).toEqual([]);
});

test('clearing input cancels a search that is still waiting for the debounce delay', () => {
  modal.show(SearchMode.Text);
  type('pending');
  type('');
  vi.runAllTimers();
  expect(requests).toEqual([]);
  expect(picker.items).toEqual([]);
});

test('accepting file:line:column retains the target after the picker hides', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.File);
  type('file.ts:42:5');
  const result = { label: 'file.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/file.ts') };
  requests[0].publish([result]);
  picker.selectedItems = [result] as any;
  accept.fire();
  await vi.runAllTimersAsync();
  expect(open).toHaveBeenCalledWith(result.uri, {
    selection: new vscode.Selection(new vscode.Position(41, 4), new vscode.Position(41, 4)),
  });
});

test('accepting a text result reveals the matching line at the top of the editor', async () => {
  const revealRange = vi.fn();
  vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({ revealRange } as any);
  modal.show(SearchMode.Text); type('needle'); await vi.runAllTimersAsync();
  const result = { label: 'needle', mode: SearchMode.Text, uri: vscode.Uri.file('/workspace/a.ts'), lineNumber: 100, column: 3 };
  requests[0].publish([result]); picker.selectedItems = [result] as any;
  accept.fire(); await vi.runAllTimersAsync();
  const position = new vscode.Position(100, 3);
  expect(revealRange).toHaveBeenCalledWith(new vscode.Selection(position, position), vscode.TextEditorRevealType.AtTop);
});

test('absolute file results show the parent folder and retain their navigation target', async () => {
  vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({ type: vscode.FileType.File } as any);
  modal.show(SearchMode.File);
  type('/workspace/src/file.ts');
  await vi.runAllTimersAsync();
  expect(picker.items).toMatchObject([{
    label: 'file.ts', description: '/workspace/src',
    uri: vscode.Uri.file('/workspace/src/file.ts'),
    resourceUri: vscode.Uri.file('/workspace/src/file.ts'),
  }]);
});

test('an absolute drive root keeps a visible name', async () => {
  vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({ type: vscode.FileType.Directory } as any);
  modal.show(SearchMode.File);
  type('C:\\');
  await vi.runAllTimersAsync();
  expect(picker.items).toMatchObject([{ label: 'C:\\', iconPath: vscode.ThemeIcon.Folder, isFolder: true }]);
});

test('a late absolute path lookup cannot replace a newer query', async () => {
  let finish!: (stat: { type: number }) => void;
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  modal.show(SearchMode.File);
  type('/workspace/old.ts');
  type('new');
  requests[0].publish([{ label: 'new.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/new.ts') }]);
  finish({ type: vscode.FileType.File });
  await vi.runAllTimersAsync();
  expect(picker.items.map((item: any) => item.label)).toEqual(['new.ts']);
});

test('a missing absolute path shows its warning without counting it as a file', async () => {
  vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('File not found'));
  modal.show(SearchMode.File);
  type('/workspace/missing.ts');
  await vi.runAllTimersAsync();
  expect(picker.items).toMatchObject([{ label: '$(warning) Path not found', description: '/workspace/missing.ts' }]);
  expect(picker.items[0].buttons).toBeUndefined();
  expect(picker.title).toBe('Files: 0 results');
  expect(picker.busy).toBe(false);
});

test('Shift+F12 on a selected symbol opens its semantic usages in the popup', async () => {
  modal.show(SearchMode.Symbol); type('greet');
  await vi.runAllTimersAsync();
  const uri = vscode.Uri.file('/workspace/definition.ts');
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri, lineNumber: 2, column: 9 };
  requests[0].publish([symbol]);
  picker.activeItems = [symbol] as any;
  modal.findUsages();
  await vi.runAllTimersAsync();
  expect(requests.at(-1)?.query).toBe('');
  expect(requests.at(-1)?.options.usageTarget).toMatchObject({ uri, position: new vscode.Position(2, 9), name: 'greet' });
  const reference = { label: 'greet();', mode: SearchMode.Usages, uri: vscode.Uri.file('/workspace/consumer.ts'), lineNumber: 7, column: 3 };
  requests.at(-1)!.publish([reference]);
  expect(picker.items).toMatchObject([reference]);
  expect(picker.title).toContain('greet');
});

test('legacy Usages entry points open Symbols and Enter opens the declaration', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.Usages); type('greet');
  await vi.runAllTimersAsync();
  expect(picker.placeholder).toContain('symbol');
  expect(requests[0].mode).toBe(SearchMode.Symbol);
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]);
  picker.selectedItems = [symbol] as any;
  accept.fire();
  await vi.runAllTimersAsync();
  expect(command).toHaveBeenCalledWith('vscode.open', symbol.uri);
  expect(requests.every(request => request.mode === SearchMode.Symbol)).toBe(true);
});

test('clicking Symbols while viewing usages restores its original query and results', async () => {
  modal.show(SearchMode.Symbol); type('greet');
  await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('consumer.ts'); await vi.runAllTimersAsync();
  button.fire(picker.buttons.find((item: any) => item.tooltip === 'Symbols'));
  await vi.runAllTimersAsync();
  expect(picker.value).toBe('greet');
  expect(picker.items).toMatchObject([symbol]);
  expect(picker.title).toBe('Symbols: 1 symbols');
});

test('Find Usages from the editor opens the popup for the exact cursor position', async () => {
  const uri = vscode.Uri.file('/workspace/editor.ts');
  vscode.window.activeTextEditor = { document: { uri, getWordRangeAtPosition: () => ({}), getText: () => 'greet' }, selection: { active: new vscode.Position(5, 8) } } as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  expect(picker.title).toContain('Usages of greet');
  expect(requests.at(-1)?.options.usageTarget).toMatchObject({ uri, position: new vscode.Position(5, 8), name: 'greet' });
  vscode.window.activeTextEditor = undefined;
});

test('a symbol result button finds usages without opening the declaration', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  requests[0].publish([{ label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 }]);
  const item: any = picker.items[0];
  const action = item.buttons.find((button: any) => button.tooltip.includes('Find Usages'));
  expect(action).toBeTruthy();
  expect(action.tooltip).toBe(`Find Usages (${process.platform === 'darwin' ? 'Cmd+Return' : 'Ctrl+Enter'} or Shift+F12)`);
  itemButton.fire({ item, button: action }); await vi.runAllTimersAsync();
  expect(requests.at(-1)?.options.usageTarget?.name).toBe('greet');
  expect(open).not.toHaveBeenCalled();
});

test('Go to Symbol opens its declaration in the current group with one operation', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const uri = vscode.Uri.file('/workspace/greet.ts');
  requests[0].publish([{ label: 'greet', mode: SearchMode.Symbol, uri, lineNumber: 12, column: 9 }]);
  const item: any = picker.items[0];
  const action = item.buttons.find((button: any) => button.iconPath.id === 'go-to-file');
  expect(action?.iconPath.id).toBe('go-to-file');
  itemButton.fire({ item, button: action });
  await vi.runAllTimersAsync();
  const position = new vscode.Position(12, 9);
  expect(command.mock.calls.filter(call => call[0] === 'vscode.open')).toEqual([
    ['vscode.open', uri, { selection: new vscode.Selection(position, position) }],
  ]);
  expect(open).not.toHaveBeenCalled();
});

test('Go to File reveals a text match at the top of the opened editor', async () => {
  const uri = vscode.Uri.file('/workspace/a.ts');
  const revealRange = vi.fn();
  vscode.window.activeTextEditor = { document: { uri }, revealRange } as any;
  modal.show(SearchMode.Text); type('needle'); await vi.runAllTimersAsync();
  requests[0].publish([{ label: 'needle', mode: SearchMode.Text, uri, lineNumber: 100, column: 3 }]);
  const item: any = picker.items[0];
  const goToFile = item.buttons.find((button: any) => button.iconPath.id === 'go-to-file');
  expect(goToFile).toBeDefined();
  itemButton.fire({ item, button: goToFile });
  await vi.runAllTimersAsync();
  const position = new vscode.Position(100, 3);
  expect(revealRange).toHaveBeenCalledWith(new vscode.Selection(position, position), vscode.TextEditorRevealType.AtTop);
});

test('Go to File retains the typed line and column after hiding', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('greet.ts:42:5');
  const uri = vscode.Uri.file('/workspace/greet.ts');
  requests[0].publish([{ label: 'greet.ts', mode: SearchMode.File, uri }]);
  const item: any = picker.items[0];
  itemButton.fire({ item, button: item.buttons[0] });
  await vi.runAllTimersAsync();
  const position = new vscode.Position(41, 4);
  expect(command).toHaveBeenCalledWith('vscode.open', uri, expect.objectContaining({ selection: new vscode.Selection(position, position) }));
});

test('Go to File records the confirmed file and location in history', async () => {
  modal.show(SearchMode.File); type('greet.ts:42:5');
  const uri = vscode.Uri.file('/workspace/greet.ts');
  requests[0].publish([{ label: 'greet.ts', mode: SearchMode.File, uri }]);
  const item: any = picker.items[0];
  itemButton.fire({ item, button: item.buttons[0] });
  await vi.runAllTimersAsync();
  expect(history.addOpened).toHaveBeenCalledExactlyOnceWith(uri, 41, 4);
});

test('Back restores the previous query, results and selection without restarting the search', async () => {
  modal.show(SearchMode.Symbol); type('gre'); await vi.runAllTimersAsync();
  requests[0].publish([
    { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') },
    { label: 'greetVisitor', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/visitor.ts') },
  ]);
  const originalItems = [...picker.items];
  picker.activeItems = [originalItems[1]] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('consumer.ts'); await vi.runAllTimersAsync();
  const references = requests.at(-1)!;
  const requestCount = requests.length;
  const back = picker.buttons.find(item => item === vscode.QuickInputButtons.Back);
  expect(back).toBeDefined();
  button.fire(back);
  input.fire(picker.value); // Native QuickPick reports a programmatic value change asynchronously.
  await vi.runAllTimersAsync();
  expect(picker.value).toBe('gre');
  expect(picker.items).toEqual(originalItems);
  expect(picker.activeItems).toEqual([originalItems[1]]);
  expect(picker.title).toBe('Symbols: 2 symbols');
  expect(picker.buttons).not.toContain(vscode.QuickInputButtons.Back);
  expect(references.dispose).toHaveBeenCalled();
  references.publish([{ label: 'obsolete reference', mode: SearchMode.Usages }]);
  expect(picker.items).toEqual(originalItems);
  expect(requests).toHaveLength(requestCount);
});

test('Back restores the parent search options along with its cached results', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [picker.items[0]] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  modal.toggleCaseSensitive(); await vi.runAllTimersAsync();
  button.fire(vscode.QuickInputButtons.Back);
  expect((picker.buttons.find((item: any) => item.iconPath.id === 'case-sensitive') as any).toggle.checked).toBe(false);
});

test('Back from an Everything symbol restores its sections and selected result', async () => {
  modal.show(SearchMode.Everywhere); type('gre');
  requests[0].publish([
    { label: 'greet', mode: SearchMode.Symbol, belongsToSection: 'symbols', uri: vscode.Uri.file('/workspace/greet.ts') },
    { label: 'greet();', mode: SearchMode.Text, belongsToSection: 'text', uri: vscode.Uri.file('/workspace/use.ts') },
  ]);
  const originalItems = [...picker.items];
  const symbol = originalItems.find((item: any) => item.mode === SearchMode.Symbol)!;
  picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  button.fire(vscode.QuickInputButtons.Back);
  input.fire(picker.value); await vi.runAllTimersAsync();
  expect(picker.value).toBe('gre');
  expect(picker.placeholder).toBe('Search everywhere...');
  expect(picker.items).toEqual(originalItems);
  expect(picker.activeItems).toEqual([symbol]);
});

test('empty Symbols explains how to open a declaration or find usages', () => {
  modal.show(SearchMode.Symbol);
  expect(picker.items).toMatchObject([{ label: '$(symbol-method) Search for a symbol', mode: SearchMode.Symbol,
    description: expect.stringContaining(`${process.platform === 'darwin' ? 'Cmd+Return' : 'Ctrl+Enter'} or Shift+F12`) }]);
});

test('empty reference results distinguish semantic coverage from an ordinary search miss', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  requests.at(-1)!.publish([]);
  expect(picker.items).toMatchObject([{ label: '$(references) No references reported', description: expect.stringContaining('language') }]);
  expect(picker.title).toContain('greet');
});

test('a nonmatching usages filter explains how to recover without blaming language support', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('missing-consumer.ts'); await vi.runAllTimersAsync();
  requests.at(-1)!.publish([]);
  expect(picker.items).toMatchObject([{
    label: '$(references) No usages match this filter',
    description: expect.stringContaining('clear the box to choose another symbol'),
  }]);
  expect(picker.placeholder).toContain('greet');
  type('greet'); await vi.runAllTimersAsync();
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Usages, query: '', options: { usageTarget: { name: 'greet' } } });
});

test('accepting a usage opens its reference position and cancels pending callbacks', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  const reference = { label: 'greet();', mode: SearchMode.Usages, uri: vscode.Uri.file('/workspace/consumer.ts'), lineNumber: 7, column: 3, alwaysShow: true };
  requests.at(-1)!.publish([reference]); picker.selectedItems = [reference] as any;
  accept.fire(); await vi.runAllTimersAsync();
  expect(open).toHaveBeenCalledWith(reference.uri, { selection: new vscode.Selection(new vscode.Position(7, 3), new vscode.Position(7, 3)) });
  expect(requests.at(-1)!.dispose).toHaveBeenCalled();
});

test('typing a new symbol query cannot accept results from the previous query', async () => {
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.Symbol); type('old'); await vi.runAllTimersAsync();
  const old = { label: '$(symbol-function) old', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/old.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([old]); picker.selectedItems = [old] as any;
  type('new'); accept.fire(); await vi.runAllTimersAsync();
  expect(open).not.toHaveBeenCalled();
  expect(picker.items).not.toMatchObject([old]);
});

test('closing the popup forgets its reference target before a new symbol search', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync(); picker.hide();
  modal.show(SearchMode.Usages); type('otherSymbol'); await vi.runAllTimersAsync();
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'otherSymbol' });
  expect(requests.at(-1)?.options.usageTarget).toBeUndefined();
});

test('all six mode icons stay in place through loading, usages, and mode changes', async () => {
  const modes = ['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Commands'];
  const checkModes = () => {
    const buttons = picker.buttons.filter((item: any) => modes.includes(item.tooltip));
    expect(buttons.map((item: any) => item.tooltip)).toEqual(modes);
    expect(buttons.map((item: any) => item.iconPath.id)).toEqual(['search', 'file', 'folder', 'book', 'symbol-method', 'terminal']);
    expect(picker.buttons.filter((item: any) => item.iconPath?.id.startsWith('arrow-'))
      .every(item => item === vscode.QuickInputButtons.Back)).toBe(true);
  };
  modal.show(SearchMode.Symbol); type('greet'); checkModes();
  await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); checkModes(); await vi.runAllTimersAsync(); checkModes();
  modal.toggleCaseSensitive(); checkModes();
  for (let i = 0; i < modes.length; i++) { modal.nextTab(); checkModes(); }
});

test('clicking the active mode keeps its icon selected', () => {
  modal.show(SearchMode.File);
  const active: any = picker.buttons.find((item: any) => item.tooltip === 'Files');
  active.toggle.checked = false;
  button.fire(active);
  expect((picker.buttons.find((item: any) => item.tooltip === 'Files') as any).toggle.checked).toBe(true);
});

test('Cmd/Ctrl+Right previews the active result at its position without closing the popup', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const hidden = vi.spyOn(picker, 'hide');
  modal.show(SearchMode.Text); type('needle'); await vi.runAllTimersAsync();
  const result = { label: 'needle', mode: SearchMode.Text, uri: vscode.Uri.file('/workspace/a.ts'), lineNumber: 7, column: 3 };
  requests[0].publish([result]); picker.activeItems = [result] as any;
  await modal.previewSelectedResult();
  const position = new vscode.Position(7, 3);
  expect(command).toHaveBeenCalledWith('vscode.open', result.uri, expect.objectContaining({ preserveFocus: true, preview: true, selection: new vscode.Selection(position, position) }));
  expect(hidden).not.toHaveBeenCalled();
});

test('the eye action shows the preview shortcut and previews the clicked row without closing search', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const hidden = vi.spyOn(picker, 'hide');
  modal.show(SearchMode.Text); type('needle'); await vi.runAllTimersAsync();
  requests[0].publish([
    { label: 'first', mode: SearchMode.Text, uri: vscode.Uri.file('/workspace/first.ts') },
    { label: 'second', mode: SearchMode.Text, uri: vscode.Uri.file('/workspace/second.ts'), lineNumber: 7, column: 3 },
  ]);
  picker.activeItems = [picker.items[0]] as any;
  const clicked: any = picker.items[1];
  const eye = clicked.buttons.find((item: any) => item.iconPath.id === 'eye');
  expect(eye?.tooltip).toBe('Preview (Right Arrow)');
  itemButton.fire({ item: clicked, button: eye }); await vi.runAllTimersAsync();
  expect(command).toHaveBeenCalledWith('vscode.open', clicked.uri, expect.objectContaining({
    preserveFocus: true, preview: true,
    selection: new vscode.Selection(new vscode.Position(7, 3), new vscode.Position(7, 3)),
  }));
  expect(hidden).not.toHaveBeenCalled();
});

test('recent history has an eye action that previews without recording another open', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const recent = { label: 'recent.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/recent.ts') };
  vi.spyOn(history, 'getRecentItems').mockReturnValue([recent]);
  modal.show(SearchMode.File);
  const item: any = picker.items.find((result: any) => result.uri);
  const eye = item.buttons.find((action: any) => action.iconPath.id === 'eye');
  expect(eye).toBeDefined();
  itemButton.fire({ item, button: eye }); await vi.runAllTimersAsync();
  expect(command).toHaveBeenCalledWith('vscode.open', recent.uri, expect.objectContaining({ preserveFocus: true }));
  expect(history.addOpened).not.toHaveBeenCalled();
});

test('closing the popup cancels a queued preview before it can open', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('a.ts');
  const result = { label: 'a.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/a.ts') };
  requests[0].publish([result]); picker.activeItems = [result] as any;
  const pending = modal.previewSelectedResult(); picker.hide(); await pending;
  expect(command.mock.calls.some(args => args[0] === 'vscode.open')).toBe(false);
});

test('Enter waits for an in-flight preview so the accepted file remains the final editor', async () => {
  let finish!: () => void;
  const opened: string[] = [];
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command: string, uri: any, options: any) => {
    if (command !== 'vscode.open') return;
    if (options?.preserveFocus) await new Promise<void>(resolve => { finish = resolve; });
    opened.push(uri.path);
  });
  modal.show(SearchMode.File); type('file');
  const first = { label: 'a.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/a.ts') };
  const accepted = { label: 'b.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/b.ts') };
  requests[0].publish([first, accepted]); picker.activeItems = [first] as any;
  const pending = modal.previewSelectedResult(); await Promise.resolve();
  picker.selectedItems = [accepted] as any; accept.fire(); await Promise.resolve();
  expect(opened).toEqual([]);
  finish(); await pending; await vi.runAllTimersAsync();
  expect(opened).toEqual(['/workspace/a.ts', '/workspace/b.ts']);
});

test('preview skips folders, commands, and informational rows', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.Everywhere); type('mixed');
  requests[0].publish([
    { label: 'folder', mode: SearchMode.Folder, uri: vscode.Uri.file('/workspace/src'), isFolder: true },
    { label: 'command', mode: SearchMode.Command, commandId: 'arbitrary.command' },
    { label: 'more', mode: SearchMode.File, moreCount: 5 },
  ]);
  for (const result of picker.items) {
    expect((result as any).buttons?.some((action: any) => action.iconPath.id === 'eye') ?? false).toBe(false);
    picker.activeItems = [result] as any; await modal.previewSelectedResult();
  }
  expect(command.mock.calls.every(args => args[0] === 'setContext')).toBe(true);
});

test('drilling into usages keeps the symbol name in the input so the lookup can be cleared', async () => {
  modal.show(SearchMode.Symbol); type('gre'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]); picker.selectedItems = [symbol] as any;
  modal.findUsages(symbol); await vi.runAllTimersAsync();
  expect(picker.value).toBe('greet');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Usages, query: '' });
  expect(requests.at(-1)?.options.usageTarget?.name).toBe('greet');
});

test('clearing a usage lookup returns to symbol search and ignores late reference results', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.selectedItems = [symbol] as any;
  modal.findUsages(symbol); await vi.runAllTimersAsync();
  const references = requests.at(-1)!;
  type('');
  references.publish([{ label: 'stale reference', mode: SearchMode.Usages, uri: symbol.uri }]);
  await vi.runAllTimersAsync();
  expect(references.dispose).toHaveBeenCalled();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toContain('Search symbols');
  expect(picker.title).not.toContain('Usages of greet');
  expect(picker.items).toMatchObject([{ label: '$(symbol-method) Search for a symbol' }]);
  type('other'); await vi.runAllTimersAsync();
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'other' });
  expect(requests.at(-1)?.options.usageTarget).toBeUndefined();
});

test('clearing another mode forgets the cached usage target before returning to Usages', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  modal.prevTab(); type('');
  modal.nextTab(); type('other'); await vi.runAllTimersAsync();
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'other' });
  expect(requests.at(-1)?.options.usageTarget).toBeUndefined();
});

test('informational search failure rows do not switch modes when accepted', async () => {
  modal.show(SearchMode.Everywhere); type('missing');
  requests[0].publish([{ label: '$(warning) Text search failed', mode: SearchMode.Text, alwaysShow: true }]);
  expect((picker.items[0] as any).buttons).toBeUndefined();
  picker.selectedItems = [picker.items[0]] as any;
  accept.fire(); await vi.runAllTimersAsync();
  expect(requests).toHaveLength(1);
});

test('a More Results row still switches to its results mode', async () => {
  modal.show(SearchMode.Everywhere); type('file');
  requests[0].publish([{ label: 'See more files', mode: SearchMode.File, moreCount: 5 }]);
  picker.selectedItems = [picker.items[0]] as any;
  accept.fire(); await vi.runAllTimersAsync();
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.File, query: 'file' });
});

test('preview cannot open an old active row after a new result list has arrived', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('old');
  const old = { label: 'old.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/old.ts') };
  requests[0].publish([old]); picker.activeItems = [old] as any;
  type('new'); requests.at(-1)!.publish([{ label: 'new.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/new.ts') }]);
  await modal.previewSelectedResult();
  expect(command.mock.calls.some(args => args[0] === 'vscode.open')).toBe(false);
});

test('accepting a stale selected row after replacement cannot open it', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('old');
  const old = { label: 'old.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/old.ts') };
  requests[0].publish([old]); picker.selectedItems = [old] as any;
  type('new'); requests.at(-1)!.publish([{ label: 'new.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/new.ts') }]);
  accept.fire(); await vi.runAllTimersAsync();
  expect(command.mock.calls.some(args => args[0] === 'vscode.open')).toBe(false);
});

test('stale result buttons cannot reopen a file after clearing the query', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('old');
  requests[0].publish([{ label: 'old.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/old.ts') }]);
  const old: any = picker.items[0];
  type(''); itemButton.fire({ item: old, button: old.buttons[0] });
  await vi.runAllTimersAsync();
  expect(command.mock.calls.some(args => args[0] === 'vscode.open')).toBe(false);
});

test('Find Usages ignores a symbol left active by a previous result list', async () => {
  modal.show(SearchMode.Symbol); type('old'); await vi.runAllTimersAsync();
  const old = { label: '$(symbol-function) old', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/old.ts') };
  requests[0].publish([old]); picker.activeItems = [old] as any;
  type('new'); await vi.runAllTimersAsync();
  requests.at(-1)!.publish([{ label: '$(symbol-function) new', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/new.ts') }]);
  modal.findUsages(); await vi.runAllTimersAsync();
  expect(picker.title).not.toContain('Usages of old');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'new' });
});

test('autofilling a result uses its URI path rather than a formatted path and line description', async () => {
  vi.spyOn(vscode.workspace, 'asRelativePath').mockReturnValue('src/file.ts');
  modal.show(SearchMode.Everywhere); type('needle');
  const result = { label: 'needle', description: 'Container - src/file.ts:27', mode: SearchMode.Text, uri: vscode.Uri.file('/workspace/src/file.ts'), lineNumber: 26, column: 2 };
  requests[0].publish([result]); picker.activeItems = [result] as any;
  modal.autofillSelectedPath();
  expect(picker.value).toBe('src/file.ts:');
  expect(requests.at(-1)?.query).toBe('src/file.ts');
});

test('clearing a file query cancels a queued preview as well as search work', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  modal.show(SearchMode.File); type('old');
  const item = { label: 'old.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/old.ts') };
  requests[0].publish([item]); picker.activeItems = [item] as any;
  const pending = modal.previewSelectedResult(); type(''); await pending;
  expect(command.mock.calls.some(args => args[0] === 'vscode.open')).toBe(false);
});

test('streaming Everything results preserve the selected symbol when text has the same location', () => {
  modal.show(SearchMode.Everywhere); type('greet');
  const uri = vscode.Uri.file('/workspace/greet.ts');
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri, lineNumber: 0, column: 16 };
  const text = { label: 'greet', mode: SearchMode.Text, uri, lineNumber: 0, column: 16 };
  requests[0].publish([symbol]); picker.activeItems = [picker.items[0]] as any;
  requests[0].publish([text, symbol]);
  expect((picker.activeItems[0] as any).mode).toBe(SearchMode.Symbol);
});


test('remembering a mode is opt-in and restores the last closed mode in the workspace', () => {
  let remember = false;
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'rememberLastMode' ? remember : undefined }), get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? remember : fallback } as any);
  modal.show(SearchMode.Text);
  picker.hide();
  expect(workspaceState.update).not.toHaveBeenCalled();
  modal.show();
  expect(picker.placeholder).toBe('Search everywhere...');
  picker.hide();
  remember = true;
  modal.show(SearchMode.Text);
  picker.hide();
  expect(workspaceState.update).toHaveBeenCalledWith('searchPlusPlus.lastSearchMode', 'text');
  modal.show();
  expect(picker.placeholder).toBe('Search text content...');
});

test('the Last used tab dropdown choice remembers and reopens the last search', () => {
  const settings: Record<string, unknown> = { whenSearchOpens: 'last' };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  modal.show(SearchMode.File); picker.hide();
  expect(workspaceState.update).toHaveBeenCalledWith('searchPlusPlus.lastSearchMode', 'file');
  modal.show();
  expect(picker.placeholder).toContain('Search files...');
});

test('closing usages remembers the combined Symbols tab without a reference target', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'rememberLastMode' ? true : undefined }), get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? true : fallback } as any);
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: 'greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [picker.items[0]] as any;
  modal.findUsages(); await vi.runAllTimersAsync(); picker.hide();
  expect(workspaceState.update).toHaveBeenCalledWith('searchPlusPlus.lastSearchMode', SearchMode.Symbol);
  modal.show();
  expect(picker.placeholder).toContain('Search symbols...');
  expect(picker.buttons).not.toContain(vscode.QuickInputButtons.Back);
});


test('an explicitly requested mode overrides a valid mode stored by a previous session', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'rememberLastMode' ? true : undefined }), get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? true : fallback } as any);
  workspaceState.get.mockReturnValue(SearchMode.Symbol);
  modal.show();
  expect(picker.placeholder).toContain('Search symbols');
  picker.hide();
  modal.show(SearchMode.File);
  expect(picker.placeholder).toContain('Search files');
});

test('the chosen opening tab and visible tab order apply while direct commands remain available', () => {
  const settings: Record<string, unknown> = { defaultMode: 'file', visibleTabs: ['file', 'text'] };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: settings[key] }), get: (key: string, fallback: unknown) => settings[key] ?? fallback } as any);
  modal.show();
  expect(picker.placeholder).toContain('Search files...');
  modal.nextTab();
  expect(picker.placeholder).toContain('Search text content...');
  modal.nextTab();
  expect(picker.placeholder).toContain('Search files...');
  picker.hide();
  modal.show(SearchMode.Command);
  expect(picker.placeholder).toBe('Search commands...');
  modal.nextTab();
  expect(picker.placeholder).toContain('Search files...');
  expect(picker.buttons.some((item: any) => item.tooltip === 'Commands')).toBe(false);
});

test('the single Tabs list controls popup buttons and cycling with readable names', () => {
  const settings: Record<string, unknown> = { tabs: ['Text', 'Files'], defaultMode: 'file' };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  modal.show();
  expect(picker.buttons.slice(0, 2).map((item: any) => item.tooltip)).toEqual(['Text', 'Files']);
  expect(picker.placeholder).toContain('Search files...');
  modal.nextTab();
  expect(picker.placeholder).toBe('Search text content...');
  modal.nextTab();
  expect(picker.placeholder).toContain('Search files...');
});

test('hidden remembered and default tabs fall back to the first visible tab', () => {
  const settings: Record<string, unknown> = {
    rememberLastMode: true, defaultMode: 'command', tabOrder: ['text', 'file'], visibleTabs: ['file', 'text'],
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: settings[key] }), get: (key: string, fallback: unknown) => settings[key] ?? fallback } as any);
  workspaceState.get.mockReturnValue(SearchMode.Symbol);
  modal.show();
  expect(picker.placeholder).toBe('Search text content...');
  expect(picker.buttons.slice(0, 2).map((item: any) => item.tooltip)).toEqual(['Text', 'Files']);
});


test('invalid stored modes fall back to Everything and legacy Usages opens Symbols', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'rememberLastMode' ? true : undefined }), get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? true : fallback } as any);
  workspaceState.get.mockReturnValue('removed-mode');
  modal.show();
  expect(picker.placeholder).toBe('Search everywhere...');
  picker.hide();
  workspaceState.get.mockReturnValue(SearchMode.Usages);
  modal.show();
  expect(picker.placeholder).toContain('Search symbols...');
  expect(picker.items[0].label).toContain('Search for a symbol');
  expect(picker.buttons).not.toContain(vscode.QuickInputButtons.Back);
});

test('configured tab order controls buttons and keyboard cycling while retaining every mode', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'tabOrder' ? ['command', 'file'] : undefined }), get: (key: string, fallback: unknown) => key === 'tabOrder' ? ['command', 'file'] : fallback } as any);
  modal.show();
  expect(picker.buttons.slice(0, 6).map((item: any) => item.tooltip)).toEqual(['Commands', 'Files', 'Everything', 'Folders', 'Text', 'Symbols']);
  modal.prevTab();
  expect(picker.placeholder).toContain('Search files');
  modal.prevTab();
  expect(picker.placeholder).toBe('Search commands...');
  modal.prevTab();
  expect(picker.placeholder).toContain('Search symbols...');
  modal.nextTab();
  expect(picker.placeholder).toBe('Search commands...');
});
