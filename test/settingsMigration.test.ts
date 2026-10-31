import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { migrateSearchSettings } = await import('../src/settingsMigration');
afterEach(() => vi.restoreAllMocks());

test('existing choices become shared checkboxes and ordering at their original scope', async () => {
  const user: Record<string, unknown> = { 'everywhere.sections': ['text', 'files'] };
  const workspace: Record<string, unknown> = { 'everywhere.sections': ['folders'] };
  const update = vi.fn(async (key: string, value: unknown, target: number) => {
    const values = target === 1 ? user : workspace;
    if (value === undefined) delete values[key]; else values[key] = value;
  });
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }), update,
  } as any));
  await migrateSearchSettings();
  expect(user).toEqual({
    enabledSearches: { Files: true, Folders: false, Text: true, Symbols: false, Commands: false },
    searchOrder: ['Everything', 'Text', 'Files', 'Folders', 'Symbols', 'Commands'],
  });
  expect(workspace).toEqual({
    enabledSearches: { Files: false, Folders: true, Text: false, Symbols: false, Commands: false },
    searchOrder: ['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands'],
  });
});

test('previous source checkbox choices and ordering carry over into shared settings', async () => {
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
  await migrateSearchSettings();
  expect(values).toEqual({
    enabledSearches: { Files: false, Folders: true, Text: true, Symbols: true, Commands: true },
    searchOrder: ['Everything', 'Text', 'Files', 'Folders', 'Symbols', 'Commands'],
  });
  expect(update).toHaveBeenCalledWith('everywhere.sections', undefined, vscode.ConfigurationTarget.Global);
});

test('a failed replacement save keeps the old setting available', async () => {
  const update = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Read only settings'));
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    inspect: (key: string) => ({ globalValue: key === 'everywhere.sections' ? ['files'] : undefined }), update,
  } as any);
  await expect(migrateSearchSettings()).rejects.toThrow('Read only settings');
  expect(update.mock.calls.some(([key]) => key === 'everywhere.sections')).toBe(false);
});

test('shared choices win while conflicting old tab and source choices stay disabled', async () => {
  const values: Record<string, unknown> = {
    tabs: ['Commands', 'Files', 'Everything'], 'everything.sources': { Symbols: true },
    'everything.order': ['Symbols', 'Files'], rememberLastMode: true, defaultMode: 'file',
    enabledSearches: { Files: false, Text: true },
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    inspect: (key: string) => ({ globalValue: values[key] }),
    update: async (key: string, value: unknown) => { if (value === undefined) delete values[key]; else values[key] = value; },
  } as any);
  await migrateSearchSettings();
  expect(values.enabledSearches).toEqual({ Files: false, Folders: false, Text: true, Symbols: false, Commands: true });
  expect((values.searchOrder as string[])[0]).toBe('Commands');
  expect(values.whenSearchOpens).toBe('last');
  expect(values.tabs).toBeUndefined();
  expect(values['everything.sources']).toBeUndefined();
});

test('Workspace opening overrides retain their inherited legacy default during conversion', async () => {
  const user: Record<string, unknown> = { rememberLastMode: true, defaultMode: 'file' };
  const workspace: Record<string, unknown> = { rememberLastMode: false };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
    update: async (key: string, value: unknown, target: number) => {
      const values = target === vscode.ConfigurationTarget.Global ? user : workspace;
      if (value === undefined) delete values[key]; else values[key] = value;
    },
  } as any));
  await migrateSearchSettings();
  expect(user).toEqual({ whenSearchOpens: 'last' });
  expect(workspace).toEqual({ whenSearchOpens: 'file' });
});
