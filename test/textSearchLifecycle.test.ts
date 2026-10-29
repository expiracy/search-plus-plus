import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => ({ spawn }));
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { TextSearch } = await import('../src/index/textSearch');

const options = { caseSensitive: false, useRegex: false, matchWholeWord: false, excludeGitIgnored: false, excludeSearchIgnored: false, maxResults: 200 };
let search: InstanceType<typeof TextSearch>;
let process: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }];
  vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation(value =>
    (typeof value === 'string' ? value : value.fsPath).replace('/workspace/', ''),
  );
  vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);
  process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  spawn.mockReturnValue(process);
  search = new TextSearch('rg-test');
});

afterEach(() => { search.dispose(); vi.restoreAllMocks(); spawn.mockReset(); });

function match(line: string, text = 'needle', filePath = '/workspace/file.ts') {
  const start = Buffer.byteLength(line.slice(0, line.indexOf(text)));
  process.stdout.write(JSON.stringify({
    type: 'match', data: {
      path: { text: filePath }, lines: { text: line + '\n' }, line_number: 1,
      submatches: [{ start, end: start + Buffer.byteLength(text), match: { text } }],
    },
  }) + '\n');
}

test('UTF-8 byte offsets become UTF-16 editor columns', async () => {
  const publish = vi.fn();
  search.search('needle', options, publish);
  match('é🙂 needle');
  process.emit('close', 0);
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  expect(publish.mock.lastCall![0][0].column).toBe(4);
});

test('a missing ripgrep executable is reported as a failure rather than an empty successful search', () => {
  const fail = vi.fn();
  const publish = vi.fn();
  search.search('needle', options, publish, fail);
  process.emit('error', new Error('spawn rg ENOENT'));
  expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ENOENT') }));
  expect(publish).not.toHaveBeenCalled();
});

test('ripgrep diagnostics reach the caller when a regex fails', async () => {
  const fail = vi.fn();
  search.search('[', { ...options, useRegex: true }, vi.fn(), fail);
  process.stderr.write('regex parse error: unclosed character class');
  process.emit('close', 2);
  await vi.waitFor(() => expect(fail).toHaveBeenCalled());
  expect(fail.mock.lastCall![0].message).toContain('unclosed character class');
});

test('cancellation suppresses completion after an outstanding notebook lookup', async () => {
  let finish!: (uris: vscode.Uri[]) => void;
  vi.mocked(vscode.workspace.findFiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const publish = vi.fn();
  const request = search.search('needle', options, publish);
  process.emit('close', 0);
  request.dispose();
  finish([]);
  await new Promise(setImmediate);
  expect(publish).not.toHaveBeenCalled();
});

test('a notebook source replaces the workspace notebook lookup', async () => {
  search.dispose();
  const source = vi.fn(async () => [vscode.Uri.file('/workspace/nb.ipynb')]);
  search = new TextSearch('rg-test', undefined, source);
  vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode(
    JSON.stringify({ cells: [{ cell_type: 'code', source: ['x = 1\n', 'needle = 2\n'] }] }),
  ));
  const publish = vi.fn();
  search.search('needle', { ...options, excludeGitIgnored: true }, publish);
  process.emit('close', 0);
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  expect(vscode.workspace.findFiles).not.toHaveBeenCalled();
  expect(source).toHaveBeenCalledWith(expect.objectContaining({ excludeGitIgnored: true, excludeSearchIgnored: false }));
  expect(publish.mock.lastCall![0].map((r: any) => [r.relativePath, r.lineNumber])).toEqual([['nb.ipynb', 1]]);
});

test('shared exclusions apply before text matches consume the result limit', async () => {
  search.dispose();
  search = new TextSearch('rg-test', { shouldExclude: (p: string) => p.startsWith('hidden/') } as any);
  const publish = vi.fn();
  search.search('needle', { ...options, maxResults: 1 }, publish);
  match('needle', 'needle', '/workspace/hidden/file.ts');
  match('needle', 'needle', '/workspace/visible/file.ts');
  process.emit('close', 0);
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  expect(publish.mock.lastCall![0].map((r: any) => r.relativePath)).toEqual(['visible/file.ts']);
});

test('turning match case off requests case-insensitive matching even for uppercase queries', () => {
  search.search('NEEDLE', options, vi.fn());
  expect(spawn.mock.lastCall![1]).toContain('--ignore-case');
  expect(spawn.mock.lastCall![1]).not.toContain('--smart-case');
});

test('Unicode output split between process chunks is decoded without corruption', async () => {
  const publish = vi.fn();
  search.search('needle', options, publish);
  const output = Buffer.from(JSON.stringify({ type: 'match', data: {
    path: { text: '/workspace/file.ts' }, lines: { text: 'é needle\n' }, line_number: 1,
    submatches: [{ start: 3, end: 9, match: { text: 'needle' } }],
  } }) + '\n');
  const split = output.indexOf(Buffer.from('é')) + 1;
  process.stdout.write(output.subarray(0, split));
  process.stdout.write(output.subarray(split));
  process.emit('close', 0);
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  expect(publish.mock.lastCall![0][0].lineText).toBe('é needle');
});

test('continuous output publishes progress without waiting for a quiet period', async () => {
  vi.useFakeTimers();
  try {
    const publish = vi.fn();
    search.search('needle', options, publish);
    match('needle');
    await vi.advanceTimersByTimeAsync(40);
    match('another needle');
    await vi.advanceTimersByTimeAsync(20);
    expect(publish).toHaveBeenCalled();
  } finally { search.dispose(); vi.useRealTimers(); }
});

test('completion is signaled once after the notebook stage finishes', async () => {
  let finish!: (uris: vscode.Uri[]) => void;
  vi.mocked(vscode.workspace.findFiles).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const complete = vi.fn();
  search.search('needle', options, vi.fn(), undefined, complete);
  process.emit('close', 0);
  expect(complete).not.toHaveBeenCalled();
  finish([]);
  await new Promise(setImmediate);
  expect(complete).toHaveBeenCalledTimes(1);
});
