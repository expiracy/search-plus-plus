import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { ResultPreview } = await import('../src/ui/resultPreview');
let group: any;
let close: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  group = { viewColumn: 1, tabs: [] };
  vscode.window.tabGroups.all = [group]; vscode.window.tabGroups.activeTabGroup = group;
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command: string, uri: any, options: any) => {
    const destination = vscode.window.tabGroups.all.find(group => group.viewColumn === options?.viewColumn) ?? group;
    if (command === 'vscode.open' && !destination.tabs.some((tab: any) => tab.input.uri.toString() === uri.toString())) {
      destination.tabs.push({ input: new vscode.TabInputText(uri), group: destination, isDirty: false, isPinned: false, isPreview: false });
    }
  });
  close = vi.spyOn(vscode.window.tabGroups, 'close').mockImplementation(async (tab: any) => {
    group.tabs = group.tabs.filter((item: any) => item !== tab); return true;
  });
});
afterEach(() => vi.restoreAllMocks());

test('preview opens a resource at its match without taking focus', async () => {
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  const uri = vscode.Uri.file('/workspace/a.ts');
  const selection = new vscode.Range(new vscode.Position(7, 3), new vscode.Position(7, 3));
  await new ResultPreview().show(uri as any, selection as any);
  expect(open).toHaveBeenCalledWith('vscode.open', uri, expect.objectContaining({ preview: true, preserveFocus: true, selection }));
});

test('successive previews leave only one extra tab when native preview reuse is disabled', async () => {
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  const first = group.tabs[0];
  expect(group.tabs).toHaveLength(1);
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toHaveLength(1);
  expect(group.tabs[0].input.uri.path).toBe('/workspace/b.ts');
  expect(close).toHaveBeenCalledWith(first, true);
});

test('previewing an existing editor never takes ownership of that user tab', async () => {
  const uri = vscode.Uri.file('/workspace/existing.ts');
  const existing = { input: new vscode.TabInputText(uri), group, isDirty: false, isPinned: false, isPreview: false };
  group.tabs.push(existing);
  const preview = new ResultPreview();
  await preview.show(uri as any);
  await preview.show(vscode.Uri.file('/workspace/new.ts') as any);
  expect(group.tabs).toContain(existing);
  expect(group.tabs).toHaveLength(2);
  expect(close).not.toHaveBeenCalledWith(existing, expect.anything());
});

test('an edited preview becomes a kept document and is never closed automatically', async () => {
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  const edited = group.tabs[0]; edited.isDirty = true;
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toContain(edited);
  expect(close).not.toHaveBeenCalledWith(edited, expect.anything());
});

test('a pre-existing native preview tab is preserved when opening a search preview', async () => {
  const original = { input: new vscode.TabInputText(vscode.Uri.file('/workspace/original.ts')), group, isDirty: false, isPinned: false, isPreview: true };
  group.tabs.push(original);
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (_command: string, uri: any, options: any) => {
    if (options.preview) group.tabs = group.tabs.filter((tab: any) => !tab.isPreview);
    group.tabs.push({ input: new vscode.TabInputText(uri), group, isDirty: false, isPinned: false, isPreview: options.preview });
  });
  await new ResultPreview().show(vscode.Uri.file('/workspace/search.ts') as any);
  expect(group.tabs).toContain(original);
  expect(group.tabs).toHaveLength(2);
});

test('rapid requests serialize and skip queued previews superseded by a newer result', async () => {
  let finish!: () => void;
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  const backend = open.getMockImplementation()!;
  open.mockImplementationOnce(async (...args: any[]) => { await new Promise<void>(resolve => { finish = resolve; }); await backend(...args); });
  const preview = new ResultPreview();
  const first = preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  await Promise.resolve();
  const middle = preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  const last = preview.show(vscode.Uri.file('/workspace/c.ts') as any);
  expect(open).toHaveBeenCalledTimes(1);
  finish(); await Promise.all([first, middle, last]);
  expect(group.tabs).toHaveLength(1);
  expect(group.tabs[0].input.uri.path).toBe('/workspace/c.ts');
  expect(open.mock.calls.map(args => (args[1] as any).path)).toEqual(['/workspace/a.ts', '/workspace/c.ts']);
});

