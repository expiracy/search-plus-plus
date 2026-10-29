import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchModal } = await import('../src/ui/searchModal');
const { SearchMode } = await import('../src/providers/types');

let modal: InstanceType<typeof SearchModal>;
let picker: ReturnType<typeof vscode.window.createQuickPick>;
let input: InstanceType<typeof vscode.EventEmitter<string>>;
let accept: InstanceType<typeof vscode.EventEmitter<void>>;
let state: InstanceType<typeof vscode.EventEmitter<string>>;
let itemButton: InstanceType<typeof vscode.EventEmitter<any>>;
let button: InstanceType<typeof vscode.EventEmitter<any>>;
let hide: InstanceType<typeof vscode.EventEmitter<void>>;
let workspaceState: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let history: { getRecentItems: () => any[]; addOpened: ReturnType<typeof vi.fn> };
let requests: Array<{ mode: string; query: string; options: any; publish: (results: any[]) => void; dispose: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.useFakeTimers();
  input = new vscode.EventEmitter();
  accept = new vscode.EventEmitter();
  state = new vscode.EventEmitter();
  hide = new vscode.EventEmitter();
  itemButton = new vscode.EventEmitter();
  button = new vscode.EventEmitter();
  picker = {
    ...vscode.window.createQuickPick(),
    onDidChangeValue: input.event,
    onDidAccept: accept.event,
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function type(value: string) {
  picker.value = value;
  input.fire(value);
}

test('macOS search controls and empty-result hints show Option shortcuts', () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
  modal.show(SearchMode.File);
  expect(picker.buttons.slice(7).map((item: any) => item.tooltip)).toEqual([
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
  expect(picker.buttons.slice(7).map((item: any) => item.tooltip)).toEqual([
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

test('the Usages tab searches symbols and Enter chooses a reference target', async () => {
  modal.show(SearchMode.Usages); type('greet');
  await vi.runAllTimersAsync();
  expect(picker.placeholder).toContain('symbol');
  expect(requests[0].mode).toBe(SearchMode.Symbol);
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]);
  picker.selectedItems = [symbol] as any;
  accept.fire();
  await vi.runAllTimersAsync();
  expect(requests.at(-1)?.options.usageTarget).toMatchObject({ name: 'greet', position: new vscode.Position(0, 16) });
  expect(picker.title).toContain('Usages of greet');
});

test('returning from references to Symbols restores the original symbol query', async () => {
  modal.show(SearchMode.Symbol); type('greet');
  await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('consumer.ts'); await vi.runAllTimersAsync();
  modal.prevTab(); await vi.runAllTimersAsync();
  expect(picker.value).toBe('greet');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'greet' });
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
  itemButton.fire({ item, button: action }); await vi.runAllTimersAsync();
  expect(requests.at(-1)?.options.usageTarget?.name).toBe('greet');
  expect(open).not.toHaveBeenCalled();
});

test('Go to File opens a positioned result in the current group with one operation', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  const open = vi.spyOn(vscode.window, 'showTextDocument');
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const uri = vscode.Uri.file('/workspace/greet.ts');
  requests[0].publish([{ label: 'greet', mode: SearchMode.Symbol, uri, lineNumber: 12, column: 9 }]);
  const item: any = picker.items[0];
  const action = item.buttons.find((button: any) => button.tooltip === 'Go to File');
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
  itemButton.fire({ item, button: item.buttons.find((button: any) => button.tooltip === 'Go to File') });
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

test('the permanent Usages icon resets the reference filter and restores symbol candidates', async () => {
  modal.show(SearchMode.Symbol); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.activeItems = [symbol] as any;
  modal.findUsages(); await vi.runAllTimersAsync();
  type('consumer.ts'); await vi.runAllTimersAsync();
  const choose = picker.buttons.find((button: any) => button.tooltip === 'Usages');
  expect(choose).toBeTruthy(); button.fire(choose); await vi.runAllTimersAsync();
  expect(picker.value).toBe('greet');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Symbol, query: 'greet' });
  expect(requests.at(-1)?.options.usageTarget).toBeUndefined();
});

test('an empty Usages tab explains how to choose a symbol', () => {
  modal.show(SearchMode.Usages);
  expect(picker.items).toMatchObject([{ label: '$(symbol-method) Search for a symbol to find usages', mode: SearchMode.Usages }]);
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

test('all seven mode icons stay in place through loading, usages, and mode changes', async () => {
  const modes = ['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Usages', 'Commands'];
  const checkModes = () => {
    expect(picker.buttons.slice(0, 7).map((item: any) => item.tooltip)).toEqual(modes);
    expect(picker.buttons.slice(0, 7).map((item: any) => item.iconPath.id)).toEqual(['search', 'file', 'folder', 'book', 'symbol-method', 'references', 'terminal']);
    expect(picker.buttons.some((item: any) => item.iconPath?.id.startsWith('arrow-'))).toBe(false);
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

test('Right Arrow previews the active result at its position without closing the popup', async () => {
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
  modal.show(SearchMode.Everywhere);
  for (const result of [
    { label: 'folder', mode: SearchMode.Folder, uri: vscode.Uri.file('/workspace/src'), isFolder: true },
    { label: 'command', mode: SearchMode.Command, commandId: 'arbitrary.command' },
    { label: 'more', mode: SearchMode.File, moreCount: 5 },
  ]) {
    picker.activeItems = [result] as any; await modal.previewSelectedResult();
  }
  expect(command.mock.calls.every(args => args[0] === 'setContext')).toBe(true);
});

test('choosing a usage symbol keeps its name in the input so the nested lookup can be cleared', async () => {
  modal.show(SearchMode.Usages); type('gre'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts'), lineNumber: 0, column: 16 };
  requests[0].publish([symbol]); picker.selectedItems = [symbol] as any;
  accept.fire(); await vi.runAllTimersAsync();
  expect(picker.value).toBe('greet');
  expect(requests.at(-1)).toMatchObject({ mode: SearchMode.Usages, query: '' });
  expect(requests.at(-1)?.options.usageTarget?.name).toBe('greet');
});

test('clearing a usage lookup returns to symbol search and ignores late reference results', async () => {
  modal.show(SearchMode.Usages); type('greet'); await vi.runAllTimersAsync();
  const symbol = { label: '$(symbol-function) greet', mode: SearchMode.Symbol, uri: vscode.Uri.file('/workspace/greet.ts') };
  requests[0].publish([symbol]); picker.selectedItems = [symbol] as any;
  accept.fire(); await vi.runAllTimersAsync();
  const references = requests.at(-1)!;
  type('');
  references.publish([{ label: 'stale reference', mode: SearchMode.Usages, uri: symbol.uri }]);
  await vi.runAllTimersAsync();
  expect(references.dispose).toHaveBeenCalled();
  expect(picker.value).toBe('');
  expect(picker.placeholder).toContain('Search symbols');
  expect(picker.title).not.toContain('Usages of greet');
  expect(picker.items).toMatchObject([{ label: '$(symbol-method) Search for a symbol to find usages' }]);
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
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? remember : fallback } as any);
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


test('an explicitly requested mode overrides a valid mode stored by a previous session', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? true : fallback } as any);
  workspaceState.get.mockReturnValue(SearchMode.Symbol);
  modal.show();
  expect(picker.placeholder).toContain('Search symbols');
  picker.hide();
  modal.show(SearchMode.File);
  expect(picker.placeholder).toContain('Search files');
});


test('an invalid stored mode falls back to Everything without restoring a usage lookup', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'rememberLastMode' ? true : fallback } as any);
  workspaceState.get.mockReturnValue('removed-mode');
  modal.show();
  expect(picker.placeholder).toBe('Search everywhere...');
  picker.hide();
  workspaceState.get.mockReturnValue(SearchMode.Usages);
  modal.show();
  expect(picker.placeholder).toBe('Search symbols to find usages...');
  expect(picker.items[0].label).toContain('Search for a symbol');
});

test('configured tab order controls buttons and keyboard cycling while retaining every mode', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'tabOrder' ? ['command', 'file'] : fallback } as any);
  modal.show();
  expect(picker.buttons.slice(0, 7).map((item: any) => item.tooltip)).toEqual(['Commands', 'Files', 'Everything', 'Folders', 'Text', 'Symbols', 'Usages']);
  modal.prevTab();
  expect(picker.placeholder).toContain('Search files');
  modal.prevTab();
  expect(picker.placeholder).toBe('Search commands...');
  modal.prevTab();
  expect(picker.placeholder).toContain('find usages');
  modal.nextTab();
  expect(picker.placeholder).toBe('Search commands...');
});
