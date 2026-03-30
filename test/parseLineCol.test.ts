import { describe, test, expect, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));

const { parseLineCol } = await import('../src/ui/searchModal');
const { isAbsolutePath } = await import('../src/utils');

describe('parseLineCol', () => {
  test('plain query with no colon', () => {
    expect(parseLineCol('foo')).toEqual({ query: 'foo' });
  });

  test('query with line number', () => {
    expect(parseLineCol('file:10')).toEqual({ query: 'file', gotoLine: 10 });
  });

  test('query with line and column', () => {
    expect(parseLineCol('file:10:5')).toEqual({ query: 'file', gotoLine: 10, gotoColumn: 5 });
  });

  test('line 0 is invalid (must be >= 1) — returns full string as query', () => {
    expect(parseLineCol('file:0')).toEqual({ query: 'file:0' });
  });

  test('column 0 is valid', () => {
    expect(parseLineCol('file:10:0')).toEqual({ query: 'file', gotoLine: 10, gotoColumn: 0 });
  });

  test('preserves colons in path when followed by valid line:col', () => {
    expect(parseLineCol('a:b:c:10:5')).toEqual({ query: 'a:b:c', gotoLine: 10, gotoColumn: 5 });
  });

  test('non-numeric suffix returns full query', () => {
    expect(parseLineCol('file:abc')).toEqual({ query: 'file:abc' });
  });

  test('empty string', () => {
    expect(parseLineCol('')).toEqual({ query: '' });
  });

  test('negative line number is invalid', () => {
    expect(parseLineCol('file:-1')).toEqual({ query: 'file:-1' });
  });

  test('just a number is treated as line', () => {
    expect(parseLineCol('query:1')).toEqual({ query: 'query', gotoLine: 1 });
  });

  test('large line and column numbers', () => {
    expect(parseLineCol('file:9999:500')).toEqual({ query: 'file', gotoLine: 9999, gotoColumn: 500 });
  });

  test('Windows absolute path is not mangled', () => {
    expect(parseLineCol('C:\\Users\\file.ts')).toEqual({ query: 'C:\\Users\\file.ts' });
  });

  test('Windows absolute path with line:col', () => {
    expect(parseLineCol('C:\\Users\\file.ts:10:5')).toEqual({ query: 'C:\\Users\\file.ts', gotoLine: 10, gotoColumn: 5 });
  });

  test('Unix absolute path is not mangled', () => {
    expect(parseLineCol('/home/user/file.ts')).toEqual({ query: '/home/user/file.ts' });
  });

  test('Unix absolute path with line number', () => {
    expect(parseLineCol('/home/user/file.ts:42')).toEqual({ query: '/home/user/file.ts', gotoLine: 42 });
  });
});

describe('isAbsolutePath', () => {
  test('Windows path with backslash', () => {
    expect(isAbsolutePath('C:\\Users\\file.ts')).toBe(true);
  });

  test('Windows path with forward slash', () => {
    expect(isAbsolutePath('C:/Users/file.ts')).toBe(true);
  });

  test('lowercase drive letter', () => {
    expect(isAbsolutePath('d:\\projects\\foo')).toBe(true);
  });

  test('Unix absolute path', () => {
    expect(isAbsolutePath('/home/user/file.ts')).toBe(true);
  });

  test('relative path is not absolute', () => {
    expect(isAbsolutePath('src/file.ts')).toBe(false);
  });

  test('plain filename is not absolute', () => {
    expect(isAbsolutePath('file.ts')).toBe(false);
  });

  test('search query is not absolute', () => {
    expect(isAbsolutePath('search query')).toBe(false);
  });

  test('bare slash is not absolute', () => {
    expect(isAbsolutePath('/')).toBe(false);
  });

  test('drive letter without slash is not absolute', () => {
    expect(isAbsolutePath('C:')).toBe(false);
  });

  test('two-letter prefix is not a drive letter', () => {
    expect(isAbsolutePath('CC:\\foo')).toBe(false);
  });
});
