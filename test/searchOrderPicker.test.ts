import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchOrderPicker } = await import('../src/ui/searchOrderPicker');
const { SearchMode } = await import('../src/searchModes');

let editor: InstanceType<typeof SearchOrderPicker>;
let picker: any;
let itemButtons: InstanceType<typeof vscode.EventEmitter<any>>;
let titleButtons: InstanceType<typeof vscode.EventEmitter<any>>;
let hidden: InstanceType<typeof vscode.EventEmitter<void>>;
let user: Record<string, unknown>;
let workspace: Record<string, unknown>;
let update: ReturnType<typeof vi.fn>;

beforeEach(() => {
  user = { searchOrder: ['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Commands'] };
  workspace = {};
  itemButtons = new vscode.EventEmitter(); titleButtons = new vscode.EventEmitter(); hidden = new vscode.EventEmitter();
  picker = { ...vscode.window.createQuickPick(), onDidTriggerItemButton: itemButtons.event,
    onDidTriggerButton: titleButtons.event, onDidHide: hidden.event, hide: () => hidden.fire() };
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
  update = vi.fn(async (key: string, value: unknown, target: number) => {
    (target === vscode.ConfigurationTarget.Global ? user : workspace)[key] = value;
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }), update,
  } as any));
  editor = new SearchOrderPicker();
});
afterEach(() => {
  editor.dispose(); itemButtons.dispose(); titleButtons.dispose(); hidden.dispose();
  vscode.workspace.workspaceFolders = undefined; vi.restoreAllMocks();
});

function move(mode: string, direction: 'up' | 'down') {
  const item = picker.items.find((row: any) => row.mode === mode);
  itemButtons.fire({ item, button: item.buttons.find((button: any) => button.tooltip === `Move ${direction}`) });
}

test('a down-arrow click moves the chosen search one position and saves User order', async () => {
  await editor.show();
  move(SearchMode.File, 'down');
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']));
  expect(update).toHaveBeenCalledWith('searchOrder', user.searchOrder, vscode.ConfigurationTarget.Global);
});

test('visible toolbar arrows move the selected search without hovering a row', async () => {
  await editor.show();
  const up = picker.buttons.find((button: any) => button.tooltip === 'Move selected search up');
  const down = picker.buttons.find((button: any) => button.tooltip === 'Move selected search down');
  expect(up).toBeDefined(); expect(down).toBeDefined();
  picker.activeItems = [picker.items.find((item: any) => item.mode === SearchMode.File)];
  titleButtons.fire(down);
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']));
  expect(picker.activeItems[0].mode).toBe(SearchMode.File);
});

test('rows at the boundaries only offer the arrow that can move them', async () => {
  await editor.show();
  expect(picker.items[0].buttons.map((button: any) => button.tooltip)).toEqual(['Move down']);
  expect(picker.items.at(-1).buttons.map((button: any) => button.tooltip)).toEqual(['Move up']);
  move(SearchMode.Folder, 'up');
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']));
});

test('rapid arrow clicks keep moving the same search and retain its selection', async () => {
  await editor.show();
  move(SearchMode.File, 'down'); move(SearchMode.File, 'down');
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Text', 'Files', 'Symbols', 'Commands']));
  expect(picker.activeItems[0].mode).toBe(SearchMode.File);
});

test('an existing Workspace override is edited without changing the User order', async () => {
  workspace.searchOrder = ['Files', 'Everything', 'Folders', 'Text', 'Symbols', 'Commands'];
  const previousUser = [...user.searchOrder as string[]];
  await editor.show();
  expect(picker.title).toContain('Workspace settings');
  move(SearchMode.File, 'down');
  await vi.waitFor(() => expect(workspace.searchOrder).toEqual(['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Commands']));
  expect(user.searchOrder).toEqual(previousUser);
});

test('switching scope waits for a pending edit and keeps that edit in its original scope', async () => {
  let release!: () => void;
  update.mockImplementationOnce(async (key: string, value: unknown) => {
    await new Promise<void>(resolve => { release = resolve; }); user[key] = value;
  });
  await editor.show('user'); move(SearchMode.File, 'down');
  await Promise.resolve();
  titleButtons.fire(picker.buttons.find((button: any) => button.tooltip === 'Switch to Workspace settings'));
  release();
  await vi.waitFor(() => expect(picker.title).toContain('Workspace settings'));
  expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']);
  expect(workspace.searchOrder).toBeUndefined();
  move(SearchMode.Folder, 'up');
  await vi.waitFor(() => expect(workspace.searchOrder).toEqual(['Folders', 'Everything', 'Files', 'Text', 'Symbols', 'Commands']));
  expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']);
});

test('a failed save leaves the order intact and later arrow clicks still work', async () => {
  const error = vi.spyOn(vscode.window, 'showErrorMessage');
  update.mockRejectedValueOnce(new Error('Read only settings'));
  await editor.show(); move(SearchMode.File, 'down');
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Could not update search order: Read only settings'));
  expect(user.searchOrder).toEqual(['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Commands']);
  move(SearchMode.File, 'down');
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']));
});

test('Done waits for the final save before closing the list', async () => {
  let release!: () => void;
  update.mockImplementationOnce(async (key: string, value: unknown) => {
    await new Promise<void>(resolve => { release = resolve; }); user[key] = value;
  });
  const dispose = vi.spyOn(picker, 'dispose');
  await editor.show(); move(SearchMode.File, 'down'); await Promise.resolve();
  titleButtons.fire(picker.buttons.find((button: any) => button.tooltip === 'Done'));
  expect(picker.enabled).toBe(false); expect(dispose).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(user.searchOrder).toEqual(['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands']);
});

test('disabled searches can be positioned without changing their enabled state', async () => {
  const choices = { Symbols: false }; user.enabledSearches = choices;
  await editor.show();
  expect(picker.items.find((row: any) => row.mode === SearchMode.Symbol).description).toContain('Disabled');
  move(SearchMode.Symbol, 'up');
  await vi.waitFor(() => expect(user.searchOrder).toEqual(['Everything', 'Files', 'Folders', 'Symbols', 'Text', 'Commands']));
  expect(user.enabledSearches).toEqual(choices);
});
