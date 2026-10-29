import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRelease } from './check-release.mjs';

export async function prepareRelease(root, version) {
  if (typeof version !== 'string' || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    || version.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Enter a stable version such as 3.1.0, without a v prefix.');
  }
  const manifestPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  validateRelease(`v${manifest.version}`, manifest, lock);
  const next = version.split('.').map(Number);
  const current = manifest.version.split('.').map(Number);
  const changed = next.findIndex((part, index) => part !== current[index]);
  if (changed === -1 || next[changed] < current[changed]) {
    throw new Error('Choose a version newer than the current package version.');
  }
  manifest.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n'),
    writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n'),
  ]);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const version = await prepareRelease(root, process.env.RELEASE_VERSION ?? process.argv[2]);
  console.log(`Prepared v${version}.`);
}
