import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ignore from 'ignore';

vi.mock('vscode', () => import('./__mocks__/vscode'));

const vscode = await import('./__mocks__/vscode');
const { GitIgnoreManager } = await import('../src/gitignore');
const { FileIndex } = await import('../src/index/fileIndex');
const { FileProvider } = await import('../src/providers/fileProvider');

describe('workspace discovery', () => {
  let rules: InstanceType<typeof GitIgnoreManager>;
  let index: InstanceType<typeof FileIndex>;

  beforeEach(() => {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }];
    vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation((value) =>
      (typeof value === 'string' ? value : value.fsPath).replace('/workspace/', ''),
    );
    rules = new GitIgnoreManager();
    index = new FileIndex(rules);
  });

  afterEach(() => {
    index.dispose();
    rules.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('an ignored directory becomes searchable when its exclusion toggle is off', async () => {
    const paths = ['.gitignore', 'build/output.js', 'src/index.ts'];
    vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('build/\n'));
    vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(async (pattern: string, exclude?: string) => {
      if (pattern === '**/.gitignore') return [vscode.Uri.file('/workspace/.gitignore')];
      if (pattern !== '**/*') return [];
      const excluded = ignore().add(exclude?.replace(/^\{|\}$/g, '').split(',') ?? []);
      return paths.filter(p => !excluded.ignores(p)).map(p => vscode.Uri.file(`/workspace/${p}`));
    });

    await rules.load();
    await index.build();

    expect(index.filter('output', 200, true)).toEqual([]);
    expect(index.filter('output', 200, false).map(e => e.relativePath)).toEqual(['build/output.js']);
  });

  test('a rebuild keeps the last usable snapshot until discovery finishes', async () => {
    index.buildFromEntries([{ relativePath: 'src/index.ts', uri: vscode.Uri.file('/workspace/src/index.ts') }]);
    let finish!: (uris: vscode.Uri[]) => void;
    vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(() => new Promise(resolve => { finish = resolve; }));

    const building = index.build();
    expect(index.filter('index').map(e => e.relativePath)).toEqual(['src/index.ts']);
    finish([vscode.Uri.file('/workspace/src/new.ts')]);
    await building;
    expect(index.filter('new').map(e => e.relativePath)).toEqual(['src/new.ts']);
    expect(index.filter('index')).toEqual([]);
  });

  test('uppercase fuzzy queries still match lowercase paths when match case is off', () => {
    index.buildFromEntries([{ relativePath: 'src/index.ts', uri: vscode.Uri.file('/workspace/src/index.ts') }]);
    expect(index.find('INDEX', 200, true, true, false).map(r => r.item.relativePath)).toEqual(['src/index.ts']);
    expect(index.find('INDEX', 200, true, true, true)).toEqual([]);
  });

  test('excluded fuzzy matches do not consume the result budget', () => {
    vi.spyOn(rules, 'isSearchIgnored').mockImplementation(p => p.startsWith('hidden/'));
    const paths = [...Array.from({ length: 1100 }, (_, i) => `hidden/match${i}.ts`), 'visible/very/long/path/match.ts'];
    index.buildFromEntries(paths.map(relativePath => ({ relativePath, uri: vscode.Uri.file(`/workspace/${relativePath}`) })));
    expect(index.find('match', 20).map(r => r.item.relativePath)).toEqual(['visible/very/long/path/match.ts']);
  });

  test('searching before the first build uses the same fuzzy path matching as the ready index', async () => {
    vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(async (pattern: string) =>
      pattern === '**/*' ? [vscode.Uri.file('/workspace/src/index.ts')] : [],
    );
    const provider = new FileProvider(index);
    const results = await new Promise<any[]>(resolve => {
      provider.search('idx', {
        fuzzySearch: true, caseSensitive: false, useRegex: false, matchWholeWord: false,
        excludeGitIgnored: true, excludeSearchIgnored: true,
      }, resolve);
    });
    expect(results.map(r => r.description)).toEqual(['src/index.ts']);
  });

  test('deleting a directory removes all indexed descendants', async () => {
    vi.useFakeTimers();
    const deleted = new vscode.EventEmitter<vscode.Uri>();
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue({
      onDidCreate: () => ({ dispose() {} }), onDidChange: () => ({ dispose() {} }),
      onDidDelete: deleted.event, dispose() {},
    });
    vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([vscode.Uri.file('/workspace/src/index.ts')]);
    await index.build();
    deleted.fire(vscode.Uri.file('/workspace/src'));
    await vi.advanceTimersByTimeAsync(350);
    expect(index.filter('index')).toEqual([]);
  });

  test('a file created and deleted in the same batch is not resurrected', async () => {
    vi.useFakeTimers();
    const created = new vscode.EventEmitter<vscode.Uri>();
    const deleted = new vscode.EventEmitter<vscode.Uri>();
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue({
      onDidCreate: created.event, onDidChange: () => ({ dispose() {} }), onDidDelete: deleted.event, dispose() {},
    });
    vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);
    await index.build();
    const uri = vscode.Uri.file('/workspace/temporary.ts');
    created.fire(uri);
    deleted.fire(uri);
    await vi.advanceTimersByTimeAsync(350);
    expect(index.filter('temporary')).toEqual([]);
  });

  test('directory creation events never become file results', async () => {
    vi.useFakeTimers();
    const created = new vscode.EventEmitter<vscode.Uri>();
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue({
      onDidCreate: created.event, onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {},
    });
    vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([]);
    vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({ type: vscode.FileType.Directory });
    await index.build();
    created.fire(vscode.Uri.file('/workspace/new-folder'));
    await vi.advanceTimersByTimeAsync(350);
    expect(index.filter('new-folder')).toEqual([]);
  });

  test('files created during discovery survive publication of an older filesystem snapshot', async () => {
    const created = new vscode.EventEmitter<vscode.Uri>();
    vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue({
      onDidCreate: created.event, onDidChange: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {},
    });
    vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({ type: vscode.FileType.File });
    let finish!: (uris: vscode.Uri[]) => void;
    vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const building = index.build();
    created.fire(vscode.Uri.file('/workspace/new.ts'));
    await Promise.resolve();
    finish([]);
    await building;
    expect(index.filter('new').map(r => r.relativePath)).toEqual(['new.ts']);
  });
});
