import { expect, test, vi } from 'vitest';
vi.mock('vscode', async () => ({ ...await import('./__mocks__/vscode'), QuickInputButtonLocation: undefined }));

test('the modal opens on hosts without the newer button location API', async () => {
  const { SearchModal } = await import('../src/ui/searchModal');
  const modal = new SearchModal({ state: 'ready', fileIndex: {}, textSearch: {}, gitIgnore: {}, onDidChangeState: () => ({ dispose() {} }) } as any, { getRecentItems: () => [] } as any, new Map());
  try { expect(() => modal.show()).not.toThrow(); }
  finally { modal.dispose(); }
});
