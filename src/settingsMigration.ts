import * as vscode from 'vscode';
import { getSearchConfiguration, SEARCH_LABELS, SEARCH_TYPES } from './searchModes';
import { RESULT_SETTING_ALIASES } from './resultSettings';

const replacements: Record<string, readonly string[]> = {
  everythingTabSources: ['enabledSearches', 'tabs', 'visibleTabs', 'everything.sources', 'everywhere.sections'],
  showEverythingTab: ['tabs', 'visibleTabs'],
  tabOrder: ['searchOrder', 'tabs', 'everything.order', 'everywhere.sections'],
  whenSearchOpens: ['rememberLastMode', 'defaultMode'],
};
const legacyKeys = [...new Set([...Object.values(replacements).flat(), ...Object.values(RESULT_SETTING_ALIASES)])];

export async function migrateSearchSettings(): Promise<void> {
  const plans = ([
    ['globalValue', vscode.ConfigurationTarget.Global],
    ['workspaceValue', vscode.ConfigurationTarget.Workspace],
  ] as const).map(([scope, target]) => {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const previous = legacyKeys.filter(key => config.inspect(key)?.[scope] !== undefined);
    const preferences = getSearchConfiguration(config, scope);
    const values: Record<string, unknown> = {
      everythingTabSources: Object.fromEntries(SEARCH_TYPES.map(mode => [SEARCH_LABELS[mode], preferences.enabled.includes(mode)])),
      showEverythingTab: preferences.showEverythingTab,
      tabOrder: preferences.order.map(mode => SEARCH_LABELS[mode]),
      whenSearchOpens: preferences.opening,
    };
    const updates: Array<[string, unknown]> = [];
    for (const [key, oldKeys] of Object.entries(replacements)) {
      const invalidSelection = key === 'everythingTabSources' && !preferences.hasEnabledSearches && config.inspect(key)?.[scope] !== undefined;
      const oldTabOrder = key === 'tabOrder' && config.inspect(key)?.[scope] !== undefined;
      if (!invalidSelection && !oldTabOrder && !oldKeys.some(oldKey => previous.includes(oldKey))) continue;
      if (JSON.stringify(config.inspect(key)?.[scope]) !== JSON.stringify(values[key])) updates.push([key, values[key]]);
    }
    for (const [key, oldKey] of Object.entries(RESULT_SETTING_ALIASES)) {
      if (previous.includes(oldKey) && config.inspect(key)?.[scope] === undefined) updates.push([key, config.inspect(oldKey)?.[scope]]);
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
