import type { WorkspaceConfiguration } from 'vscode';
import { SEARCH_SCOPES } from './searchModes';

export const RESULT_SETTING_ALIASES = {
  resultsPerSearchType: 'maxResults', resultsPerEverythingGroup: 'everywhere.resultLimit', searchDelay: 'debounceMs',
  gitIgnoreRules: 'excludeGitIgnored', searchIgnoreRules: 'excludeSearchIgnored', excludedPaths: 'excludePaths',
} as const;

export function getResultSetting<T>(config: Pick<WorkspaceConfiguration, 'get' | 'inspect'>, key: keyof typeof RESULT_SETTING_ALIASES, fallback: T): T {
  const oldKey = RESULT_SETTING_ALIASES[key];
  const current = config.inspect<T>(key), previous = config.inspect<T>(oldKey);
  for (const scope of [...SEARCH_SCOPES].reverse()) {
    const value = current?.[scope] !== undefined ? current[scope] : previous?.[scope];
    if (value !== undefined) return value;
  }
  return config.get<T>(key, config.get<T>(oldKey, fallback));
}
