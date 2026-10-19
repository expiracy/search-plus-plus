import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { CommandProvider } = await import('../src/providers/commandProvider');
const options = { fuzzySearch: true, caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true };
afterEach(() => vi.restoreAllMocks());

test('command fuzzy search respects match case being off for uppercase queries', async () => {
  vi.spyOn(vscode.commands, 'getCommands').mockResolvedValue(['workbench.action.openSettings']);
  const provider = new CommandProvider();
  try {
    const results = await new Promise<any[]>(resolve => provider.search('OPENSETTINGS', options, resolve));
    expect(results.map(r => r.commandId)).toEqual(['workbench.action.openSettings']);
  } finally { provider.dispose(); }
});

test('command enumeration failures reach the search error callback', async () => {
  vi.spyOn(vscode.commands, 'getCommands').mockRejectedValue(new Error('Command service unavailable'));
  const provider = new CommandProvider();
  try {
    const fail = vi.fn();
    provider.search('settings', options, vi.fn(), fail);
    await vi.waitFor(() => expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'Command service unavailable' })));
  } finally { provider.dispose(); }
});
