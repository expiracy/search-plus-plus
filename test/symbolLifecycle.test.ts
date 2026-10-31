import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SymbolProvider } = await import('../src/providers/symbolProvider');
const options = { fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
afterEach(() => vi.restoreAllMocks());

test('ignored symbols do not consume the visible result budget', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ inspect: () => undefined, get: (_key: string, fallback: unknown) => _key === 'maxResults' ? 1 : fallback } as any);
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(['hidden', 'visible'].map(name => ({
    name: 'needle', kind: vscode.SymbolKind.Function, containerName: '',
    location: { uri: vscode.Uri.file(`/workspace/${name}.ts`), range: { start: { line: 0, character: 0 } } },
  })) as any);
  const provider = new SymbolProvider({ shouldExclude: (p: string) => p.includes('hidden') } as any);
  const results = await new Promise<any[]>(resolve => provider.search('needle', options, resolve));
  expect(results.map(r => r.uri.fsPath)).toEqual(['/workspace/visible.ts']);
});

test('cancelled symbol searches do not publish a late empty result', async () => {
  let finish!: (symbols: any[]) => void;
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(() => new Promise(resolve => { finish = resolve; }) as any);
  const publish = vi.fn();
  const provider = new SymbolProvider({ shouldExclude: () => false } as any);
  const request = provider.search('needle', options, publish);
  request.dispose();
  finish([]);
  await new Promise(setImmediate);
  expect(publish).not.toHaveBeenCalled();
});

test('language provider failures reach the current search', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('Language service unavailable'));
  const fail = vi.fn();
  new SymbolProvider({ shouldExclude: () => false } as any).search('needle', options, vi.fn(), fail);
  await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'Language service unavailable' })));
});
