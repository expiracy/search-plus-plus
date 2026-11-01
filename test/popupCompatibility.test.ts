import { expect, test, vi } from 'vitest';
vi.mock('vscode', async () => ({ ...await import('./__mocks__/vscode'), version: '1.109.0' }));
const vscode = await import('vscode');
const { SearchModal } = await import('../src/ui/searchModal');
const { SearchMode } = await import('../src/providers/types');

test('the minimum supported host gets native title tabs and inline toggles', () => {
  const picker = vscode.window.createQuickPick();
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  const modal = new SearchModal({ state: 'ready', onDidChangeState: () => ({ dispose() {} }) } as any, { getRecentItems: () => [] } as any, new Map());
  try {
    modal.show();
    expect(picker.buttons.slice(0, 6).map(button => button.tooltip)).toEqual(['Everything', 'Files', 'Folders', 'Text', 'Symbols', 'Commands']);
    expect(picker.buttons.slice(0, 6).every(button => button.location === vscode.QuickInputButtonLocation.Title && button.toggle)).toBe(true);
    expect(picker.buttons[0].toggle?.checked).toBe(true);
    expect(picker.buttons.slice(6, -1).every(button => button.location === vscode.QuickInputButtonLocation.Inline && button.toggle)).toBe(true);
    expect(picker.buttons.at(-1)?.location).toBe(vscode.QuickInputButtonLocation.Inline);
  } finally { modal.dispose(); vi.restoreAllMocks(); }
});

test('the minimum supported host advertises Cmd/Ctrl+Enter and the Shift+F12 alternative', () => {
  const picker = vscode.window.createQuickPick();
  vi.spyOn(vscode.window, 'createQuickPick').mockReturnValue(picker);
  const modal = new SearchModal({ state: 'ready', onDidChangeState: () => ({ dispose() {} }) } as any, { getRecentItems: () => [] } as any, new Map());
  try {
    modal.show(SearchMode.Symbol);
    const usages = process.platform === 'darwin' ? 'Cmd+Return' : 'Ctrl+Enter';
    expect(picker.placeholder).toContain(`${usages} for usages`);
    expect(picker.items[0].description).toContain(`${usages} or Shift+F12`);
  } finally { modal.dispose(); vi.restoreAllMocks(); }
});
