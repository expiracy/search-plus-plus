import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { FileIndex } = await import('../src/index/fileIndex');
const { FolderProvider } = await import('../src/providers/folderProvider');
const rules = { isGitIgnored: () => false, isSearchIgnored: () => false, isCustomExcluded: () => false } as any;
const options = {
  fuzzySearch: true, caseSensitive: false, useRegex: false, matchWholeWord: false,
  excludeGitIgnored: true, excludeSearchIgnored: true,
};
afterEach(() => { vi.restoreAllMocks(); });

test('fuzzy folder matching operates on folder paths rather than requiring a substring', () => {
  const index = new FileIndex(rules);
  index.buildFromEntries([{ relativePath: 'src/components/App.tsx', uri: vscode.Uri.file('/workspace/src/components/App.tsx') }]);
  try {
    const provider = new FolderProvider(index);
    let results: any[] = [];
    provider.search('scmp', options, value => { results = value; });
    expect(results.map(r => r.description)).toContain('src/components');
  } finally { index.dispose(); }
});

test('folder URIs and deduplication remain correct across workspace roots', () => {
  vi.spyOn(vscode.workspace, 'getWorkspaceFolder').mockImplementation(uri => ({
    uri: vscode.Uri.file(uri.fsPath.startsWith('/alpha/') ? '/alpha' : '/beta'), name: '', index: 0,
  }));
  const index = new FileIndex(rules);
  index.buildFromEntries(['alpha', 'beta'].map(root => ({
    relativePath: `${root}/src/index.ts`, uri: vscode.Uri.file(`/${root}/src/index.ts`),
  })));
  try {
    let results: any[] = [];
    new FolderProvider(index).search('src', options, value => { results = value; });
    expect(results.map(r => r.uri.fsPath).sort()).toEqual(['/alpha/src', '/beta/src']);
  } finally { index.dispose(); }
});
