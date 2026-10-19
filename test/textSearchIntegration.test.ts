import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { TextSearch } = await import('../src/index/textSearch');
let root: string;
let search: InstanceType<typeof TextSearch>;
const options = { caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: true, excludeSearchIgnored: true, maxResults: 200 };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'search-plus-plus-text-'));
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(root), name: 'workspace', index: 0 }];
  vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation(value => path.relative(root, typeof value === 'string' ? value : value.fsPath));
  search = new TextSearch();
});
afterEach(async () => { search.dispose(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

function collect(query: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Search timed out')), 5000);
    search.search(query, options, results => { clearTimeout(timer); resolve(results); }, reject);
  });
}

test('text search includes hidden source files that file search can discover', async () => {
  await writeFile(path.join(root, '.config'), 'hiddenneedle\n');
  const results = await collect('hiddenneedle');
  expect(results.map(r => r.relativePath)).toEqual(['.config']);
});

test('workspace gitignore rules also apply to folders without a Git repository', async () => {
  await mkdir(path.join(root, 'build'));
  await writeFile(path.join(root, '.gitignore'), 'build/\n');
  await writeFile(path.join(root, 'build/output.js'), 'generatedneedle\n');
  expect(await collect('generatedneedle')).toEqual([]);
});

test('notebook results contain cell source without a duplicate raw JSON match', async () => {
  const uri = vscode.Uri.file(path.join(root, 'example.ipynb'));
  await writeFile(uri.fsPath, JSON.stringify({ cells: [{ cell_type: 'code', source: ['print("notebookneedle")\n'] }] }));
  vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([uri]);
  vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(value => readFile(value.fsPath));
  const results = await collect('notebookneedle');
  expect(results.map(r => r.lineText)).toEqual(['print("notebookneedle")']);
});
