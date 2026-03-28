import { describe, test, expect, mock, beforeEach } from 'bun:test';
import path from 'path';

const FIXTURE_ROOT = path.resolve(import.meta.dir, 'fixtures/mock-project').replace(/\\/g, '/');

// Configure vscode mock before importing source modules
mock.module('vscode', () => {
  const base = require('./__mocks__/vscode');

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
    expect(manager.isIgnored('node_modules/foo/bar.js')).toBe(true);
    expect(manager.isIgnored('node_modules/fake-dep/index.js')).toBe(true);
  });

  test('does not ignore source files', () => {
    expect(manager.isIgnored('src/index.ts')).toBe(false);
    expect(manager.isIgnored('src/utils.ts')).toBe(false);
    expect(manager.isIgnored('src/deep/nested/file.ts')).toBe(false);
  });

  test('ignores .log files via glob pattern', () => {
    expect(manager.isIgnored('data.log')).toBe(true);
    expect(manager.isIgnored('error.log')).toBe(true);
  });

  test('ignores build directory', () => {
    expect(manager.isIgnored('build/output.js')).toBe(true);
  });

  test('does not ignore lib directory', () => {
    expect(manager.isIgnored('lib/helper.js')).toBe(false);
  });

  test('does not ignore docs', () => {
    expect(manager.isIgnored('docs/README.md')).toBe(false);
  });

  test('isIgnored still catches gitignored directory contents via post-filter', () => {
    expect(manager.isIgnored('build/output.js')).toBe(true);
    expect(manager.isIgnored('build/nested/deep.js')).toBe(true);
  });

  test('isIgnored handles backslashes (Windows paths)', () => {
    expect(manager.isIgnored('node_modules\\foo\\bar.js')).toBe(true);
    expect(manager.isIgnored('src\\index.ts')).toBe(false);
  });

  test('isIgnored returns false for non-matching paths', () => {
    expect(manager.isIgnored('package.json')).toBe(false);
    expect(manager.isIgnored('.gitignore')).toBe(false);
  });

  // --- nested gitignore ---

  test('nested .gitignore: ignores generated/ directory under src/', () => {
    expect(manager.isIgnored('src/generated/output.gen.ts')).toBe(true);
    expect(manager.isIgnored('src/generated/manual.ts')).toBe(true);
  });

  test('nested .gitignore: does not ignore other files under src/', () => {
    expect(manager.isIgnored('src/index.ts')).toBe(false);
    expect(manager.isIgnored('src/deep/nested/file.ts')).toBe(false);
  });

  test('nested .gitignore: pattern does not apply outside its directory', () => {
    // generated/ is in src/.gitignore, so it should not apply at root level
    expect(manager.isIgnored('generated/something.ts')).toBe(false);
  });

  // --- binary / non-text files are not gitignored ---

  test('does not ignore binary files (images, fonts, pdfs)', () => {
    expect(manager.isIgnored('assets/logo.png')).toBe(false);
    expect(manager.isIgnored('assets/icon.ico')).toBe(false);
    expect(manager.isIgnored('assets/font.woff2')).toBe(false);
    expect(manager.isIgnored('docs/guide.pdf')).toBe(false);
  });
});
