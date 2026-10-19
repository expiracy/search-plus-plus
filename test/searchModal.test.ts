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
  modal = new SearchModal(manager as any, { getRecentItems: () => [], addOpened: vi.fn() } as any,
    new Map(Object.values(SearchMode).map(mode => [mode, provider(mode)])) as any);
});

afterEach(() => {
  vscode.window.activeTextEditor = undefined;
  picker.hide();
  modal.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function type(value: string) {
  picker.value = value;
  input.fire(value);
}

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
