import { describe, test, expect, vi, beforeEach } from 'vitest';

// Symbol names the mock workspace symbol provider returns for any query,
// mimicking VS Code's case-insensitive fuzzy matching for "path"
const SYMBOL_NAMES = ['path', 'Path', 'AddPathMode', 'test_path', 'filePath', 'getPath'];

vi.doMock('vscode', async () => {
  const base: any = await import('./__mocks__/vscode');

  base.commands.executeCommand = async (command: string) => {
    if (command !== 'vscode.executeWorkspaceSymbolProvider') return undefined;
    return SYMBOL_NAMES.map((name) => ({
      name,
      kind: base.SymbolKind.Function,
      containerName: '',
      location: {
        uri: base.Uri.file(`/repo/src/${name}.ts`),
        range: { start: { line: 0, character: 0 } },
      },
    }));
  };

  return base;
});

const { SymbolProvider } = await import('../src/providers/symbolProvider');

const mockGitIgnore = {
  shouldExclude: () => false,
} as any;

const baseOptions = {
  excludeGitIgnored: true,
  excludeSearchIgnored: true,
  caseSensitive: false,
  useRegex: false,
  fuzzySearch: false,
  matchWholeWord: false,
};

function searchAsync(provider: InstanceType<typeof SymbolProvider>, query: string, options: typeof baseOptions): Promise<string[]> {
  return new Promise((resolve) => {
    provider.search(query, options, (results) => {
      // Labels look like "$(symbol-function) name"; extract the name
      resolve(results.map((r) => r.label.replace(/^\$\([^)]*\)\s*/, '')));
    });
  });
}

describe('SymbolProvider match options', () => {
  let provider: InstanceType<typeof SymbolProvider>;

  beforeEach(() => {
    provider = new SymbolProvider(mockGitIgnore);
  });

  test('default (substring, case-insensitive): keeps symbols containing "path"', async () => {
    const names = await searchAsync(provider, 'path', baseOptions);
    expect(names).toContain('path');
    expect(names).toContain('AddPathMode');
    expect(names).toContain('filePath');
  });

  test('matchCase: "path" excludes AddPathMode and Path', async () => {
    const names = await searchAsync(provider, 'path', { ...baseOptions, caseSensitive: true });
    expect(names).toContain('path');
    expect(names).toContain('test_path');
    expect(names).not.toContain('AddPathMode');
    expect(names).not.toContain('Path');
    expect(names).not.toContain('filePath');
  });

  test('wholeWord: "path" excludes partial-word symbols', async () => {
    const names = await searchAsync(provider, 'path', { ...baseOptions, matchWholeWord: true });
    expect(names).toContain('path');
    expect(names).toContain('Path'); // case-insensitive without matchCase
    expect(names).not.toContain('AddPathMode');
    expect(names).not.toContain('test_path'); // underscore is a word char
    expect(names).not.toContain('filePath');
  });

  test('matchCase + wholeWord: only exact "path" survives', async () => {
    const names = await searchAsync(provider, 'path', {
      ...baseOptions, caseSensitive: true, matchWholeWord: true,
    });
    expect(names).toEqual(['path']);
  });

  test('fuzzy + matchCase: exact-case subsequence required', async () => {
    const names = await searchAsync(provider, 'Path', {
      ...baseOptions, fuzzySearch: true, caseSensitive: true,
    });
    expect(names).toContain('Path');
    expect(names).toContain('AddPathMode');
    expect(names).toContain('filePath');
    expect(names).not.toContain('path');
    expect(names).not.toContain('test_path');
  });

  test('fuzzy without toggles: provider results pass through', async () => {
    const names = await searchAsync(provider, 'path', { ...baseOptions, fuzzySearch: true });
    expect(names).toEqual(SYMBOL_NAMES);
  });
});
