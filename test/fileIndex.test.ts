import { describe, test, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/mock-project').replace(/\\/g, '/');

// All files in the fixture project (including gitignored ones)
const ALL_FILES = [
  'src/index.ts',
  'src/utils.ts',
  'src/deep/nested/file.ts',
  'src/generated/manual.ts',
  'src/generated/output.gen.ts',
  'lib/helper.js',
  'build/output.js',
  'docs/README.md',
  'docs/guide.pdf',
  'assets/logo.png',
  'assets/icon.ico',
  'assets/font.woff2',
  'data.log',
  '.gitignore',
  '.searchignore',
  'src/.gitignore',
];

// Files that would be excluded by gitignore
function isIgnored(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, '/');
  return (
    p.startsWith('node_modules/') ||
    p.startsWith('build/') ||
    p.endsWith('.log') ||
    p.startsWith('src/generated/')
  );
}

// Files that would be excluded by .searchignore (e.g., docs/ and *.pdf)
function isSearchIgnored(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, '/');
  return p.startsWith('docs/') || p.endsWith('.pdf');
}

const FILTERED_FILES = ALL_FILES.filter((f) => !isIgnored(f));

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

const { Uri } = await import('./__mocks__/vscode');
const { FileIndex } = await import('../src/index/fileIndex');

function makeEntry(relativePath: string) {
  return { relativePath, uri: Uri.file(`${FIXTURE_ROOT}/${relativePath}`) };
}

const mockGitIgnore = {
  isGitIgnored: isIgnored,
  isCustomExcluded: () => false,
  isSearchIgnored: isSearchIgnored,
  getExcludeGlob: () => '{**/node_modules/**,**/.git/**}',
  getCustomExcludePatterns: () => [],
  getSearchIgnorePatterns: () => ['docs/', '*.pdf'],
  onDidChange: () => ({ dispose() {} }),
  dispose() {},
} as any;

