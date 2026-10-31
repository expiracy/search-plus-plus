import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchWindowConfiguration } = await import('../src/ui/searchWindowConfiguration');
const { DEFAULT_TAB_ORDER, SearchMode } = await import('../src/searchModes');

let controller: InstanceType<typeof SearchWindowConfiguration>;
let globalValues: Record<string, unknown>;
let workspaceValues: Record<string, unknown>;
let update: ReturnType<typeof vi.fn>;
const token = { isCancellationRequested: false } as any;

beforeEach(() => {
  globalValues = { tabOrder: [...DEFAULT_TAB_ORDER] };
  workspaceValues = {};
  update = vi.fn(async (key: string, value: unknown, target: number) => {
    const values = target === vscode.ConfigurationTarget.Workspace ? workspaceValues : globalValues;
    if (value === undefined) delete values[key]; else values[key] = value;
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => workspaceValues[key] ?? globalValues[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: globalValues[key], workspaceValue: workspaceValues[key] }),
    update,
  } as any);
  controller = new SearchWindowConfiguration();
});

afterEach(() => { controller.dispose(); vscode.workspace.workspaceFolders = undefined; vi.restoreAllMocks(); });

test('dragging a tab before another saves that order to user settings', async () => {
  const data = new vscode.DataTransfer();
  controller.handleDrag([{ kind: 'tab', mode: SearchMode.Text }], data as any, token);
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.File }, data as any, token);
  expect(update).toHaveBeenCalledExactlyOnceWith('tabOrder', [
    'everywhere', 'text', 'file', 'folder', 'symbol', 'command',
  ], vscode.ConfigurationTarget.Global);
});

test('dragging a tab down by one row moves it into that position', async () => {
  const data = new vscode.DataTransfer();
  controller.handleDrag([{ kind: 'tab', mode: SearchMode.File }], data as any, token);
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.Folder }, data as any, token);
  expect(globalValues.tabOrder).toEqual([
    'everywhere', 'folder', 'file', 'text', 'symbol', 'command',
  ]);
});

test('unchecking a tab hides it without changing its order', async () => {
  await controller.setVisibility([[{ kind: 'tab', mode: SearchMode.Symbol }, vscode.TreeItemCheckboxState.Unchecked]]);
  expect(update).toHaveBeenCalledExactlyOnceWith('visibleTabs', [
    'everywhere', 'file', 'folder', 'text', 'command',
  ], vscode.ConfigurationTarget.Global);
  expect(controller.getTreeItem({ kind: 'tab', mode: SearchMode.Symbol }).checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
  expect(globalValues.tabOrder).toEqual(DEFAULT_TAB_ORDER);
});

test('choosing a fixed opening tab turns off remembering the last tab', async () => {
  globalValues.rememberLastMode = true;
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => items.find(item => item.mode === SearchMode.File));
  await controller.chooseOpeningTab();
  expect(update.mock.calls).toEqual([
    ['defaultMode', SearchMode.File, vscode.ConfigurationTarget.Global],
    ['rememberLastMode', false, vscode.ConfigurationTarget.Global],
  ]);
  expect(controller.getTreeItem({ kind: 'opening' }).description).toBe('Files');
});

test('existing workspace overrides are edited in the workspace rather than changing user settings', async () => {
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
  workspaceValues.tabOrder = ['file', 'text', 'everywhere', 'folder', 'symbol', 'command'];
  controller.dispose(); controller = new SearchWindowConfiguration();
  const data = new vscode.DataTransfer();
  controller.handleDrag([{ kind: 'tab', mode: SearchMode.Text }], data as any, token);
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.File }, data as any, token);
  expect(update).toHaveBeenCalledExactlyOnceWith('tabOrder', [
    'text', 'file', 'everywhere', 'folder', 'symbol', 'command',
  ], vscode.ConfigurationTarget.Workspace);
  expect(globalValues.tabOrder).toEqual(DEFAULT_TAB_ORDER);
  expect(controller.getTreeItem({ kind: 'scope' }).description).toBe('This workspace');
});

