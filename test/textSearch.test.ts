import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import path from 'path';

const FIXTURE_ROOT = path.resolve(import.meta.dir, 'fixtures/mock-project').replace(/\\/g, '/');

// Configure vscode mock
mock.module('vscode', () => {
  const base = require('./__mocks__/vscode');
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
  options: { caseSensitive: boolean; useRegex: boolean; excludeGitIgnored: boolean; maxResults: number },
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
});
