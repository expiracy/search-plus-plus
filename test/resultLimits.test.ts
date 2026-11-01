import { afterEach, expect, test, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { getMaxResults } = await import('../src/providers/types');

afterEach(() => vi.restoreAllMocks());

function limit(value: unknown) {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    inspect: (key: string) => ({ globalValue: key === 'resultsPerSearchType' ? value : undefined }),
    get: (_key: string, fallback: unknown) => fallback,
  } as any);
}

test('fractional result limits become the same whole-result budget for every provider', () => {
  limit(2.8);
  expect(getMaxResults()).toBe(2);
});

test('non-finite result limits cannot disable the result budget', () => {
  limit(Infinity);
  expect(getMaxResults()).toBe(200);
});

test('zero and negative result limits retain one usable result', () => {
  limit(0); expect(getMaxResults()).toBe(1);
  limit(-5); expect(getMaxResults()).toBe(1);
});
