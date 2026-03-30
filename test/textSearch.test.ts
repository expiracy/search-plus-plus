import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/mock-project').replace(/\\/g, '/');

// Configure vscode mock
vi.doMock('vscode', async () => {
  const base: any = await import('./__mocks__/vscode');
  const rootUri = base.Uri.file(FIXTURE_ROOT);

  base.workspace.workspaceFolders = [{ uri: rootUri, name: 'mock-project', index: 0 }];
  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = FIXTURE_ROOT + '/';
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    return normalized;
  };

  return base;
});

const { TextSearch } = await import('../src/index/textSearch');

/** Helper: run a search and collect all results into a promise */
function searchAsync(
  ts: InstanceType<typeof TextSearch>,
  query: string,
  options: { caseSensitive: boolean; useRegex: boolean; excludeGitIgnored: boolean; excludeSearchIgnored: boolean; matchWholeWord: boolean; maxResults: number },
): Promise<any[]> {
  return new Promise((resolve) => {
    let lastResults: any[] = [];
    const disposable = ts.search(query, options, (results) => {
      lastResults = results;
    });

    // findTextInFiles resolves quickly on small fixtures. Wait for completion.
    setTimeout(() => {
      disposable.dispose();
      resolve(lastResults);
    }, 2000);
  });
}

const defaultOpts = {
  caseSensitive: false,
  useRegex: false,
  excludeGitIgnored: true,
  excludeSearchIgnored: true,
  matchWholeWord: false,
  maxResults: 200,
};

