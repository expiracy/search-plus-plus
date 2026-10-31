import * as vscode from 'vscode';
import { getSearchConfiguration, SEARCH_LABELS, SEARCH_TYPES } from './searchModes';

const replacements: Record<string, readonly string[]> = {
  enabledSearches: ['tabs', 'visibleTabs', 'everything.sources', 'everywhere.sections'],
  showEverythingTab: ['tabs', 'visibleTabs'],
  searchOrder: ['tabs', 'tabOrder', 'everything.order', 'everywhere.sections'],
  whenSearchOpens: ['rememberLastMode', 'defaultMode'],
};
const legacyKeys = [...new Set(Object.values(replacements).flat())];

export async function migrateSearchSettings(): Promise<void> {
  const plans = ([
    ['globalValue', vscode.ConfigurationTarget.Global],
    ['workspaceValue', vscode.ConfigurationTarget.Workspace],
  ] as const).map(([scope, target]) => {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const previous = legacyKeys.filter(key => config.inspect(key)?.[scope] !== undefined);
    const preferences = getSearchConfiguration(config, scope);
    const values: Record<string, unknown> = {
      enabledSearches: Object.fromEntries(SEARCH_TYPES.map(mode => [SEARCH_LABELS[mode], preferences.enabled.includes(mode)])),
      showEverythingTab: preferences.showEverythingTab,
      searchOrder: preferences.order.map(mode => SEARCH_LABELS[mode]),
      whenSearchOpens: preferences.opening,
    };
    const updates: Array<[string, unknown]> = [];
    for (const [key, oldKeys] of Object.entries(replacements)) {
      const invalidSelection = key === 'enabledSearches' && !preferences.hasEnabledSearches && config.inspect(key)?.[scope] !== undefined;
      if (!invalidSelection && !oldKeys.some(oldKey => previous.includes(oldKey))) continue;
      if (JSON.stringify(config.inspect(key)?.[scope]) !== JSON.stringify(values[key])) updates.push([key, values[key]]);
    }
    return { config, target, previous, updates };
  });
  for (const plan of plans) {
    for (const [key, value] of plan.updates) await plan.config.update(key, value, plan.target);
  }
  for (const plan of plans) {
    for (const key of plan.previous) await plan.config.update(key, undefined, plan.target);
  }
}
