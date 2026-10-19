import { describe, expect, test } from 'vitest';
import { validateRelease } from '../scripts/check-release.mjs';

const manifest = { version: '2.1.1' };
const lockfile = { version: '2.1.1', packages: { '': { version: '2.1.1' } } };

describe('Marketplace release versions', () => {
  test('accepts a stable tag matching both manifests', () => {
    expect(validateRelease('v2.1.1', manifest, lockfile)).toBe('2.1.1');
  });
  test('rejects a tag for another extension version', () => {
    expect(() => validateRelease('v2.1.2', manifest, lockfile)).toThrow('does not match');
  });
  test('rejects an out-of-date lockfile', () => {
    expect(() => validateRelease('v2.1.1', manifest, { ...lockfile, version: '2.1.0' })).toThrow('same version');
  });
  test('rejects an out-of-date root package in the lockfile', () => {
    expect(() => validateRelease('v2.1.1', manifest, { ...lockfile, packages: { '': { version: '2.1.0' } } })).toThrow('same version');
  });
  test.each([undefined, 'master', '2.1.1', 'v02.1.1', 'v2.1.1-beta.1'])('rejects the non-release ref %s', tag => {
    expect(() => validateRelease(tag, manifest, lockfile)).toThrow('stable release tag');
  });
});