describe('FileIndex', () => {
  let index: InstanceType<typeof FileIndex>;

  beforeEach(() => {
    index = new FileIndex(mockGitIgnore);
    const filtered = FILTERED_FILES.map(makeEntry);
    const unfiltered = ALL_FILES.map(makeEntry);
    index.buildFromEntries(filtered, unfiltered);
  });

  test('isReady after build', () => {
    expect(index.isReady).toBe(true);
  });

  test('fileCount matches non-ignored fixture files', () => {
    expect(index.fileCount).toBe(FILTERED_FILES.length);
  });

  test('find("index") matches src/index.ts', () => {
    const results = index.find('index');
    const match = results.find((r) => r.item.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  test('find("utils") matches src/utils.ts', () => {
    const results = index.find('utils');
    const match = results.find((r) => r.item.relativePath === 'src/utils.ts');
    expect(match).toBeDefined();
  });

  test('find("deep") matches src/deep/nested/file.ts', () => {
    const results = index.find('deep');
    const match = results.find((r) => r.item.relativePath === 'src/deep/nested/file.ts');
    expect(match).toBeDefined();
  });

  test('find("helper") matches lib/helper.js', () => {
    const results = index.find('helper');
    const match = results.find((r) => r.item.relativePath === 'lib/helper.js');
    expect(match).toBeDefined();
  });

  test('fuzzy match: find("idx") matches src/index.ts', () => {
    const results = index.find('idx');
    const match = results.find((r) => r.item.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  test('excludeGitIgnored=true filters out build/output.js', () => {
    const results = index.find('output', 200, true);
    const match = results.find((r) => r.item.relativePath === 'build/output.js');
    expect(match).toBeUndefined();
  });

  test('excludeGitIgnored=true filters out data.log', () => {
    const results = index.find('data', 200, true);
    const match = results.find((r) => r.item.relativePath === 'data.log');
    expect(match).toBeUndefined();
  });

  test('excludeGitIgnored=false includes gitignored files', () => {
    const results = index.find('output', 200, false);
    const match = results.find((r) => r.item.relativePath === 'build/output.js');
    expect(match).toBeDefined();
  });

  test('limit parameter caps results', () => {
    const results = index.find('', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('empty query returns files', () => {
    const results = index.find('', 200, false);
    expect(results.length).toBeGreaterThan(0);
  });

  test('no match query returns empty', () => {
    const results = index.find('xyzzy_nonexistent_12345');
    expect(results).toHaveLength(0);
  });

  test('isStale is false after fresh build', () => {
    expect(index.isStale).toBe(false);
  });

  // --- gitignore filtering affects derived folders ---

  test('excludeGitIgnored=true: no results from gitignored directories', () => {
    const results = index.find('build', 200, true);
    const paths = results.map((r) => r.item.relativePath);
    expect(paths.every((p) => !p.startsWith('build/'))).toBe(true);
  });

  test('excludeGitIgnored=false: results from gitignored directories are included', () => {
    const results = index.find('build', 200, false);
    const match = results.find((r) => r.item.relativePath === 'build/output.js');
    expect(match).toBeDefined();
  });

  test('excludeGitIgnored=true: folder extraction from filtered results excludes gitignored folders', async () => {
    const { extractFolders } = await import('../src/providers/folderExtractor');
    const { SearchMode } = await import('../src/providers/types');

    const results = index.find('', 1000, true, false);
    const entries = results.map((r) => r.item);
    const folders = extractFolders(entries, '', SearchMode.Folder);
    const folderPaths = folders.map((f: any) => f.description);

    expect(folderPaths).toContain('src');
    expect(folderPaths).toContain('lib');
    expect(folderPaths).toContain('docs');
    expect(folderPaths).not.toContain('build');
    expect(folderPaths).not.toContain('node_modules');
  });

  test('excludeGitIgnored=false: folder extraction includes gitignored folders', async () => {
    const { extractFolders } = await import('../src/providers/folderExtractor');
    const { SearchMode } = await import('../src/providers/types');

    const results = index.find('', 1000, false);
    const entries = results.map((r) => r.item);
    const folders = extractFolders(entries, '', SearchMode.Folder);
    const folderPaths = folders.map((f: any) => f.description);

    expect(folderPaths).toContain('src');
    expect(folderPaths).toContain('build');
  });

  test('excludeGitIgnored=true: .log files filtered from results', () => {
    const results = index.find('', 1000, true);
    const paths = results.map((r) => r.item.relativePath);
    expect(paths.every((p) => !p.endsWith('.log'))).toBe(true);
  });

  // --- filter() substring search ---

  test('filter("index") matches src/index.ts', () => {
    const results = index.filter('index');
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  test('filter("utils") matches src/utils.ts', () => {
    const results = index.filter('utils');
    const match = results.find((r) => r.relativePath === 'src/utils.ts');
    expect(match).toBeDefined();
  });

  test('filter does NOT fuzzy match: "idx" should not match src/index.ts', () => {
    const results = index.filter('idx');
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeUndefined();
  });

  test('filter is case-insensitive by default', () => {
    const results = index.filter('INDEX');
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  test('filter with caseSensitive=true is case-sensitive', () => {
    const results = index.filter('INDEX', 200, true, true);
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeUndefined();
  });

  test('filter excludeGitIgnored=true filters out gitignored files', () => {
    const results = index.filter('output', 200, true);
    const match = results.find((r) => r.relativePath === 'build/output.js');
    expect(match).toBeUndefined();
  });

  test('filter excludeGitIgnored=false includes gitignored files', () => {
    const results = index.filter('output', 200, false);
    const match = results.find((r) => r.relativePath === 'build/output.js');
    expect(match).toBeDefined();
  });

  test('filter limit caps results', () => {
    const results = index.filter('', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('filter with no matches returns empty', () => {
    const results = index.filter('xyzzy_nonexistent_12345');
    expect(results).toHaveLength(0);
  });

  // --- filter() matchWholeWord ---

  test('filter matchWholeWord=true: "src" matches paths with "src" as a segment', () => {
    const results = index.filter('src', 200, true, false, true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const segments = r.relativePath.toLowerCase().split(/[/\\\-_.]/);
      expect(segments).toContain('src');
    }
  });

  test('filter matchWholeWord=true: "inde" does NOT match src/index.ts', () => {
    const results = index.filter('inde', 200, true, false, true);
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeUndefined();
  });

  test('filter matchWholeWord=true: "index" matches src/index.ts', () => {
    const results = index.filter('index', 200, true, false, true);
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  test('filter matchWholeWord=false: "inde" DOES match src/index.ts', () => {
    const results = index.filter('inde', 200, true, false, false);
    const match = results.find((r) => r.relativePath === 'src/index.ts');
    expect(match).toBeDefined();
  });

  // --- binary / non-text files in index ---

  test('find("logo") matches assets/logo.png', () => {
    const results = index.find('logo', 200, false);
    const match = results.find((r) => r.item.relativePath === 'assets/logo.png');
    expect(match).toBeDefined();
  });

  test('find("icon") matches assets/icon.ico', () => {
    const results = index.find('icon', 200, false);
    const match = results.find((r) => r.item.relativePath === 'assets/icon.ico');
    expect(match).toBeDefined();
  });

  test('find("font") matches assets/font.woff2', () => {
    const results = index.find('font', 200, false);
    const match = results.find((r) => r.item.relativePath === 'assets/font.woff2');
    expect(match).toBeDefined();
  });

  test('find("guide") matches docs/guide.pdf', () => {
    const results = index.find('guide', 200, true, false);
    const match = results.find((r) => r.item.relativePath === 'docs/guide.pdf');
    expect(match).toBeDefined();
  });

  test('filter("png") matches assets/logo.png', () => {
    const results = index.filter('png', 200, false);
    const match = results.find((r) => r.relativePath === 'assets/logo.png');
    expect(match).toBeDefined();
  });

  test('filter("pdf") matches docs/guide.pdf', () => {
    const results = index.filter('pdf', 200, true, false, false, false);
    const match = results.find((r) => r.relativePath === 'docs/guide.pdf');
    expect(match).toBeDefined();
  });

  // --- nested gitignore ---

  test('excludeGitIgnored=true filters out files in nested-gitignored directory', () => {
    const results = index.find('output.gen', 200, true);
    const match = results.find((r) => r.item.relativePath === 'src/generated/output.gen.ts');
    expect(match).toBeUndefined();
  });

  test('excludeGitIgnored=true filters all files in nested-gitignored directory', () => {
    const results = index.find('manual', 200, true);
    const match = results.find((r) => r.item.relativePath === 'src/generated/manual.ts');
    expect(match).toBeUndefined();
  });

  test('excludeGitIgnored=false includes files from nested-gitignored directory', () => {
    const results = index.find('output.gen', 200, false);
    const match = results.find((r) => r.item.relativePath === 'src/generated/output.gen.ts');
    expect(match).toBeDefined();
  });

  // --- excludeGitIgnored combinations ---

  test('excludeGitIgnored=false includes all files', () => {
    const results = index.find('', 1000, false, false);
    expect(results.length).toBe(ALL_FILES.length);
  });

  test('excludeGitIgnored=true excludes gitignored but includes non-ignored', () => {
    const results = index.find('', 1000, true);
    const paths = results.map((r) => r.item.relativePath);
    expect(paths).toContain('assets/logo.png');
    expect(paths).not.toContain('build/output.js');
  });

  // --- searchignore filtering ---

  test('excludeSearchIgnored=true filters out docs/ files', () => {
    const results = index.find('README', 200, true, true);
    const match = results.find((r) => r.item.relativePath === 'docs/README.md');
    expect(match).toBeUndefined();
  });

  test('excludeSearchIgnored=true filters out .pdf files', () => {
    const results = index.find('guide', 200, true, true);
    const match = results.find((r) => r.item.relativePath === 'docs/guide.pdf');
    expect(match).toBeUndefined();
  });

  test('excludeSearchIgnored=false includes docs/ files', () => {
    const results = index.find('README', 200, true, false);
    const match = results.find((r) => r.item.relativePath === 'docs/README.md');
    expect(match).toBeDefined();
  });

  test('excludeSearchIgnored=false includes .pdf files', () => {
    const results = index.find('guide', 200, true, false);
    const match = results.find((r) => r.item.relativePath === 'docs/guide.pdf');
    expect(match).toBeDefined();
  });

  test('searchignore and gitignore work independently', () => {
    // gitignore off, searchignore on: gitignored files visible, searchignored hidden
    const results1 = index.find('', 1000, false, true);
    const paths1 = results1.map((r) => r.item.relativePath);
    expect(paths1).toContain('build/output.js');
    expect(paths1).not.toContain('docs/README.md');

    // gitignore on, searchignore off: gitignored files hidden, searchignored visible
    const results2 = index.find('', 1000, true, false);
    const paths2 = results2.map((r) => r.item.relativePath);
    expect(paths2).not.toContain('build/output.js');
    expect(paths2).toContain('docs/README.md');
  });

  test('filter excludeSearchIgnored=true filters out searchignored files', () => {
    const results = index.filter('README', 200, true, false, false, true);
    const match = results.find((r) => r.relativePath === 'docs/README.md');
    expect(match).toBeUndefined();
  });

  test('filter excludeSearchIgnored=false includes searchignored files', () => {
    const results = index.filter('README', 200, true, false, false, false);
    const match = results.find((r) => r.relativePath === 'docs/README.md');
    expect(match).toBeDefined();
  });
});
