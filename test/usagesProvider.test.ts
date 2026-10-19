import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { UsagesProvider } = await import('../src/providers/usagesProvider');
const { SearchMode } = await import('../src/providers/types');
const options = { fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
const target = { uri: vscode.Uri.file('/workspace/definition.ts'), position: new vscode.Position(2, 9), name: 'greet' };
const rules = { shouldExclude: () => false };
function location(file: string, line: number, column = 0) {
  return { uri: vscode.Uri.file(`/workspace/${file}`), range: new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column + 5)) };
}
afterEach(() => vi.restoreAllMocks());

test('semantic usages resolve the selected symbol and open each returned location', async () => {
  const command = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('consumer.ts', 4, 7)] as any);
  vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ lineAt: () => ({ text: 'return greet();' }) } as any);
  const provider = new UsagesProvider(rules as any);
  const results = await new Promise<any[]>(resolve => provider.search('', { ...options, usageTarget: target } as any, resolve));
  expect(command).toHaveBeenCalledWith('vscode.executeReferenceProvider', target.uri, target.position);
  expect(results).toMatchObject([{ mode: SearchMode.Usages, lineNumber: 4, column: 7, label: 'return greet();' }]);
});

test('exclusion rules run before the usages limit and duplicates are removed', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 2 : fallback } as any);
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('outside.ts', 0), location('src/a.ts', 1), location('src/a.ts', 1), location('src/ignored.ts', 0), location('src/b.ts', 3)] as any);
  const read = vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ lineAt: () => ({ text: 'greet();' }) } as any);
  const provider = new UsagesProvider({ shouldExclude: (_rel: string, _options: any, uri: any) => uri.path.endsWith('ignored.ts') || uri.path.endsWith('outside.ts') } as any);
  const results = await new Promise<any[]>(resolve => provider.search('', { ...options, usageTarget: target } as any, resolve));
  expect(results.map(result => result.uri.path)).toEqual(['/workspace/src/a.ts', '/workspace/src/b.ts']);
  expect(read).toHaveBeenCalledTimes(2);
});

test('the usages query filters previews and paths before limiting results', async () => {
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: (key: string, fallback: unknown) => key === 'maxResults' ? 1 : fallback } as any);
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('a.ts', 0), location('b.ts', 1)] as any);
  vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ lineAt: (line: number) => ({ text: line === 1 ? 'return greet();' : 'greet();' }) } as any);
  const results = await new Promise<any[]>(resolve => new UsagesProvider(rules as any).search('return', { ...options, usageTarget: target } as any, resolve));
  expect(results.map(result => result.uri.path)).toEqual(['/workspace/b.ts']);
});

test('cancelling while previews load suppresses late results and stops further reads', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('a.ts', 0), location('b.ts', 1)] as any);
  let finish!: (value: any) => void;
  const read = vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const publish = vi.fn();
  const request = new UsagesProvider(rules as any).search('', { ...options, usageTarget: target } as any, publish);
  await Promise.resolve();
  request.dispose();
  finish({ lineAt: () => ({ text: 'greet();' }) });
  await Promise.resolve();
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});

test('reference-provider failures are reported', async () => {
  const error = new Error('language server failed');
  vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(error);
  const failure = await new Promise(resolve => new UsagesProvider(rules as any).search('', { ...options, usageTarget: target } as any, vi.fn(), resolve));
  expect(failure).toBe(error);
});

test('an unreadable preview keeps a usable reference and does not discard other usages', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('missing.ts', 0), location('ok.ts', 1)] as any);
  vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(async (uri: any) => {
    if (uri.path.endsWith('missing.ts')) throw new Error('unreadable');
    return { lineAt: () => ({ text: 'greet();' }) } as any;
  });
  const results = await new Promise<any[]>((resolve, reject) => new UsagesProvider(rules as any).search('', { ...options, usageTarget: target } as any, resolve, reject));
  expect(results.map(result => result.uri.path)).toEqual(['/workspace/missing.ts', '/workspace/ok.ts']);
  expect(results[0].label).toBe('greet');
});

test('multiple references in one document share its open buffer within a request', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('a.ts', 0), location('a.ts', 1)] as any);
  const read = vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ lineAt: () => ({ text: 'greet();' }) } as any);
  const results = await new Promise<any[]>(resolve => new UsagesProvider(rules as any).search('', { ...options, usageTarget: target } as any, resolve));
  expect(results).toHaveLength(2);
  expect(read).toHaveBeenCalledTimes(1);
});

test('a path query keeps reference rows visible in native QuickPick filtering', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue([location('consumer.ts', 4, 7)] as any);
  vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ lineAt: () => ({ text: 'greet();' }) } as any);
  const results = await new Promise<any[]>(resolve => new UsagesProvider(rules as any).search('consumer.ts', { ...options, usageTarget: target } as any, resolve));
  expect(results).toMatchObject([{ label: 'greet();', alwaysShow: true, lineNumber: 4, column: 7 }]);
});