test('changing scope waits for a pending save and applies subsequent edits to the new scope', async () => {
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace') }];
  let release!: () => void;
  update.mockImplementationOnce(async (key: string, value: unknown) => {
    await new Promise<void>(resolve => { release = resolve; });
    globalValues[key] = value;
  });
  const save = controller.setVisibility([[{ kind: 'tab', mode: SearchMode.Symbol }, vscode.TreeItemCheckboxState.Unchecked]]);
  await Promise.resolve();
  const pick = vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items =>
    items.find(item => item.target === vscode.ConfigurationTarget.Workspace));
  const changeScope = controller.chooseScope();
  expect(pick).not.toHaveBeenCalled();
  release();
  await Promise.all([save, changeScope]);
  expect(globalValues.visibleTabs).not.toContain('symbol');
  expect(workspaceValues).toEqual({});
  await controller.setVisibility([[{ kind: 'tab', mode: SearchMode.Command }, vscode.TreeItemCheckboxState.Unchecked]]);
  expect(workspaceValues.visibleTabs).toEqual(['everywhere', 'file', 'folder', 'text']);
  expect(globalValues.visibleTabs).toContain('command');
});

test('the Search window menu choice opens the native configurator', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand');
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => items.find(item => item.id === 'window'));
  await controller.showMenu();
  expect(command.mock.calls).toEqual([
    ['setContext', 'searchPlusPlus.configuringWindow', true],
    ['searchPlusPlus.searchWindow.focus'],
  ]);
});

test('reset clears only search-window overrides and preserves result exclusions', async () => {
  globalValues.defaultMode = 'file'; globalValues.visibleTabs = ['file'];
  globalValues.rememberLastMode = true; globalValues.excludePaths = ['**/build/**'];
  await controller.reset();
  expect(globalValues).toEqual({ excludePaths: ['**/build/**'] });
});

test('the keyboard position picker provides the same reordering without dragging', async () => {
  vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async items => items.find(item => item.position === 0));
  await controller.moveTab({ kind: 'tab', mode: SearchMode.Text });
  expect(globalValues.tabOrder).toEqual(['text', 'everywhere', 'file', 'folder', 'symbol', 'command']);
});

test('the last visible tab cannot be unchecked', async () => {
  globalValues.visibleTabs = ['file'];
  const message = vi.spyOn(vscode.window, 'showInformationMessage');
  await controller.setVisibility([[{ kind: 'tab', mode: SearchMode.File }, vscode.TreeItemCheckboxState.Unchecked]]);
  expect(update).not.toHaveBeenCalled();
  expect(globalValues.visibleTabs).toEqual(['file']);
  expect(message).toHaveBeenCalledWith('Keep at least one search tab visible.');
});

test('hiding the fixed opening tab chooses the first remaining visible tab', async () => {
  globalValues.defaultMode = 'file'; globalValues.visibleTabs = ['file', 'text'];
  await controller.setVisibility([[{ kind: 'tab', mode: SearchMode.File }, vscode.TreeItemCheckboxState.Unchecked]]);
  expect(globalValues.visibleTabs).toEqual(['text']);
  expect(globalValues.defaultMode).toBe('text');
});

test('cancelled opening choices and unrelated drops leave settings untouched', async () => {
  await controller.chooseOpeningTab();
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.File }, new vscode.DataTransfer() as any, token);
  expect(update).not.toHaveBeenCalled();
});

test('a failed save reports the error and does not prevent later edits', async () => {
  const message = vi.spyOn(vscode.window, 'showErrorMessage');
  update.mockRejectedValueOnce(new Error('Read only'));
  const data = new vscode.DataTransfer();
  controller.handleDrag([{ kind: 'tab', mode: SearchMode.Text }], data as any, token);
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.File }, data as any, token);
  expect(globalValues.tabOrder).toEqual(DEFAULT_TAB_ORDER);
  expect(message).toHaveBeenCalledWith('Could not update search++ settings: Read only');
  await controller.handleDrop({ kind: 'tab', mode: SearchMode.File }, data as any, token);
  expect(globalValues.tabOrder).toEqual(['everywhere', 'text', 'file', 'folder', 'symbol', 'command']);
});
