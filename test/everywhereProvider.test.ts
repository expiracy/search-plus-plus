import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { EverywhereProvider } = await import('../src/providers/everywhereProvider');
const { SearchMode } = await import('../src/providers/types');
const options = { fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
afterEach(() => vi.restoreAllMocks());

test('a failed text section reports its error while preserving file results', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'everywhere.sections' ? ['files', 'text'] : undefined }), get: (key: string, fallback: unknown) => key === 'everywhere.sections' ? ['files', 'text'] : fallback } as any);
  const file = { label: 'file.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/file.ts') };
  const files = { search: (_q: string, _o: unknown, publish: (r: any[]) => void) => { publish([file]); return { dispose() {} }; } };
  const text = { search: (_q: string, _o: unknown, _publish: unknown, fail?: (e: unknown) => void) => { fail?.(new Error('ripgrep unavailable')); return { dispose() {} }; } };
  const unused = { search: () => ({ dispose() {} }) };
  const provider = new EverywhereProvider(files as any, unused as any, text as any, unused as any, unused as any);
  const publish = vi.fn();
  const request = provider.search('file', options, publish);
  try {
    await new Promise(setImmediate);
    const results = publish.mock.lastCall![0];
    expect(results.some((r: any) => r.label === 'file.ts')).toBe(true);
    expect(results.some((r: any) => r.description?.includes('ripgrep unavailable'))).toBe(true);
  } finally { request.dispose(); }
});

test('disabling every section still settles the search with an empty result', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: (key: string) => ({ globalValue: key === 'everywhere.sections' ? [] : undefined }), get: (key: string, fallback: unknown) => key === 'everywhere.sections' ? [] : fallback } as any);
  const unused = { search: vi.fn(() => ({ dispose() {} })) };
  const publish = vi.fn();
  const request = new EverywhereProvider(unused as any, unused as any, unused as any, unused as any, unused as any).search('file', options, publish);
  try {
    await new Promise(setImmediate);
    expect(publish).toHaveBeenCalledWith([]);
    expect(unused.search).not.toHaveBeenCalled();
  } finally { request.dispose(); }
});