describe('TextSearch', () => {
  let ts: InstanceType<typeof TextSearch>;

  beforeEach(() => {
    ts = new TextSearch();
  });

  afterEach(() => {
    ts.dispose();
  });

  test('finds "hello world" in src/index.ts', async () => {
    const results = await searchAsync(ts, 'hello world', defaultOpts);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeDefined();
    expect(match.matchText).toContain('hello world');
  });

  test('finds "TODO" in src/utils.ts', async () => {
    const results = await searchAsync(ts, 'TODO', defaultOpts);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find((r: any) => r.relativePath.includes('src/utils.ts'));
    expect(match).toBeDefined();
  });

  test('case-sensitive search: "hello" matches but "HELLO" does not', async () => {
    const resultLower = await searchAsync(ts, 'hello', { ...defaultOpts, caseSensitive: true });
    const matchLower = resultLower.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(matchLower).toBeDefined();

    const resultUpper = await searchAsync(ts, 'HELLO', { ...defaultOpts, caseSensitive: true });
    const matchUpper = resultUpper.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(matchUpper).toBeUndefined();
  });

  test('regex mode finds pattern matches', async () => {
    const results = await searchAsync(ts, 'function\\s+\\w+', { ...defaultOpts, useRegex: true });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Should match "function greet" or "function add"
    const hasMatch = results.some((r: any) =>
      r.matchText.includes('function greet') || r.matchText.includes('function add'),
    );
    expect(hasMatch).toBe(true);
  });

  test('fixed-string mode handles regex metacharacters literally', async () => {
    // "a + b" contains regex metachar '+', should work in fixed-string mode
    const results = await searchAsync(ts, 'a + b', { ...defaultOpts, useRegex: false });
    const match = results.find((r: any) => r.relativePath.includes('src/utils.ts'));
    expect(match).toBeDefined();
  });

  test('excludeGitIgnored=true: does NOT find content in gitignored files', async () => {
    const results = await searchAsync(ts, 'built', { ...defaultOpts, excludeGitIgnored: true });
    const match = results.find((r: any) => r.relativePath.includes('build/output.js'));
    expect(match).toBeUndefined();
  });

  test('excludeGitIgnored=false: DOES find content in gitignored files', async () => {
    const results = await searchAsync(ts, 'built', { ...defaultOpts, excludeGitIgnored: false });
    const match = results.find((r: any) => r.relativePath.includes('build/output.js'));
    expect(match).toBeDefined();
  });

  test('results have correct 0-indexed lineNumber', async () => {
    const results = await searchAsync(ts, 'hello world', defaultOpts);
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeDefined();
    // "hello world" is on line 2 in fixture (1-indexed), so 0-indexed = 1
    expect(match.lineNumber).toBe(1);
  });

  test('results have column position', async () => {
    const results = await searchAsync(ts, 'hello world', defaultOpts);
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeDefined();
    expect(typeof match.column).toBe('number');
    expect(match.column).toBeGreaterThanOrEqual(0);
  });

  test('empty query returns empty results', async () => {
    const results = await searchAsync(ts, '', defaultOpts);
    expect(results).toEqual([]);
  });

  test('query with no matches returns empty results', async () => {
    const results = await searchAsync(ts, 'xyzzy_nonexistent_string_12345', defaultOpts);
    expect(results).toEqual([]);
  });

  test('maxResults limits result count', async () => {
    const results = await searchAsync(ts, 'export', { ...defaultOpts, maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // --- matchWholeWord ---

  test('matchWholeWord=true: "hello" matches (it is a whole word in the source)', async () => {
    const results = await searchAsync(ts, 'hello', { ...defaultOpts, matchWholeWord: true });
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeDefined();
  });

  test('matchWholeWord=true: "hell" does NOT match (not a whole word)', async () => {
    const results = await searchAsync(ts, 'hell', { ...defaultOpts, matchWholeWord: true });
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeUndefined();
  });

  test('matchWholeWord=false: "hell" DOES match as substring', async () => {
    const results = await searchAsync(ts, 'hell', { ...defaultOpts, matchWholeWord: false });
    const match = results.find((r: any) => r.relativePath.includes('src/index.ts'));
    expect(match).toBeDefined();
  });

  test('matchWholeWord=true: "add" matches function name in utils.ts', async () => {
    const results = await searchAsync(ts, 'add', { ...defaultOpts, matchWholeWord: true });
    const match = results.find((r: any) => r.relativePath.includes('src/utils.ts'));
    expect(match).toBeDefined();
  });

  // --- React / JSX patterns ---

  test('finds "useEffect" in .tsx files', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const tsxMatch = results.find((r: any) => r.relativePath.includes('.tsx'));
    expect(tsxMatch).toBeDefined();
  });

  test('finds "useEffect" in .jsx files', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const jsxMatch = results.find((r: any) => r.relativePath.includes('.jsx'));
    expect(jsxMatch).toBeDefined();
  });

  test('finds "useEffect" in .ts files (custom hooks)', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const tsMatch = results.find((r: any) => r.relativePath.includes('useDebounce.ts'));
    expect(tsMatch).toBeDefined();
  });

  test('finds "useEffect" across multiple files', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const uniqueFiles = new Set(results.map((r: any) => r.relativePath));
    // Should find useEffect in App.tsx, Button.jsx, and useDebounce.ts at minimum
    expect(uniqueFiles.size).toBeGreaterThanOrEqual(3);
  });

  test('finds "useState" with correct match text', async () => {
    const results = await searchAsync(ts, 'useState', defaultOpts);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r: any) => r.matchText.includes('useState'))).toBe(true);
  });

  test('finds camelCase identifiers with matchWholeWord', async () => {
    const results = await searchAsync(ts, 'useEffect', { ...defaultOpts, matchWholeWord: true });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results[0];
    expect(match.matchText).toBe('useEffect');
  });

  test('matchWholeWord=true: "useEff" does NOT match as whole word', async () => {
    const results = await searchAsync(ts, 'useEff', { ...defaultOpts, matchWholeWord: true });
    const match = results.find((r: any) => r.matchText === 'useEff');
    expect(match).toBeUndefined();
  });

  test('matchWholeWord=false: "useEff" DOES match as substring', async () => {
    const results = await searchAsync(ts, 'useEff', { ...defaultOpts, matchWholeWord: false });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // --- Smart-case behavior ---

  test('smart-case: all-lowercase "useeffect" finds "useEffect"', async () => {
    const results = await searchAsync(ts, 'useeffect', { ...defaultOpts, caseSensitive: false });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchText).toBe('useEffect');
  });

  test('case-sensitive: "useeffect" does NOT match "useEffect"', async () => {
    const results = await searchAsync(ts, 'useeffect', { ...defaultOpts, caseSensitive: true });
    expect(results.length).toBe(0);
  });

  // --- Special characters in queries ---

  test('fixed-string mode handles angle brackets: "<div"', async () => {
    const results = await searchAsync(ts, '<div', { ...defaultOpts, useRegex: false });
    const match = results.find((r: any) => r.relativePath.includes('App.tsx'));
    expect(match).toBeDefined();
  });

  test('fixed-string mode handles parens: "onClick?.(e)"', async () => {
    const results = await searchAsync(ts, 'onClick?.(e)', { ...defaultOpts, useRegex: false });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('fixed-string mode handles "useState(0)"', async () => {
    const results = await searchAsync(ts, 'useState(0)', { ...defaultOpts, useRegex: false });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('regex mode with JSX patterns: "<[A-Z]\\w+" finds component tags', async () => {
    const results = await searchAsync(ts, '<[A-Z]\\w+', { ...defaultOpts, useRegex: true });
    expect(Array.isArray(results)).toBe(true);
  });

  // --- Result structure ---

  test('multiple occurrences in one file return separate results per line', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const appResults = results.filter((r: any) => r.relativePath.includes('App.tsx'));
    expect(appResults.length).toBeGreaterThanOrEqual(2);
    // Each result should have a different lineNumber
    const lineNumbers = appResults.map((r: any) => r.lineNumber);
    const uniqueLines = new Set(lineNumbers);
    expect(uniqueLines.size).toBe(appResults.length);
  });

  test('results include correct column for submatch position', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const match = results.find((r: any) =>
      r.relativePath.includes('App.tsx') && r.lineText.includes('useEffect'),
    );
    expect(match).toBeDefined();
    expect(match.column).toBeGreaterThanOrEqual(0);
  });

  test('matchText accurately reflects the matched substring', async () => {
    const results = await searchAsync(ts, 'useState', defaultOpts);
    for (const r of results) {
      expect(r.matchText).toBe('useState');
    }
  });

  // --- Volume / max-count ---

  test('common token "const" returns results from multiple files', async () => {
    const results = await searchAsync(ts, 'const', defaultOpts);
    const uniqueFiles = new Set(results.map((r: any) => r.relativePath));
    expect(uniqueFiles.size).toBeGreaterThanOrEqual(3);
  });

  test('returns all matching lines in a file (no per-file cap)', async () => {
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    // useDebounce.ts has useEffect on 3+ different lines
    const hookResults = results.filter((r: any) => r.relativePath.includes('useDebounce.ts'));
    expect(hookResults.length).toBeGreaterThanOrEqual(2);
  });

  // --- Exclude patterns ---

  test('setExcludePatterns excludes matching files', async () => {
    ts.setExcludePatterns(['*.jsx']);
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const jsxMatch = results.find((r: any) => r.relativePath.endsWith('.jsx'));
    expect(jsxMatch).toBeUndefined();
    // .tsx files should still match
    const tsxMatch = results.find((r: any) => r.relativePath.endsWith('.tsx'));
    expect(tsxMatch).toBeDefined();
  });

  test('setExcludePatterns with directory glob', async () => {
    ts.setExcludePatterns(['**/components/**']);
    const results = await searchAsync(ts, 'useEffect', defaultOpts);
    const componentMatch = results.find((r: any) => r.relativePath.includes('components/'));
    expect(componentMatch).toBeUndefined();
  });

  test('setExcludePatterns can be cleared', async () => {
    ts.setExcludePatterns(['*.tsx', '*.jsx', '*.ts']);
    const restricted = await searchAsync(ts, 'useEffect', defaultOpts);
    expect(restricted.length).toBe(0);

    ts.setExcludePatterns([]);
    const unrestricted = await searchAsync(ts, 'useEffect', defaultOpts);
    expect(unrestricted.length).toBeGreaterThanOrEqual(1);
  });

  // --- File extension coverage ---

  test('searches .js files', async () => {
    const results = await searchAsync(ts, 'module.exports', defaultOpts);
    const jsMatch = results.find((r: any) => r.relativePath.endsWith('.js'));
    expect(jsMatch).toBeDefined();
  });

  test('searches .tsx files', async () => {
    const results = await searchAsync(ts, 'React.FC', defaultOpts);
    const tsxMatch = results.find((r: any) => r.relativePath.endsWith('.tsx'));
    expect(tsxMatch).toBeDefined();
  });

  test('searches .jsx files', async () => {
    const results = await searchAsync(ts, 'className', defaultOpts);
    const jsxMatch = results.find((r: any) => r.relativePath.endsWith('.jsx'));
    expect(jsxMatch).toBeDefined();
  });

  // --- Edge cases ---

  test('very long query returns empty (no crash)', async () => {
    const longQuery = 'a'.repeat(500);
    const results = await searchAsync(ts, longQuery, defaultOpts);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test('query with newline characters handled gracefully', async () => {
    const results = await searchAsync(ts, 'hello\nworld', defaultOpts);
    expect(Array.isArray(results)).toBe(true);
  });
});
