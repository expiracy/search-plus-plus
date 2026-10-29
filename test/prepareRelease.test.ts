import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareRelease } from '../scripts/prepare-release.mjs';

let root: string;
const manifest = { name: 'search-plus-plus', version: '3.0.4', publisher: 'expiracy' };
const lock = { version: '3.0.4', lockfileVersion: 3, packages: { '': { version: '3.0.4' }, 'node_modules/example': { version: '1.0.0' } } };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'searchpp-release-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('a manually chosen version updates every release manifest while preserving package metadata', async () => {
  expect(await prepareRelease(root, '3.1.0')).toBe('3.1.0');
  expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual({ ...manifest, version: '3.1.0' });
  const updated = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  expect(updated.version).toBe('3.1.0');
  expect(updated.packages[''].version).toBe('3.1.0');
  expect(updated.packages['node_modules/example'].version).toBe('1.0.0');
});

test('malformed release input is rejected without modifying either manifest', async () => {
  await expect(prepareRelease(root, '3.1.0\ninvalid')).rejects.toThrow('stable version');
  expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual(manifest);
  expect(JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))).toEqual(lock);
});


test('a release must advance the current version before any file is changed', async () => {
  await expect(prepareRelease(root, '3.0.4')).rejects.toThrow('newer');
  expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual(manifest);
});

test('version boundaries reject downgrades and non-stable values without writes', async () => {
  for (const version of ['2.99.99', '3.0.3', 'v3.1.0', '3.1.0-beta.1', '03.1.0', '3.1.0\n', '', undefined]) {
    await expect(prepareRelease(root, version)).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual(manifest);
  }
  expect(await prepareRelease(root, '3.0.10')).toBe('3.0.10');
});
