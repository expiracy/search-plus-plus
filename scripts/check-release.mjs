import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Stable Marketplace releases must identify the same version in all manifests. */
export function validateRelease(tag, manifest, lockfile) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) {
    throw new Error('Use a stable release tag such as v2.1.1.');
  }
  if (tag !== `v${manifest.version}`) {
    throw new Error(`Release tag ${tag} does not match package.json version ${manifest.version}.`);
  }
  if (lockfile.version !== manifest.version || lockfile.packages?.['']?.version !== manifest.version) {
    throw new Error('package-lock.json and package.json must have the same version.');
  }
  return manifest.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lockfile = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const tag = process.env.RELEASE_TAG ?? process.argv[2];
  validateRelease(tag, manifest, lockfile);
  console.log(`Validated ${tag} for ${manifest.publisher}.${manifest.name}.`);
}
