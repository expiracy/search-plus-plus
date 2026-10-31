import { afterEach, expect, test, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { SearchHistory } = await import('../src/history');

afterEach(() => vi.restoreAllMocks());

test('background cleanup cannot overwrite a more recently opened file', async () => {
  let entries: unknown[] = [{ relativePath: 'missing.ts', fsPath: '/workspace/missing.ts' }];
  const state = {
    get: () => entries,
    update: vi.fn(async (_key: string, value: unknown[]) => { entries = value; }),
  };
  let rejectOldCheck!: (reason: Error) => void;
  let started!: () => void;
  const checkingMissing = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: any) => {
    if (uri.fsPath.endsWith('missing.ts')) {
      started();
      return new Promise((_resolve, reject) => { rejectOldCheck ??= reject; });
    }
    return { type: vscode.FileType.File } as any;
  });
  const history = new SearchHistory(state as any);
  await history.addOpened(vscode.Uri.file('/workspace/first.ts'));
  await checkingMissing;
  await history.addOpened(vscode.Uri.file('/workspace/second.ts'));
  rejectOldCheck(new Error('File not found'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(history.getRecentItems().slice(0, 2).map(item => item.uri?.fsPath)).toEqual([
    '/workspace/second.ts', '/workspace/first.ts',
  ]);
});

test('background cleanup cannot restore an entry removed from history', async () => {
  let entries = [
    { relativePath: 'missing.ts', fsPath: '/workspace/missing.ts' },
    { relativePath: 'removed.ts', fsPath: '/workspace/removed.ts' },
  ];
  const state = { get: () => entries, update: async (_key: string, value: typeof entries) => { entries = value; } };
  let rejectCheck!: (reason: Error) => void;
  let started!: () => void;
  const checkingMissing = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: any) => {
    if (uri.fsPath.endsWith('missing.ts')) {
      started();
      return new Promise((_resolve, reject) => { rejectCheck = reject; });
    }
    return { type: vscode.FileType.File } as any;
  });
  const history = new SearchHistory(state as any);
  await history.addOpened(vscode.Uri.file('/workspace/current.ts'));
  await checkingMissing;
  await history.removeEntry('/workspace/removed.ts');
  rejectCheck(new Error('File not found'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(history.getRecentItems().some(item => item.uri?.fsPath === '/workspace/removed.ts')).toBe(false);
  expect(history.getRecentItems()[0].uri?.fsPath).toBe('/workspace/current.ts');
});

test('cleanup preserves the recent-file limit and does not restore evicted entries', async () => {
  let entries = Array.from({ length: 20 }, (_, index) => ({ relativePath: `${index}.ts`, fsPath: `/workspace/${index}.ts` }));
  const state = { get: () => entries, update: async (_key: string, value: typeof entries) => { entries = value; } };
  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: any) => {
    if (uri.fsPath === '/workspace/0.ts') throw new Error('File not found');
    return { type: vscode.FileType.File } as any;
  });
  const history = new SearchHistory(state as any);
  await history.addOpened(vscode.Uri.file('/workspace/current.ts'), 41, 4);
  await new Promise(resolve => setTimeout(resolve, 0));
  const items = history.getRecentItems();
  expect(items).toHaveLength(19);
  expect(items[0]).toMatchObject({
    label: 'current.ts:42', description: '/workspace', lineNumber: 41, column: 4,
    resourceUri: vscode.Uri.file('/workspace/current.ts'),
  });
  expect(items.some(item => item.uri?.fsPath === '/workspace/19.ts')).toBe(false);
});
