import { expect, test, vi } from 'vitest';
vi.mock('vscode', async () => ({ ...await import('./__mocks__/vscode'), version: '1.96.0' }));
const vscode = await import('vscode');
const { SearchModal } = await import('../src/ui/searchModal');

test('VS Code 1.96 does not receive proposed button properties even when its enum exists', () => {
  const picker = vscode.window.createQuickPick();
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  const modal = new SearchModal({ state: 'ready', onDidChangeState: () => ({ dispose() {} }) } as any, { getRecentItems: () => [] } as any, new Map());
  try {
    modal.show();
    expect(picker.buttons.slice(1, 8).map(button => button.tooltip)).toEqual(['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Usages', 'Commands']);
    expect(picker.buttons.every(button => !('location' in button) && !('toggle' in button))).toBe(true);
  } finally { modal.dispose(); vi.restoreAllMocks(); }
});
