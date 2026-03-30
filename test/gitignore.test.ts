import { describe, test, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/mock-project').replace(/\\/g, '/');

// Configure vscode mock before importing source modules
vi.doMock('vscode', async () => {
  const base: any = await import('./__mocks__/vscode');

  // Override workspace methods for gitignore testing
  const rootUri = base.Uri.file(FIXTURE_ROOT);

  base.workspace.workspaceFolders = [{ uri: rootUri, name: 'mock-project', index: 0 }];

  // Mimic real VS Code behavior: asRelativePath returns the folder name
  // (NOT '.') when the path equals the workspace root
  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = FIXTURE_ROOT + '/';
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
    // VS Code returns the folder name for the workspace root itself
    if (normalized === FIXTURE_ROOT || normalized === FIXTURE_ROOT + '/.') {
      return 'mock-project';
    }
    return normalized;
  };

  base.workspace.findFiles = async (pattern: string) => {
    if (pattern === '**/.gitignore') {
      return [
        base.Uri.file(`${FIXTURE_ROOT}/.gitignore`),
        base.Uri.file(`${FIXTURE_ROOT}/src/.gitignore`),
      ];
    }
    if (pattern === '**/.searchignore') {
      return [
        base.Uri.file(`${FIXTURE_ROOT}/.searchignore`),
      ];
    }
    return [];
  };

  base.workspace.fs = {
    readFile: async (uri: any) => {
      const fs = require('fs');
      const content = fs.readFileSync(uri.fsPath ?? uri.path, 'utf-8');
      return new TextEncoder().encode(content);
    },
    stat: async () => ({}),
  };

  base.workspace.getConfiguration = (section?: string) => ({
    get: <T>(_key: string, defaultVal: T): T => {
      // Return empty excludes for files/search config
      if (section === 'files' || section === 'search') {
        return {} as T;
      }
      return defaultVal;
    },
  });

  return base;
});

const { GitIgnoreManager } = await import('../src/gitignore');

describe('GitIgnoreManager', () => {
  let manager: InstanceType<typeof GitIgnoreManager>;

  beforeEach(async () => {
    manager = new GitIgnoreManager();
    await manager.load();
  });

  test('ignores node_modules paths', () => {
    expect(manager.isGitIgnored('node_modules/foo/bar.js')).toBe(true);
    expect(manager.isGitIgnored('node_modules/fake-dep/index.js')).toBe(true);
  });

  test('does not ignore source files', () => {
    expect(manager.isGitIgnored('src/index.ts')).toBe(false);
    expect(manager.isGitIgnored('src/utils.ts')).toBe(false);
    expect(manager.isGitIgnored('src/deep/nested/file.ts')).toBe(false);
  });

  test('ignores .log files via glob pattern', () => {
    expect(manager.isGitIgnored('data.log')).toBe(true);
    expect(manager.isGitIgnored('error.log')).toBe(true);
  });

  test('ignores build directory', () => {
    expect(manager.isGitIgnored('build/output.js')).toBe(true);
  });

  test('does not ignore lib directory', () => {
    expect(manager.isGitIgnored('lib/helper.js')).toBe(false);
  });

  test('does not ignore docs', () => {
    expect(manager.isGitIgnored('docs/README.md')).toBe(false);
  });

  test('isGitIgnored still catches gitignored directory contents via post-filter', () => {
    expect(manager.isGitIgnored('build/output.js')).toBe(true);
    expect(manager.isGitIgnored('build/nested/deep.js')).toBe(true);
  });

  test('isGitIgnored handles backslashes (Windows paths)', () => {
    expect(manager.isGitIgnored('node_modules\\foo\\bar.js')).toBe(true);
    expect(manager.isGitIgnored('src\\index.ts')).toBe(false);
  });

  test('isGitIgnored returns false for non-matching paths', () => {
    expect(manager.isGitIgnored('package.json')).toBe(false);
    expect(manager.isGitIgnored('.gitignore')).toBe(false);
  });

  // --- nested gitignore ---

  test('nested .gitignore: ignores generated/ directory under src/', () => {
    expect(manager.isGitIgnored('src/generated/output.gen.ts')).toBe(true);
    expect(manager.isGitIgnored('src/generated/manual.ts')).toBe(true);
  });

  test('nested .gitignore: does not ignore other files under src/', () => {
    expect(manager.isGitIgnored('src/index.ts')).toBe(false);
    expect(manager.isGitIgnored('src/deep/nested/file.ts')).toBe(false);
  });

  test('nested .gitignore: pattern does not apply outside its directory', () => {
    // generated/ is in src/.gitignore, so it should not apply at root level
    expect(manager.isGitIgnored('generated/something.ts')).toBe(false);
  });

  // --- binary / non-text files are not gitignored ---

  test('does not ignore binary files (images, fonts, pdfs)', () => {
    expect(manager.isGitIgnored('assets/logo.png')).toBe(false);
    expect(manager.isGitIgnored('assets/icon.ico')).toBe(false);
    expect(manager.isGitIgnored('assets/font.woff2')).toBe(false);
    expect(manager.isGitIgnored('docs/guide.pdf')).toBe(false);
  });

  // --- .searchignore ---

  test('searchignore: ignores docs/ directory', () => {
    expect(manager.isSearchIgnored('docs/README.md')).toBe(true);
    expect(manager.isSearchIgnored('docs/guide.pdf')).toBe(true);
  });

  test('searchignore: ignores *.pdf files anywhere', () => {
    expect(manager.isSearchIgnored('report.pdf')).toBe(true);
    expect(manager.isSearchIgnored('nested/deep/file.pdf')).toBe(true);
  });

  test('searchignore: does not ignore non-matching files', () => {
    expect(manager.isSearchIgnored('src/index.ts')).toBe(false);
    expect(manager.isSearchIgnored('lib/helper.js')).toBe(false);
    expect(manager.isSearchIgnored('assets/logo.png')).toBe(false);
  });

  test('searchignore: patterns do not affect gitignore', () => {
    // docs/ is in .searchignore but not .gitignore
    expect(manager.isGitIgnored('docs/README.md')).toBe(false);
    // build/ is in .gitignore but not .searchignore
    expect(manager.isSearchIgnored('build/output.js')).toBe(false);
  });

  test('searchignore: handles Windows backslashes', () => {
    expect(manager.isSearchIgnored('docs\\README.md')).toBe(true);
    expect(manager.isSearchIgnored('src\\index.ts')).toBe(false);
  });

  test('getSearchIgnorePatterns returns loaded patterns', () => {
    const patterns = manager.getSearchIgnorePatterns();
    expect(patterns).toContain('docs/');
    expect(patterns).toContain('*.pdf');
  });
});
