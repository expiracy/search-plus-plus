import { describe, test, expect, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));

const { debounce, getEnabledSections } = await import('../src/utils');
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
