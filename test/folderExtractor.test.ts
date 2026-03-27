import { describe, test, expect, mock } from 'bun:test';

mock.module('vscode', () => import('./__mocks__/vscode'));

const { extractFolders } = await import('../src/providers/folderExtractor');
const { SearchMode, ResultSection } = await import('../src/providers/types');
const { Uri } = await import('./__mocks__/vscode');

function makeEntry(relativePath: string) {
  return { relativePath, uri: Uri.file(`/workspace/${relativePath}`) };
}

describe('extractFolders', () => {
  test('extracts top-level folder from a nested path', () => {
    const entries = [makeEntry('src/index.ts')];
    const results = extractFolders(entries, '', SearchMode.Folder);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('src');
    expect(results[0].label).toBe('src');
  });

  test('extracts all ancestor folders from deeply nested path', () => {
    const entries = [makeEntry('src/deep/nested/file.ts')];
    const results = extractFolders(entries, '', SearchMode.Folder);
    const descriptions = results.map((r: any) => r.description);
    expect(descriptions).toEqual(['src', 'src/deep', 'src/deep/nested']);
  });

  test('deduplicates shared folder paths across entries', () => {
    const entries = [
      makeEntry('src/index.ts'),
      makeEntry('src/utils.ts'),
      makeEntry('src/deep/nested/file.ts'),
    ];
    const results = extractFolders(entries, '', SearchMode.Folder);
    const descriptions = results.map((r: any) => r.description);
    // "src" should appear only once
    expect(descriptions.filter((d: string) => d === 'src')).toHaveLength(1);
  });

  test('filters by case-insensitive substring query', () => {
    const entries = [
      makeEntry('src/index.ts'),
      makeEntry('lib/helper.js'),
      makeEntry('docs/README.md'),
    ];
    const results = extractFolders(entries, 'LIB', SearchMode.Folder);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('lib');
  });

  test('query matching no folders returns empty array', () => {
    const entries = [makeEntry('src/index.ts')];
    const results = extractFolders(entries, 'zzz', SearchMode.Folder);
    expect(results).toHaveLength(0);
  });

  test('root-level files produce no folders', () => {
    const entries = [makeEntry('README.md')];
    const results = extractFolders(entries, '', SearchMode.Folder);
    expect(results).toHaveLength(0);
  });

  test('results have correct properties', () => {
    const entries = [makeEntry('src/index.ts')];
    const results = extractFolders(entries, '', SearchMode.Folder);
    const r = results[0];
    expect(r.isFolder).toBe(true);
    expect(r.belongsToSection).toBe(ResultSection.Folders);
    expect(r.alwaysShow).toBe(true);
    expect(r.mode).toBe(SearchMode.Folder);
  });

  test('empty query matches all folders', () => {
    const entries = [
      makeEntry('src/index.ts'),
      makeEntry('lib/helper.js'),
    ];
    const results = extractFolders(entries, '', SearchMode.Folder);
    expect(results).toHaveLength(2);
  });

  test('partial substring matches folder path', () => {
    const entries = [makeEntry('src/deep/nested/file.ts')];
    const results = extractFolders(entries, 'deep', SearchMode.Folder);
    const descriptions = results.map((r: any) => r.description);
    // "src/deep" and "src/deep/nested" both contain "deep"
    expect(descriptions).toContain('src/deep');
    expect(descriptions).toContain('src/deep/nested');
    // "src" alone does not contain "deep"
    expect(descriptions).not.toContain('src');
  });

  test('gitignored folders do not appear when their files are excluded from input', () => {
    // Simulate what happens when excludeGitIgnored=true filters out build/ files
    const entries = [
      makeEntry('src/index.ts'),
      makeEntry('src/utils.ts'),
      makeEntry('lib/helper.js'),
      // build/output.js is NOT here — already filtered by FileIndex
    ];
    const results = extractFolders(entries, '', SearchMode.Folder);
    const descriptions = results.map((r: any) => r.description);
    expect(descriptions).toContain('src');
    expect(descriptions).toContain('lib');
    expect(descriptions).not.toContain('build');
  });

  test('gitignored folders appear when their files are included in input', () => {
    // Simulate what happens when excludeGitIgnored=false
    const entries = [
      makeEntry('src/index.ts'),
      makeEntry('build/output.js'),
      makeEntry('node_modules/fake-dep/index.js'),
    ];
    const results = extractFolders(entries, '', SearchMode.Folder);
    const descriptions = results.map((r: any) => r.description);
    expect(descriptions).toContain('src');
    expect(descriptions).toContain('build');
    expect(descriptions).toContain('node_modules');
    expect(descriptions).toContain('node_modules/fake-dep');
  });
});
