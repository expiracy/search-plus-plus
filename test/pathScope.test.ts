import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { FileIndex } = await import('../src/index/fileIndex');
const { FileProvider } = await import('../src/providers/fileProvider');
const rules = { isGitIgnored: () => false, isSearchIgnored: () => false, isCustomExcluded: () => false } as any;
const options = { fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
let index: InstanceType<typeof FileIndex>;
afterEach(() => { index?.dispose(); vi.restoreAllMocks(); });

test('file scope is applied before the result limit', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 1 : fallback } as any);
  index = new FileIndex(rules);
  index.buildFromEntries(['a/index.ts', 'src/index.ts'].map(relativePath => ({ relativePath, uri: vscode.Uri.file(`/workspace/${relativePath}`) })));
  let results: any[] = [];
  new FileProvider(index).search('index', { ...options, pathFilter: (uri: any) => uri.path.startsWith('/workspace/src/') }, value => { results = value; });
  expect(results.map(result => result.description)).toEqual(['src/index.ts']);
});

test('fuzzy file scope is applied before the result limit', () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 1 : fallback } as any);
  index = new FileIndex(rules);
  index.buildFromEntries(['a/index.ts', 'src/index.ts'].map(relativePath => ({ relativePath, uri: vscode.Uri.file(`/workspace/${relativePath}`) })));
  let results: any[] = [];
  new FileProvider(index).search('idx', { ...options, fuzzySearch: true, pathFilter: (uri: any) => uri.path.startsWith('/workspace/src/') }, value => { results = value; });
  expect(results.map(result => result.description)).toEqual(['src/index.ts']);
});

test('folder scope filters folder paths before the result limit', async () => {
  const { FolderProvider } = await import('../src/providers/folderProvider');
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 1 : fallback } as any);
  index = new FileIndex(rules);
  index.buildFromEntries(['a/index.ts', 'src/index.ts'].map(relativePath => ({ relativePath, uri: vscode.Uri.file(`/workspace/${relativePath}`) })));
  let results: any[] = [];
  new FolderProvider(index).search('', { ...options, pathFilter: (uri: any) => uri.path === '/workspace/src' }, value => { results = value; });
  expect(results.map(result => result.uri.path)).toEqual(['/workspace/src']);
});

test('symbols outside the scope cannot consume the result limit', async () => {
  const { SymbolProvider } = await import('../src/providers/symbolProvider');
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 1 : fallback } as any);
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(['a', 'src'].map(folder => ({ name: 'index', kind: 11, location: { uri: vscode.Uri.file(`/workspace/${folder}/index.ts`), range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)) } })) as any);
  const results = await new Promise<any[]>(resolve => new SymbolProvider({ shouldExclude: () => false } as any).search('index', { ...options, pathFilter: (uri: any) => uri.path.startsWith('/workspace/src/') }, resolve));
  expect(results.map(result => result.uri.path)).toEqual(['/workspace/src/index.ts']);
});
