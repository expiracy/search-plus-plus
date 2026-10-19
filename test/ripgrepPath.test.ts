import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn }));
vi.mock('fs', () => ({ existsSync: (path: string) => path.includes('/ripgrep-universal/bin/') }));
vi.mock('vscode', () => import('./__mocks__/vscode'));

test('packaged search locates the host ripgrep in the universal package layout', async () => {
  const vscode = await import('./__mocks__/vscode');
  vscode.env.appRoot = '/Applications/Code.app/Contents/Resources/app';
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace'), name: '', index: 0 }];
  spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }));
  const { TextSearch } = await import('../src/index/textSearch');
  const search = new TextSearch();
  try {
    search.search('needle', { caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true, maxResults: 200 }, vi.fn());
    expect(spawn.mock.calls[0][0]).toBe(`/Applications/Code.app/Contents/Resources/app/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/${process.platform}-${process.arch}/${process.platform === 'win32' ? 'rg.exe' : 'rg'}`);
  } finally { search.dispose(); }
});
