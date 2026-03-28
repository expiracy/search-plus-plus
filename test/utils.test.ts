import { describe, test, expect } from 'vitest';
import { debounce } from '../src/utils';

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