test('the Everything source checkboxes control which searches run', async () => {
  const settings: Record<string, unknown> = {
    'everything.sources': { Files: false, Folders: true, Symbols: false, Text: false, Commands: false },
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  const disabled = { search: vi.fn(() => ({ dispose() {} })) };
  const folders = { search: vi.fn((_q: string, _o: unknown, publish: (items: any[]) => void) => {
    publish([{ label: 'src', mode: SearchMode.Folder }]); return { dispose() {} };
  }) };
  const publish = vi.fn();
  const request = new EverywhereProvider(disabled as any, folders as any, disabled as any, disabled as any, disabled as any).search('src', options, publish);
  try {
    await new Promise(setImmediate);
    expect(disabled.search).not.toHaveBeenCalled();
    expect(folders.search).toHaveBeenCalledOnce();
    expect(publish.mock.lastCall![0].map((item: any) => item.belongsToSection)).toEqual(['folders']);
  } finally { request.dispose(); }
});

test('Everything ordering is independent of which sources are checked', async () => {
  vi.useFakeTimers();
  const settings: Record<string, unknown> = {
    'everything.sources': { Files: true, Folders: false, Symbols: false, Text: true, Commands: false },
    'everything.order': ['Text', 'Files', 'Folders', 'Symbols', 'Commands'],
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  const section = (mode: string) => ({ search: (_q: string, _o: unknown, publish: (items: any[]) => void) => {
    publish([{ label: mode, mode }]); return { dispose() {} };
  } });
  const unused = { search: vi.fn(() => ({ dispose() {} })) };
  const publish = vi.fn();
  const request = new EverywhereProvider(section(SearchMode.File) as any, unused as any, section(SearchMode.Text) as any, unused as any, unused as any).search('match', options, publish);
  try {
    await vi.runAllTimersAsync();
    expect(publish.mock.lastCall![0].map((item: any) => item.belongsToSection)).toEqual(['text', 'files']);
    expect(unused.search).not.toHaveBeenCalled();
  } finally { request.dispose(); vi.useRealTimers(); }
});

test('checkboxes can enable a source omitted by the older section list', async () => {
  const settings: Record<string, unknown> = {
    'everywhere.sections': ['files'],
    'everything.sources': { Files: false, Folders: true, Symbols: false, Text: false, Commands: false },
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  const disabled = { search: vi.fn(() => ({ dispose() {} })) };
  const folders = { search: vi.fn((_q: string, _o: unknown, publish: (items: any[]) => void) => {
    publish([{ label: 'src', mode: SearchMode.Folder }]); return { dispose() {} };
  }) };
  const publish = vi.fn();
  const request = new EverywhereProvider(disabled as any, folders as any, disabled as any, disabled as any, disabled as any).search('src', options, publish);
  try {
    await new Promise(setImmediate);
    expect(folders.search).toHaveBeenCalledOnce();
    expect(disabled.search).not.toHaveBeenCalled();
    expect(publish.mock.lastCall![0].map((item: any) => item.belongsToSection)).toEqual(['folders']);
  } finally { request.dispose(); }
});

test('older workspace section choices override new source preferences in User settings', async () => {
  const user: Record<string, unknown> = { 'everything.sources': { Files: false, Folders: false, Symbols: false, Text: false, Commands: false } };
  const workspace: Record<string, unknown> = { 'everywhere.sections': ['files'] };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
  } as any);
  const files = { search: vi.fn((_q: string, _o: unknown, publish: (items: any[]) => void) => {
    publish([{ label: 'file.ts', mode: SearchMode.File }]); return { dispose() {} };
  }) };
  const unused = { search: vi.fn(() => ({ dispose() {} })) };
  const publish = vi.fn();
  const request = new EverywhereProvider(files as any, unused as any, unused as any, unused as any, unused as any).search('file', options, publish);
  try {
    await new Promise(setImmediate);
    expect(files.search).toHaveBeenCalledOnce();
    expect(unused.search).not.toHaveBeenCalled();
    expect(publish.mock.lastCall![0].map((item: any) => item.belongsToSection)).toEqual(['files']);
  } finally { request.dispose(); }
});

test('unchecking all Everything sources finishes without starting any searches', () => {
  const settings: Record<string, unknown> = {
    'everything.sources': { Files: false, Folders: false, Symbols: false, Text: false, Commands: false },
  };
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: settings[key] }),
  } as any);
  const unused = { search: vi.fn(() => ({ dispose() {} })) };
  const publish = vi.fn();
  const request = new EverywhereProvider(unused as any, unused as any, unused as any, unused as any, unused as any).search('file', options, publish);
  try {
    expect(publish).toHaveBeenCalledExactlyOnceWith([]);
    expect(unused.search).not.toHaveBeenCalled();
  } finally { request.dispose(); }
});


test('late symbol results appear before text in the default Everything groups', async () => {
  vi.useFakeTimers();
  const section = (mode: string) => ({ search: (_query: string, _options: unknown, publish: (results: any[]) => void) => { publish([{ label: mode, mode }]); return { dispose() {} }; } });
  const publish = vi.fn();
  const request = new EverywhereProvider(section(SearchMode.File) as any, section(SearchMode.Folder) as any, section(SearchMode.Text) as any, section(SearchMode.Symbol) as any, section(SearchMode.Command) as any).search('match', options, publish);
  try {
    await vi.runAllTimersAsync();
    expect(publish.mock.lastCall![0].map((item: any) => item.belongsToSection)).toEqual(['files', 'folders', 'symbols', 'text', 'commands']);
  } finally { request.dispose(); vi.useRealTimers(); }
});