test('disposing cancels a preview that has not opened yet', async () => {
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  const preview = new ResultPreview();
  const pending = preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  preview.dispose(); await pending;
  expect(open).not.toHaveBeenCalled();
});

test('a native preview deliberately kept by the user is preserved', async () => {
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (_command: string, uri: any) => {
    group.tabs.push({ input: new vscode.TabInputText(uri), group, isDirty: false, isPinned: false, isPreview: true });
  });
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  const kept = group.tabs[0]; kept.isPreview = false;
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toContain(kept);
  expect(close).not.toHaveBeenCalledWith(kept, expect.anything());
});

test('a failed close cannot create a second preview tab', async () => {
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  close.mockResolvedValue(false);
  await expect(preview.show(vscode.Uri.file('/workspace/b.ts') as any)).rejects.toThrow();
  expect(group.tabs).toHaveLength(1);
});

test('preview reuses a matching editor in another group instead of duplicating it', async () => {
  const uri = vscode.Uri.file('/workspace/existing.ts');
  const other: any = { viewColumn: 2, tabs: [] };
  other.tabs.push({ input: new vscode.TabInputText(uri), group: other, isDirty: false, isPinned: false, isPreview: false });
  vscode.window.tabGroups.all.push(other);
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  await new ResultPreview().show(uri as any);
  expect(open).toHaveBeenCalledWith('vscode.open', uri, expect.objectContaining({ viewColumn: 2 }));
  expect(vscode.window.tabGroups.all.flatMap(group => group.tabs)).toHaveLength(1);
});

test('accepting a result waits for in-flight preview work and removes a different disposable preview', async () => {
  let finish!: () => void;
  const open = vi.spyOn(vscode.commands, 'executeCommand');
  const backend = open.getMockImplementation()!;
  open.mockImplementationOnce(async (...args: any[]) => { await new Promise<void>(resolve => { finish = resolve; }); await backend(...args); });
  const preview = new ResultPreview();
  const first = preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  await Promise.resolve();
  let accepted = false;
  const ready = preview.finish(vscode.Uri.file('/workspace/accepted.ts') as any).then(() => { accepted = true; });
  await Promise.resolve(); expect(accepted).toBe(false);
  finish(); await Promise.all([first, ready]);
  expect(group.tabs).toHaveLength(0);
});

test('tab model refreshes do not lose ownership of the preview slot', async () => {
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  group.tabs = group.tabs.map((tab: any) => ({ ...tab }));
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toHaveLength(1);
  expect(group.tabs[0].input.uri.path).toBe('/workspace/b.ts');
});

test('a different viewer for an existing file still occupies only the owned preview slot', async () => {
  const uri = vscode.Uri.file('/workspace/a.ts');
  const original = { input: new vscode.TabInputText(uri), group, isDirty: false, isPinned: false, isPreview: false };
  group.tabs.push(original);
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (_command: string, uri: any) => {
    group.tabs.push({ input: new vscode.TabInputCustom(uri), group, isDirty: false, isPinned: false, isPreview: false });
  });
  const preview = new ResultPreview();
  await preview.show(uri as any);
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toHaveLength(2);
  expect(group.tabs).toContain(original);
});

test('closing and reopening a file manually does not restore preview ownership', async () => {
  const changed = new vscode.EventEmitter<any>();
  vi.spyOn(vscode.window.tabGroups, 'onDidChangeTabs').mockImplementation(changed.event);
  const preview = new ResultPreview();
  await preview.show(vscode.Uri.file('/workspace/a.ts') as any);
  const previous = group.tabs.pop();
  changed.fire({ closed: [previous], opened: [], changed: [] });
  const reopened = { ...previous };
  group.tabs.push(reopened);
  await preview.show(vscode.Uri.file('/workspace/b.ts') as any);
  expect(group.tabs).toContain(reopened);
  expect(close).not.toHaveBeenCalledWith(reopened, expect.anything());
});
