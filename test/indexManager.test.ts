import { afterEach, expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const { IndexManager } = await import('../src/index/indexManager');
afterEach(() => vi.restoreAllMocks());

test('overlapping rebuild requests serialize discovery and publish readiness only after the last build', async () => {
  const manager = new IndexManager({} as any);
  const finishes: Array<() => void> = [];
  vi.spyOn(manager.gitIgnore, 'load').mockResolvedValue();
  const build = vi.spyOn(manager.fileIndex, 'build').mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  try {
    const first = manager.buildAll();
    await Promise.resolve();
    const second = manager.reindex();
    await Promise.resolve();
    expect(build).toHaveBeenCalledTimes(1);
    finishes[0]();
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    expect(manager.state).toBe('building');
    finishes[1]();
    await Promise.all([first, second]);
    expect(manager.state).toBe('ready');
  } finally { manager.dispose(); }
});
