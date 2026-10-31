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
    everythingTabSources: { Files: true, Folders: false, Text: true, Symbols: false, Commands: false },
    tabOrder: ['Everything', 'Text', 'Files', 'Folders', 'Symbols', 'Commands'],
  });
  expect(workspace).toEqual({
    everythingTabSources: { Files: false, Folders: true, Text: false, Symbols: false, Commands: false },
    tabOrder: ['Everything', 'Folders', 'Files', 'Text', 'Symbols', 'Commands'],
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
    everythingTabSources: { Files: false, Folders: true, Text: true, Symbols: true, Commands: true },
    tabOrder: ['Everything', 'Text', 'Files', 'Folders', 'Symbols', 'Commands'],
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
  expect(values.everythingTabSources).toEqual({ Files: false, Folders: false, Text: true, Symbols: false, Commands: true });
  expect((values.tabOrder as string[])[0]).toBe('Commands');
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

test('renaming current controls preserves sources, order, limits, and scope overrides', async () => {
  const user: Record<string, unknown> = {
    enabledSearches: { Symbols: false }, searchOrder: ['Folders', 'Everything', 'Files', 'Text', 'Symbols', 'Commands'],
    maxResults: 45, 'everywhere.resultLimit': 8, debounceMs: 120,
    excludeGitIgnored: false, excludeSearchIgnored: true, excludePaths: ['**/out/**'],
  };
  const workspace: Record<string, unknown> = { maxResults: 12, resultsPerSearchType: 90, debounceMs: 700 };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
    update: async (key: string, value: unknown, target: number) => {
      const values = target === vscode.ConfigurationTarget.Global ? user : workspace;
      if (value === undefined) delete values[key]; else values[key] = value;
    },
  } as any));
  await migrateSearchSettings();
  expect(user).toEqual({
    everythingTabSources: { Files: true, Folders: true, Text: true, Symbols: false, Commands: true },
    tabOrder: ['Folders', 'Everything', 'Files', 'Text', 'Symbols', 'Commands'],
    resultsPerSearchType: 45, resultsPerEverythingGroup: 8, searchDelay: 120,
    gitIgnoreRules: false, searchIgnoreRules: true, excludedPaths: ['**/out/**'],
  });
  expect(workspace).toEqual({ resultsPerSearchType: 90, searchDelay: 700 });
});

test('old Tab order IDs normalize in place while the newer Search order preference carries over', async () => {
  const user: Record<string, unknown> = { tabOrder: ['command', 'file'] };
  const workspace: Record<string, unknown> = { tabOrder: ['folder'], searchOrder: ['Text', 'Files'] };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
    update: async (key: string, value: unknown, target: number) => {
      const values = target === vscode.ConfigurationTarget.Global ? user : workspace;
      if (value === undefined) delete values[key]; else values[key] = value;
    },
  } as any));
  await migrateSearchSettings();
  expect(user).toEqual({ tabOrder: ['Commands', 'Files', 'Everything', 'Folders', 'Text', 'Symbols'] });
  expect(workspace).toEqual({ tabOrder: ['Text', 'Files', 'Everything', 'Folders', 'Symbols', 'Commands'] });
});
