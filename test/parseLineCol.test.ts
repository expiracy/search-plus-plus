import { describe, test, expect, mock } from 'bun:test';

mock.module('vscode', () => import('./__mocks__/vscode'));

const { parseLineCol } = await import('../src/ui/searchModal');

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
});
