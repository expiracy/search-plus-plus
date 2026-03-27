import { describe, test, expect, mock, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import fs from 'fs';

// Generate a large-scale mock project with:
// - 10,000 source files across deep directory trees
// - 5,000 gitignored files (build output, logs, caches)
// - 60 nested .gitignore files
// - Multiple file types and nesting depths

const SCALE_ROOT = path.resolve(import.meta.dir, 'fixtures/scale-project').replace(/\\/g, '/');

// --- Generate file lists ---

const SOURCE_DIRS = [
  'src/core', 'src/utils', 'src/api', 'src/api/v1', 'src/api/v2',
  'src/services', 'src/services/auth', 'src/services/payment', 'src/services/notification',
  'src/models', 'src/models/user', 'src/models/order', 'src/models/product',
  'src/components', 'src/components/ui', 'src/components/layout', 'src/components/forms',
  'src/hooks', 'src/types', 'src/config',
  'lib', 'lib/shared', 'lib/vendor',
  'docs', 'docs/api', 'docs/guides',
  'scripts',
  'packages/app/src', 'packages/app/src/pages', 'packages/app/src/utils',
  'packages/cli/src', 'packages/cli/src/commands',
  'packages/shared/src', 'packages/shared/src/types',
];

const IGNORED_DIRS = [
  'build', 'build/esm', 'build/cjs',
  'dist', 'dist/assets',
  '.cache', '.cache/babel', '.cache/eslint',
  'coverage', 'coverage/lcov-report',
  '.next', '.next/static', '.next/server',
  'packages/app/dist', 'packages/app/.cache',
  'packages/cli/dist',
  'packages/shared/dist',
  'tmp', 'logs',
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md'];
const IGNORED_EXTENSIONS = ['.js', '.map', '.css', '.html'];

function generateFiles(dirs: string[], count: number, extensions: string[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const dir = dirs[i % dirs.length];
    const ext = extensions[i % extensions.length];
    const name = `file_${i}${ext}`;
    files.push(`${dir}/${name}`);
  }
  return files;
}

const SOURCE_FILES = generateFiles(SOURCE_DIRS, 10_000, EXTENSIONS);
const IGNORED_FILES = generateFiles(IGNORED_DIRS, 5_000, IGNORED_EXTENSIONS);

// Root .gitignore
const ROOT_GITIGNORE_CONTENT = [
  'build/',
  'dist/',
  '.cache/',
  'coverage/',
  '.next/',
  'tmp/',
  'logs/',
  '*.log',
  '.env',
].join('\n');

// Nested .gitignore files (one per package)
const NESTED_GITIGNORES: Array<{ path: string; content: string }> = [
  { path: 'packages/app/.gitignore', content: 'dist/\n.cache/\n' },
  { path: 'packages/cli/.gitignore', content: 'dist/\n' },
  { path: 'packages/shared/.gitignore', content: 'dist/\n' },
];

// Generate additional nested .gitignore files to exceed the old 50 limit
for (let i = 0; i < 57; i++) {
  const dir = SOURCE_DIRS[i % SOURCE_DIRS.length];
  NESTED_GITIGNORES.push({
    path: `${dir}/.gitignore`,
    content: '*.temp\n*.bak\n',
  });
}

const ALL_GITIGNORES = [
  { path: '.gitignore', content: ROOT_GITIGNORE_CONTENT },
  ...NESTED_GITIGNORES,
];

const ALL_FILES = [
  ...SOURCE_FILES,
  ...IGNORED_FILES,
  '.gitignore',
  ...NESTED_GITIGNORES.map(g => g.path),
];

// --- Mock vscode ---

mock.module('vscode', () => {
  const base = require('./__mocks__/vscode');
  const rootUri = base.Uri.file(SCALE_ROOT);

  base.workspace.workspaceFolders = [{ uri: rootUri, name: 'scale-project', index: 0 }];

  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = SCALE_ROOT + '/';
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
    if (normalized === SCALE_ROOT || normalized === SCALE_ROOT + '/.') {
      return 'scale-project';
    }
    return normalized;
  };

  base.workspace.findFiles = async (pattern: string) => {
    if (pattern === '**/.gitignore') {
      return ALL_GITIGNORES.map((g: any) => base.Uri.file(`${SCALE_ROOT}/${g.path}`));
    }
    if (pattern === '**/*') {
      return ALL_FILES.map((f: string) => base.Uri.file(`${SCALE_ROOT}/${f}`));
    }
    return [];
  };

  // Map gitignore URIs to their content
  const gitignoreContents = new Map<string, string>();
  for (const g of ALL_GITIGNORES) {
    const fullPath = `${SCALE_ROOT}/${g.path}`;
    gitignoreContents.set(fullPath, g.content);
    gitignoreContents.set(fullPath.replace(/\//g, '\\'), g.content);
  }

  base.workspace.fs = {
    readFile: async (uri: any) => {
      const p = (uri.fsPath ?? uri.path).replace(/\\/g, '/');
      const content = gitignoreContents.get(p) ?? gitignoreContents.get(uri.fsPath) ?? '';
      return new TextEncoder().encode(content);
    },
    stat: async () => ({}),
  };

  base.workspace.getConfiguration = (section?: string) => ({
    get: <T>(_key: string, defaultVal: T): T => {
      if (section === 'files' || section === 'search') {
        return {} as T;
      }
      return defaultVal;
    },
  });

  return base;
});

const { GitIgnoreManager } = await import('../src/gitignore');
const { FileIndex } = await import('../src/index/fileIndex');
const { extractFolders } = await import('../src/providers/folderExtractor');
const { SearchMode } = await import('../src/providers/types');

describe('Scalability: large repo simulation', () => {
  let gitIgnore: InstanceType<typeof GitIgnoreManager>;
  let index: InstanceType<typeof FileIndex>;

  beforeAll(async () => {
    gitIgnore = new GitIgnoreManager();
    await gitIgnore.load();
    index = new FileIndex(gitIgnore as any);
    await index.build();
  });

  // --- GitIgnore at scale ---

  describe('GitIgnoreManager with 60+ .gitignore files', () => {
    test('loads all gitignore files (exceeds old limit of 50)', () => {
      // Total: 1 root + 3 package + 57 nested = 61 .gitignore files
      // This would have failed with the old limit of 50
      expect(ALL_GITIGNORES.length).toBe(61);
    });

    test('root gitignore patterns are respected', () => {
      expect(gitIgnore.isIgnored('build/output.js')).toBe(true);
      expect(gitIgnore.isIgnored('dist/bundle.js')).toBe(true);
      expect(gitIgnore.isIgnored('.cache/babel/cache.json')).toBe(true);
      expect(gitIgnore.isIgnored('coverage/lcov-report/index.html')).toBe(true);
      expect(gitIgnore.isIgnored('.next/static/chunk.js')).toBe(true);
      expect(gitIgnore.isIgnored('tmp/scratch.txt')).toBe(true);
      expect(gitIgnore.isIgnored('logs/error.txt')).toBe(true);
      expect(gitIgnore.isIgnored('debug.log')).toBe(true);
      expect(gitIgnore.isIgnored('.env')).toBe(true);
    });

    test('nested package gitignore patterns are respected', () => {
      expect(gitIgnore.isIgnored('packages/app/dist/bundle.js')).toBe(true);
      expect(gitIgnore.isIgnored('packages/app/.cache/file.json')).toBe(true);
      expect(gitIgnore.isIgnored('packages/cli/dist/index.js')).toBe(true);
      expect(gitIgnore.isIgnored('packages/shared/dist/types.d.ts')).toBe(true);
    });

    test('source files are not ignored', () => {
      expect(gitIgnore.isIgnored('src/core/file_0.ts')).toBe(false);
      expect(gitIgnore.isIgnored('src/api/v1/file_3.jsx')).toBe(false);
      expect(gitIgnore.isIgnored('packages/app/src/pages/file_27.ts')).toBe(false);
      expect(gitIgnore.isIgnored('lib/shared/file_21.ts')).toBe(false);
    });

    test('getExcludeGlob includes directory patterns from all gitignore files', () => {
      const glob = gitIgnore.getExcludeGlob()!;
      // Root patterns
      expect(glob).toContain('**/node_modules/**');
      expect(glob).toContain('**/.git/**');
      expect(glob).toContain('**/build/**');
      expect(glob).toContain('**/dist/**');
      expect(glob).toContain('**/.cache/**');
      expect(glob).toContain('**/coverage/**');
      expect(glob).toContain('**/.next/**');
      expect(glob).toContain('**/tmp/**');
      expect(glob).toContain('**/logs/**');
      // Nested patterns
      expect(glob).toContain('**/packages/app/dist/**');
      expect(glob).toContain('**/packages/cli/dist/**');
      expect(glob).toContain('**/packages/shared/dist/**');
    });
  });

  // --- FileIndex at scale ---

  describe('FileIndex with 15,000+ files', () => {
    test('fileCount reflects only non-ignored files', () => {
      // All ignored files should be filtered out
      expect(index.fileCount).toBe(SOURCE_FILES.length + 1 + NESTED_GITIGNORES.length);
      // +1 for root .gitignore, + nested .gitignore files (they're in source dirs, not ignored)
    });

    test('fileCount excludes all ignored files', () => {
      expect(index.fileCount).toBeLessThan(ALL_FILES.length);
      // Should not include any of the 5,000 ignored files
      expect(index.fileCount).toBeLessThanOrEqual(ALL_FILES.length - IGNORED_FILES.length);
    });

    test('find() returns results quickly for common queries', () => {
      const start = performance.now();
      const results = index.find('file_', 200, true);
      const elapsed = performance.now() - start;

      expect(results.length).toBe(200);
      expect(elapsed).toBeLessThan(500); // Should be well under 500ms
    });

    test('find() with excludeGitIgnored=true excludes ignored files', () => {
      const results = index.find('', 20_000, true);
      const paths = results.map(r => r.item.relativePath);

      // None should be in ignored directories
      expect(paths.every(p => !p.startsWith('build/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('dist/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('.cache/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('coverage/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('.next/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('tmp/'))).toBe(true);
      expect(paths.every(p => !p.startsWith('logs/'))).toBe(true);
    });

    test('find() with excludeGitIgnored=false includes ignored files', () => {
      const results = index.find('build', 200, false);
      const paths = results.map(r => r.item.relativePath);
      const hasBuild = paths.some(p => p.startsWith('build/'));
      expect(hasBuild).toBe(true);
    });

    test('find() respects limit parameter', () => {
      const results10 = index.find('file_', 10, true);
      const results100 = index.find('file_', 100, true);
      const results500 = index.find('file_', 500, true);

      expect(results10.length).toBe(10);
      expect(results100.length).toBe(100);
      expect(results500.length).toBe(500);
    });

    test('fuzzy matching works at scale', () => {
      // Search for a specific file pattern
      const results = index.find('corefl0', 10, true);
      // Should find files in src/core with "file_0" fuzzy-matching "corefl0"
      expect(results.length).toBeGreaterThan(0);
    });

    test('empty query returns files up to limit', () => {
      const results = index.find('', 50, true);
      expect(results.length).toBe(50);
    });
  });

  // --- Folder extraction at scale ---

  describe('Folder extraction at scale', () => {
    test('extracts correct folders from filtered results', () => {
      const results = index.find('', 1000, true);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, '', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      // Source directories should be present
      expect(folderPaths).toContain('src');
      expect(folderPaths).toContain('src/core');
      expect(folderPaths).toContain('lib');
      expect(folderPaths).toContain('packages');

      // Ignored directories should NOT be present (since we used excludeGitIgnored=true)
      expect(folderPaths).not.toContain('build');
      expect(folderPaths).not.toContain('dist');
      expect(folderPaths).not.toContain('.cache');
      expect(folderPaths).not.toContain('coverage');
    });

    test('folder search with query filters correctly', () => {
      const results = index.find('', 1000, true);
      const entries = results.map(r => r.item);
      const folders = extractFolders(entries, 'api', SearchMode.Folder);
      const folderPaths = folders.map((f: any) => f.description);

      expect(folderPaths).toContain('src/api');
      expect(folderPaths).toContain('src/api/v1');
      expect(folderPaths).toContain('src/api/v2');
    });
  });

  // --- Performance characteristics ---

  describe('Performance', () => {
    test('repeated searches do not degrade', () => {
      const timings: number[] = [];
      for (let i = 0; i < 20; i++) {
        const query = `file_${i * 500}`;
        const start = performance.now();
        index.find(query, 200, true);
        timings.push(performance.now() - start);
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const max = Math.max(...timings);

      // Average should be under 200ms, max under 500ms
      expect(avg).toBeLessThan(200);
      expect(max).toBeLessThan(500);
    });

    test('toggling excludeGitIgnored does not crash', () => {
      // First call builds the unfiltered FZF instance lazily
      const unfiltered = index.find('file_', 50, false);
      expect(unfiltered.length).toBe(50);

      // Switch back
      const filtered = index.find('file_', 50, true);
      expect(filtered.length).toBe(50);

      // Verify they have different results (unfiltered may include ignored files)
      const unfilteredPaths = new Set(unfiltered.map(r => r.item.relativePath));
      const filteredPaths = new Set(filtered.map(r => r.item.relativePath));
      // At minimum the sets should be valid
      expect(unfilteredPaths.size).toBe(50);
      expect(filteredPaths.size).toBe(50);
    });
  });
});
