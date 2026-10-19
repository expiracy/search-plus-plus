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
let hide: InstanceType<typeof vscode.EventEmitter<void>>;
let requests: Array<{ query: string; publish: (results: any[]) => void; dispose: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.useFakeTimers();
  input = new vscode.EventEmitter();
  accept = new vscode.EventEmitter();
  state = new vscode.EventEmitter();
  hide = new vscode.EventEmitter();
  picker = {
    ...vscode.window.createQuickPick(),
    onDidChangeValue: input.event,
    onDidAccept: accept.event,
    onDidHide: hide.event,
    hide: () => hide.fire(),
  };
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  const manager = {
    state: 'ready', fileIndex: {}, textSearch: {}, gitIgnore: {}, onDidChangeState: state.event,
  };
  requests = [];
  const provider = {
    search: (query: string, _options: unknown, publish: (results: any[]) => void) => {
      const dispose = vi.fn();
      requests.push({ query, publish, dispose });
      return { dispose };
    },
  };
  modal = new SearchModal(manager as any, { getRecentItems: () => [], addOpened: vi.fn() } as any,
    new Map(Object.values(SearchMode).map(mode => [mode, provider])) as any);
});

afterEach(() => {
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
