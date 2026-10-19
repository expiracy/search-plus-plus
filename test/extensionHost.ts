import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { GitIgnoreManager } from '../src/gitignore';
import { FileIndex } from '../src/index/fileIndex';
import { TextSearch, type TextMatch } from '../src/index/textSearch';
import { FileProvider } from '../src/providers/fileProvider';
import { FolderProvider } from '../src/providers/folderProvider';
import { type SearchOptions, type SearchResult } from '../src/providers/types';

const options: SearchOptions = {
  fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false,
  excludeGitIgnored: true, excludeSearchIgnored: true,
};

function collect<T>(start: (publish: (results: T[]) => void, fail: (error: unknown) => void) => vscode.Disposable): Promise<T[]> {
  let request: vscode.Disposable | undefined;
  return new Promise<T[]>((resolve, reject) => {
    const timer = setTimeout(() => { request?.dispose(); reject(new Error('Search timed out')); }, 10000);
    const finish = (results: T[]) => { clearTimeout(timer); resolve(results); };
    request = start(finish, error => { clearTimeout(timer); reject(error); });
  }).finally(() => request?.dispose());
}

export async function run(): Promise<void> {
  const rules = new GitIgnoreManager();
  const index = new FileIndex(rules);
  const text = new TextSearch(undefined, rules);
  try {
    const extension = vscode.extensions.getExtension('expiracy.search-plus-plus');
    assert.ok(extension, 'development extension is registered');
    await extension.activate();
    await rules.load();
    await index.build();
    const files = new FileProvider(index);
    const folders = new FolderProvider(index);
    const fuzzy = await collect<SearchResult>((publish, fail) => files.search('idx', { ...options, fuzzySearch: true }, publish, fail));
    assert.ok(fuzzy.some(result => result.description === 'src/index.ts'));
    assert.equal((await collect<SearchResult>((publish, fail) => files.search('output', options, publish, fail))).length, 0);
    assert.ok((await collect<SearchResult>((publish, fail) => files.search('output', { ...options, excludeGitIgnored: false }, publish, fail))).some(result => result.description === 'build/output.js'));
    assert.equal((await collect<SearchResult>((publish, fail) => files.search('guide.pdf', options, publish, fail))).length, 0);
    assert.ok((await collect<SearchResult>((publish, fail) => files.search('guide.pdf', { ...options, excludeSearchIgnored: false }, publish, fail))).length > 0);
    assert.ok((await collect<SearchResult>((publish, fail) => folders.search('scmp', { ...options, fuzzySearch: true }, publish, fail))).some(result => result.description === 'src/components'));
    const matches = await collect<TextMatch>((publish, fail) => text.search('HELLO WORLD', { ...options, maxResults: 200 }, publish, fail));
    assert.ok(matches.some(result => result.relativePath === 'src/index.ts' && result.lineNumber === 1));
    const ignored = await collect<TextMatch>((publish, fail) => text.search('built', { ...options, maxResults: 200 }, publish, fail));
    assert.ok(ignored.every(result => !result.relativePath.startsWith('build/')));
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('searchPlusPlus.open'));
    for (const command of ['searchPlusPlus.openFiles', 'searchPlusPlus.openText', 'searchPlusPlus.openSymbols', 'searchPlusPlus.openCommands']) {
      await vscode.commands.executeCommand(command);
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    }
    await vscode.commands.executeCommand('searchPlusPlus.reindex');
    console.log(`search++ extension-host smoke passed on VS Code ${vscode.version}`);
    if (process.env.SEARCH_PLUS_PLUS_HOST_REPORT) {
      await writeFile(process.env.SEARCH_PLUS_PLUS_HOST_REPORT, JSON.stringify({ version: vscode.version, checks: 'activation, file and folder search, exclusions, ripgrep, modal commands, reindex' }));
    }
  } finally { text.dispose(); index.dispose(); rules.dispose(); }
}
