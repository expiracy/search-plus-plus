import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { registerSearchTypeValidation } = await import('../src/settingsGuard');
const cleanups: Array<{ dispose(): void }> = [];
afterEach(() => { cleanups.splice(0).forEach(item => item.dispose()); vi.restoreAllMocks(); });

function setup(user: Record<string, unknown>, workspace: Record<string, unknown> = {}) {
  const changed = new vscode.EventEmitter<any>();
  cleanups.push(changed);
  vi.spyOn(vscode.workspace, 'onDidChangeConfiguration').mockImplementation(listener => changed.event(listener));
  const update = vi.fn(async (key: string, value: unknown, target: number) => {
    const values = target === vscode.ConfigurationTarget.Global ? user : workspace;
    if (value === undefined) delete values[key]; else values[key] = value;
    changed.fire({ affectsConfiguration: (name: string) => name === `searchPlusPlus.${key}` });
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }), update,
  } as any));
  cleanups.push(registerSearchTypeValidation());
  return { user, workspace, update };
}

test('unchecking the last search restores the previous User checkbox selection', async () => {
  const choices = { Files: true, Folders: false, Text: false, Symbols: false, Commands: false };
  const { user, update } = setup({ everythingTabSources: choices });
  await update('everythingTabSources', { ...choices, Files: false }, vscode.ConfigurationTarget.Global);
  await vi.waitFor(() => expect(user.everythingTabSources).toEqual(choices));
});

test('the Workspace guard respects search types inherited from User settings', async () => {
  const choices = { Files: false, Folders: false, Text: false, Symbols: true, Commands: false };
  const { user, workspace, update } = setup({ everythingTabSources: choices });
  await update('everythingTabSources', { Symbols: false }, vscode.ConfigurationTarget.Workspace);
  await vi.waitFor(() => expect(workspace.everythingTabSources).toBeUndefined());
  expect(user.everythingTabSources).toEqual(choices);
});

test('a valid User edit keeps a remaining Workspace search enabled without undoing the User choice', async () => {
  const choices = { Files: true, Folders: false, Text: false, Symbols: true, Commands: false };
  const { user, workspace, update } = setup({ everythingTabSources: choices }, { everythingTabSources: { Symbols: false } });
  await update('everythingTabSources', { ...choices, Files: false }, vscode.ConfigurationTarget.Global);
  await vi.waitFor(() => expect(workspace.everythingTabSources).toEqual({ Symbols: false, Files: true }));
  expect((user.everythingTabSources as any).Files).toBe(false);
});
