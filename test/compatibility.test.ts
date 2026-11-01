import { expect, test } from 'vitest';
import manifest from '../package.json';
import lockfile from '../package-lock.json';

test('the manifest and lockfile enforce the verified VS Code 1.109 minimum', () => {
  expect(manifest.engines.vscode).toBe('^1.109.0');
  expect(lockfile.packages[''].engines.vscode).toBe(manifest.engines.vscode);
  expect(manifest.devDependencies['@types/vscode']).toBe('1.109.0');
});
