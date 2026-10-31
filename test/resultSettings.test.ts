import { expect, test } from 'vitest';
import { getResultSetting } from '../src/resultSettings';

function configuration(user: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
  return { get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }) } as any;
}

test('the clearer result limit name takes precedence over its old name at the same scope', () => {
  expect(getResultSetting(configuration({ resultsPerSearchType: 40, maxResults: 10 }), 'resultsPerSearchType', 200)).toBe(40);
});

test('an older Workspace delay overrides a newer User delay until it is converted', () => {
  expect(getResultSetting(configuration({ searchDelay: 100 }, { debounceMs: 650 }), 'searchDelay', 300)).toBe(650);
});

test('clearer ignore and exclusion names retain false flags and path lists', () => {
  const config = configuration({ excludeGitIgnored: false, excludePaths: ['**/out/**'] });
  expect(getResultSetting(config, 'gitIgnoreRules', true)).toBe(false);
  expect(getResultSetting(config, 'excludedPaths', [])).toEqual(['**/out/**']);
});
