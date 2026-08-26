import { describe, test, expect, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));

const { debounce, getEnabledSections, containsWholeWord, hasCaseSensitiveSubsequence, containsQuery } = await import('../src/utils');
const { ResultSection } = await import('../src/providers/types');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('debounce', () => {
  test('calls function after delay', async () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 20);
    fn();
    expect(called).toBe(false);
    await sleep(40);
    expect(called).toBe(true);
  });

  test('does not call before delay elapses', async () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 50);
    fn();
    await sleep(10);
    expect(called).toBe(false);
    fn.cancel();
  });

  test('resets timer on repeated calls — only last fires', async () => {
    const calls: number[] = [];
    const fn = debounce((val: number) => { calls.push(val); }, 30);
    fn(1);
    await sleep(10);
    fn(2);
    await sleep(10);
    fn(3);
    await sleep(50);
    expect(calls).toEqual([3]);
  });

  test('cancel() prevents pending call', async () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 20);
    fn();
    fn.cancel();
    await sleep(40);
    expect(called).toBe(false);
  });

  test('cancel() is a no-op when no call is pending', () => {
    const fn = debounce(() => {}, 20);
    expect(() => fn.cancel()).not.toThrow();
  });

  test('passes arguments correctly', async () => {
    let receivedArgs: any[] = [];
    const fn = debounce((...args: any[]) => { receivedArgs = args; }, 20);
    fn('a', 42, true);
    await sleep(40);
    expect(receivedArgs).toEqual(['a', 42, true]);
  });
});

describe('getEnabledSections', () => {
  test('returns defaults for non-array input', () => {
    expect(getEnabledSections(undefined)).toEqual([
      ResultSection.Files, ResultSection.Folders, ResultSection.Text, ResultSection.Symbols, ResultSection.Commands,
    ]);
    expect(getEnabledSections(null)).toEqual([
      ResultSection.Files, ResultSection.Folders, ResultSection.Text, ResultSection.Symbols, ResultSection.Commands,
    ]);
  });

  test('preserves custom order', () => {
    expect(getEnabledSections(['text', 'files'])).toEqual([
      ResultSection.Text, ResultSection.Files,
    ]);
  });

  test('filters invalid section names', () => {
    expect(getEnabledSections(['files', 'invalid', 'text'])).toEqual([
      ResultSection.Files, ResultSection.Text,
    ]);
  });

  test('deduplicates keeping first occurrence', () => {
    expect(getEnabledSections(['files', 'files'])).toEqual([ResultSection.Files]);
  });

  test('returns empty array for empty input', () => {
    expect(getEnabledSections([])).toEqual([]);
  });

  test('skips non-string entries', () => {
    expect(getEnabledSections([null, 123, 'commands'])).toEqual([ResultSection.Commands]);
  });
});

describe('containsWholeWord', () => {
  test('matches when query is bounded by path separators', () => {
    expect(containsWholeWord('src/path/config.ts', 'path', false)).toBe(true);
  });

  test('matches at start and end of text', () => {
    expect(containsWholeWord('path', 'path', false)).toBe(true);
    expect(containsWholeWord('path.cpp', 'path', false)).toBe(true);
    expect(containsWholeWord('include/path', 'path', false)).toBe(true);
  });

  test('does NOT match when preceded by an underscore (underscore is a word char)', () => {
    expect(containsWholeWord('test_path.cpp', 'path', false)).toBe(false);
    expect(containsWholeWord('path_utils.ts', 'path', false)).toBe(false);
  });

  test('does NOT match inside a larger word', () => {
    expect(containsWholeWord('AddPathMode.ts', 'path', false)).toBe(false);
    expect(containsWholeWord('mypath.ts', 'path', false)).toBe(false);
    expect(containsWholeWord('pathological.ts', 'path', false)).toBe(false);
  });

  test('matches when bounded by dots and dashes (non-word chars)', () => {
    expect(containsWholeWord('some-path-here.ts', 'path', false)).toBe(true);
    expect(containsWholeWord('a.path.b', 'path', false)).toBe(true);
  });

  test('case-insensitive by default', () => {
    expect(containsWholeWord('src/Path/config.ts', 'path', false)).toBe(true);
  });

  test('caseSensitive=true requires exact casing', () => {
    expect(containsWholeWord('src/Path/config.ts', 'path', true)).toBe(false);
    expect(containsWholeWord('src/path/config.ts', 'path', true)).toBe(true);
  });

  test('finds a later whole-word occurrence after a partial one', () => {
    expect(containsWholeWord('mypath/path/file.ts', 'path', false)).toBe(true);
  });

  test('query with non-word edge chars skips boundary check on that side', () => {
    expect(containsWholeWord('call useState(0) now', 'useState(0)', true)).toBe(true);
    expect(containsWholeWord('myuseState(0)', 'useState(0)', true)).toBe(false);
  });

  test('empty query always matches', () => {
    expect(containsWholeWord('anything', '', false)).toBe(true);
  });
});

describe('hasCaseSensitiveSubsequence', () => {
  test('matches exact-case subsequence', () => {
    expect(hasCaseSensitiveSubsequence('src/AddPathMode.ts', 'APM')).toBe(true);
    expect(hasCaseSensitiveSubsequence('src/index.ts', 'sidx')).toBe(true);
  });

  test('rejects wrong-case subsequence', () => {
    expect(hasCaseSensitiveSubsequence('src/AddPathMode.ts', 'path')).toBe(false);
    expect(hasCaseSensitiveSubsequence('src/path/file.ts', 'Path')).toBe(false);
  });

  test('empty query always matches', () => {
    expect(hasCaseSensitiveSubsequence('anything', '')).toBe(true);
  });
});

describe('containsQuery', () => {
  test('plain substring match when both toggles are off', () => {
    expect(containsQuery('test_path.cpp', 'path', { caseSensitive: false, matchWholeWord: false })).toBe(true);
    expect(containsQuery('AddPathMode.ts', 'path', { caseSensitive: false, matchWholeWord: false })).toBe(true);
  });

  test('caseSensitive substring match', () => {
    expect(containsQuery('AddPathMode.ts', 'path', { caseSensitive: true, matchWholeWord: false })).toBe(false);
    expect(containsQuery('AddPathMode.ts', 'Path', { caseSensitive: true, matchWholeWord: false })).toBe(true);
  });

  test('whole-word match excludes partial words', () => {
    expect(containsQuery('test_path.cpp', 'path', { caseSensitive: false, matchWholeWord: true })).toBe(false);
    expect(containsQuery('src/path/a.ts', 'path', { caseSensitive: false, matchWholeWord: true })).toBe(true);
  });

  test('combined toggles require exact case AND whole word', () => {
    expect(containsQuery('src/Path/a.ts', 'path', { caseSensitive: true, matchWholeWord: true })).toBe(false);
    expect(containsQuery('src/path/a.ts', 'path', { caseSensitive: true, matchWholeWord: true })).toBe(true);
  });
});
