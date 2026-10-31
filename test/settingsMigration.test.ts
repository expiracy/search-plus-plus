import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { migrateEverythingSettings } = await import('../src/settingsMigration');
afterEach(() => vi.restoreAllMocks());

test('existing section choices become checkboxes and ordering at their original scope', async () => {
  const user: Record<string, unknown> = { 'everywhere.sections': ['text', 'files'] };
  const workspace: Record<string, unknown> = { 'everywhere.sections': ['folders'] };
  const update = vi.fn(async (key: string, value: unknown, target: number) => {
    const values = target === 1 ? user : workspace;
    if (value === undefined) delete values[key]; else values[key] = value;
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }), update,
  } as any));
  await migrateEverythingSettings();
  expect(user).toEqual({
    'everything.sources': { Files: true, Folders: false, Symbols: false, Text: true, Commands: false },
    'everything.order': ['Text', 'Files', 'Folders', 'Symbols', 'Commands'],
  });
  expect(workspace).toEqual({
    'everything.sources': { Files: false, Folders: true, Symbols: false, Text: false, Commands: false },
    'everything.order': ['Folders', 'Files', 'Symbols', 'Text', 'Commands'],
  });
});

test('migration preserves checkbox and order choices already made in the new controls', async () => {
  const values: Record<string, unknown> = {
    'everywhere.sections': ['files'], 'everything.sources': { Files: false, Text: true },
    'everything.order': ['Text', 'Files'],
  };
  const update = vi.fn(async (key: string, value: unknown) => {
    if (value === undefined) delete values[key]; else values[key] = value;
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    inspect: (key: string) => ({ globalValue: values[key] }), update,
  } as any);
  await migrateEverythingSettings();
  expect(values).toEqual({ 'everything.sources': { Files: false, Text: true }, 'everything.order': ['Text', 'Files'] });
  expect(update).toHaveBeenCalledExactlyOnceWith('everywhere.sections', undefined, vscode.ConfigurationTarget.Global);
});

test('a failed replacement save keeps the old setting available', async () => {
  const update = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Read only settings'));
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    inspect: (key: string) => ({ globalValue: key === 'everywhere.sections' ? ['files'] : undefined }), update,
  } as any);
  await expect(migrateEverythingSettings()).rejects.toThrow('Read only settings');
  expect(update.mock.calls.some(([key]) => key === 'everywhere.sections')).toBe(false);
});
