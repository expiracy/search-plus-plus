import { describe, test, expect, mock, beforeEach } from 'bun:test';
import path from 'path';

const FIXTURE_ROOT = path.resolve(import.meta.dir, 'fixtures/mock-project').replace(/\\/g, '/');

// All files in the fixture project (including gitignored ones)
const ALL_FILES = [
  'src/index.ts',
  'src/utils.ts',
  'src/deep/nested/file.ts',
  'lib/helper.js',
  'build/output.js',
  'docs/README.md',
  'data.log',
  '.gitignore',
];

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

  // Return fixture file URIs for findFiles
  base.workspace.findFiles = async () => {
    return ALL_FILES.map((f: string) => base.Uri.file(`${FIXTURE_ROOT}/${f}`));
  };

  return base;
});

const { FileIndex } = await import('../src/index/fileIndex');

// Stub GitIgnoreManager that knows which fixture files are gitignored
const mockGitIgnore = {
  isIgnored(relativePath: string): boolean {
    const p = relativePath.replace(/\\/g, '/');
    return (
      p.startsWith('node_modules/') ||
      p.startsWith('build/') ||
      p.endsWith('.log')
    );
  },
  getExcludeGlob: () => '{**/node_modules/**,**/.git/**}',
  onDidChange: () => ({ dispose() {} }),
  dispose() {},
} as any;

describe('FileIndex', () => {
  let index: InstanceType<typeof FileIndex>;

  beforeEach(async () => {
    index = new FileIndex(mockGitIgnore);
    await index.build();
  });

  test('isReady after build', () => {
    expect(index.isReady).toBe(true);
  });

  test('fileCount matches non-ignored fixture files', () => {
    // 8 total - 2 ignored (build/output.js, data.log) = 6
    expect(index.fileCount).toBe(ALL_FILES.length - 2);
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
    // Searching for "build" with gitignore on should not return build/output.js
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

    const results = index.find('', 1000, true);
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
});
