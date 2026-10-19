import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { GitIgnoreManager } = await import('../src/gitignore');
let manager: InstanceType<typeof GitIgnoreManager>;
let files: Record<string, string>;

beforeEach(() => {
  files = {};
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }];
  vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation(value =>
    (typeof value === 'string' ? value : value.fsPath).replace('/workspace/', ''),
  );
  vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(async (glob: string) =>
    Object.keys(files).filter(p => p.endsWith(glob.slice(3))).map(p => vscode.Uri.file(p)),
  );
  vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async uri => new TextEncoder().encode(files[uri.fsPath]));
  manager = new GitIgnoreManager();
});

afterEach(() => {
  manager.dispose();
  vi.restoreAllMocks();
});

test('nested basename rules apply to deeper descendants without leaking outside the directory', async () => {
  files['/workspace/src/.gitignore'] = '*.log\n';
  await manager.load();
  expect(manager.isGitIgnored('src/deep/application.log')).toBe(true);
  expect(manager.isGitIgnored('application.log')).toBe(false);
});

test('one workspace root cannot exclude files in another root with the same relative paths', async () => {
  vscode.workspace.workspaceFolders.push({ uri: vscode.Uri.file('/other'), name: 'other', index: 1 });
  files['/workspace/.gitignore'] = 'src/\n';
  await manager.load();
  expect(manager.isGitIgnored('workspace/src/index.ts', vscode.Uri.file('/workspace/src/index.ts'))).toBe(true);
  expect(manager.isGitIgnored('other/src/index.ts', vscode.Uri.file('/other/src/index.ts'))).toBe(false);
});

test('the file index evaluates exclusions in the URI workspace rather than its display path', async () => {
  vscode.workspace.workspaceFolders.push({ uri: vscode.Uri.file('/other'), name: 'other', index: 1 });
  files['/workspace/.gitignore'] = 'src/\n';
  await manager.load();
  vi.mocked(vscode.workspace.asRelativePath).mockImplementation(value =>
    (typeof value === 'string' ? value : value.fsPath).slice(1),
  );
  vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
    vscode.Uri.file('/workspace/src/index.ts'), vscode.Uri.file('/other/src/index.ts'),
  ]);
  const { FileIndex } = await import('../src/index/fileIndex');
  const index = new FileIndex(manager);
  try {
    await index.build();
    expect(index.filter('index').map(e => e.uri.fsPath)).toEqual(['/other/src/index.ts']);
  } finally { index.dispose(); }
});

test('every concurrent load caller waits until a complete policy is available', async () => {
  files['/workspace/.gitignore'] = '*.log\n';
  const reads: Array<(value: Uint8Array) => void> = [];
  vi.mocked(vscode.workspace.fs.readFile).mockImplementation(() => new Promise(resolve => { reads.push(resolve); }));
  const first = manager.load();
  const second = manager.load();
  try {
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(0));
    reads[0](new TextEncoder().encode('*.log\n'));
    await first;
    expect(manager.isGitIgnored('application.log')).toBe(true);
  } finally {
    for (const finish of reads) finish(new TextEncoder().encode('*.log\n'));
    await Promise.all([first, second]);
  }
});
