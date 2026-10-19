import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { EverywhereProvider } = await import('../src/providers/everywhereProvider');
const { SearchMode } = await import('../src/providers/types');
const options = { fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
afterEach(() => vi.restoreAllMocks());

test('a failed text section reports its error while preserving file results', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'everywhere.sections' ? ['files', 'text'] : fallback } as any);
  const file = { label: 'file.ts', mode: SearchMode.File, uri: vscode.Uri.file('/workspace/file.ts') };
  const files = { search: (_q: string, _o: unknown, publish: (r: any[]) => void) => { publish([file]); return { dispose() {} }; } };
  const text = { search: (_q: string, _o: unknown, _publish: unknown, fail?: (e: unknown) => void) => { fail?.(new Error('ripgrep unavailable')); return { dispose() {} }; } };
  const unused = { search: () => ({ dispose() {} }) };
  const provider = new EverywhereProvider(files as any, unused as any, text as any, unused as any, unused as any);
  const publish = vi.fn();
  const request = provider.search('file', options, publish);
  try {
    await new Promise(setImmediate);
    const results = publish.mock.lastCall![0];
    expect(results.some((r: any) => r.label === 'file.ts')).toBe(true);
    expect(results.some((r: any) => r.description?.includes('ripgrep unavailable'))).toBe(true);
  } finally { request.dispose(); }
});

test('disabling every section still settles the search with an empty result', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'everywhere.sections' ? [] : fallback } as any);
  const unused = { search: vi.fn(() => ({ dispose() {} })) };
  const publish = vi.fn();
  const request = new EverywhereProvider(unused as any, unused as any, unused as any, unused as any, unused as any).search('file', options, publish);
  try {
    await new Promise(setImmediate);
    expect(publish).toHaveBeenCalledWith([]);
    expect(unused.search).not.toHaveBeenCalled();
  } finally { request.dispose(); }
});
