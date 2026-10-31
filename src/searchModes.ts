import type { WorkspaceConfiguration } from 'vscode';

export enum SearchMode {
  Everywhere = 'everywhere',
  File = 'file',
  Folder = 'folder',
  Text = 'text',
  Symbol = 'symbol',
  Command = 'command',
  Usages = 'usages',
}


export const DEFAULT_TAB_ORDER: readonly SearchMode[] = [
  SearchMode.Everywhere, SearchMode.File, SearchMode.Folder, SearchMode.Text,
  SearchMode.Symbol, SearchMode.Command,
];

export function getTabMode(mode: SearchMode): SearchMode {
  return mode === SearchMode.Usages ? SearchMode.Symbol : mode;
}

/** Normalize the tab order and optionally filter visibility, keeping one usable tab. */
export function getTabOrder(raw: unknown, visibleTabs?: unknown): SearchMode[] {
  const configured = Array.isArray(raw)
    ? raw.map(mode => getTabMode(mode))
      .filter((mode): mode is SearchMode => DEFAULT_TAB_ORDER.includes(mode)) : [];
  const ordered = [...new Set([...configured, ...DEFAULT_TAB_ORDER])];
  if (!Array.isArray(visibleTabs)) return ordered;
  const visible = new Set(visibleTabs.map(mode => getTabMode(mode)));
  const filtered = ordered.filter(mode => visible.has(mode));
  return filtered.length ? filtered : [ordered[0]];
}

export const SEARCH_TYPES = DEFAULT_TAB_ORDER.filter(mode => mode !== SearchMode.Everywhere);
export const SEARCH_LABELS: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Everything', [SearchMode.File]: 'Files', [SearchMode.Folder]: 'Folders',
  [SearchMode.Text]: 'Text', [SearchMode.Symbol]: 'Symbols', [SearchMode.Command]: 'Commands', [SearchMode.Usages]: 'Symbols',
};
export const SEARCH_SCOPES = ['globalValue', 'workspaceValue', 'workspaceFolderValue'] as const;
export type SearchScope = typeof SEARCH_SCOPES[number];
type Configuration = Pick<WorkspaceConfiguration, 'get' | 'inspect'>;

function readModes(raw: unknown): SearchMode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names: Record<string, SearchMode> = { everything: SearchMode.Everywhere, files: SearchMode.File, folders: SearchMode.Folder, symbols: SearchMode.Symbol, commands: SearchMode.Command };
  return [...new Set(raw.filter((value): value is string => typeof value === 'string')
    .map(value => names[value.toLowerCase()] ?? getTabMode(value.toLowerCase() as SearchMode))
    .filter(mode => DEFAULT_TAB_ORDER.includes(mode)))];
}

export function getSearchConfiguration(config: Configuration, through: SearchScope = 'workspaceFolderValue') {
  let order = getTabOrder(readModes(config.inspect('searchOrder')?.defaultValue));
  let showEverythingTab = config.inspect('showEverythingTab')?.defaultValue !== false;
  const initialOpening = config.inspect('whenSearchOpens')?.defaultValue;
  let remember = initialOpening === 'last';
  let defaultMode = readModes([initialOpening])?.[0] ?? SearchMode.Everywhere;
  const types = Object.fromEntries(SEARCH_TYPES.map(mode => [mode, true]));
  const applyTypes = (raw: unknown, intersect = false) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const mode of SEARCH_TYPES) {
      const value = (raw as Record<string, unknown>)[SEARCH_LABELS[mode]];
      if (typeof value === 'boolean') types[mode] = intersect ? types[mode] && value : value;
    }
  };
  applyTypes(config.inspect('enabledSearches')?.defaultValue);
  for (const scope of SEARCH_SCOPES) {
    const value = (key: string) => config.inspect(key)?.[scope];
    const oldOrder = readModes(value('tabs')) ?? readModes(value('tabOrder'));
    if (oldOrder) order = getTabOrder(oldOrder);
    const visible = readModes(value('tabs')) ?? readModes(value('visibleTabs'));
    if (visible) {
      for (const mode of SEARCH_TYPES) types[mode] = visible.includes(mode);
      showEverythingTab = visible.includes(SearchMode.Everywhere);
    }
    const oldSections = readModes(value('everywhere.sections'));
    const oldSources = value('everything.sources');
    if (oldSources && typeof oldSources === 'object') applyTypes(oldSources, !!visible);
    else if (oldSections) {
      for (const mode of SEARCH_TYPES) types[mode] = (visible ? types[mode] : true) && oldSections.includes(mode);
    }
    if (!oldOrder) {
      const sourceOrder = readModes(value('everything.order')) ?? oldSections;
      if (sourceOrder) order = getTabOrder([SearchMode.Everywhere, ...sourceOrder]);
    }
    if (typeof value('rememberLastMode') === 'boolean') remember = value('rememberLastMode') as boolean;
    const oldDefault = readModes([value('defaultMode')])?.[0];
    if (oldDefault) defaultMode = oldDefault;
    applyTypes(value('enabledSearches'));
    if (typeof value('showEverythingTab') === 'boolean') showEverythingTab = value('showEverythingTab') as boolean;
    const sharedOrder = readModes(value('searchOrder'));
    if (sharedOrder) order = getTabOrder(sharedOrder);
    if (value('whenSearchOpens') === 'last') remember = true;
    else {
      const opening = readModes([value('whenSearchOpens')])?.[0];
      if (opening) { remember = false; defaultMode = opening; }
    }
    if (scope === through) break;
  }
  const chosen = SEARCH_TYPES.filter(mode => types[mode]);
  const hasEnabledSearches = chosen.length > 0;
  const enabled: SearchMode[] = hasEnabledSearches ? chosen : [order.find(mode => mode !== SearchMode.Everywhere)!];
  const tabs = order.filter(mode => mode === SearchMode.Everywhere ? showEverythingTab : enabled.includes(mode));
  return { enabled, order, tabs, showEverythingTab, opening: remember ? 'last' as const : defaultMode, hasEnabledSearches };
}

export function getSearchTabs(config: Configuration): SearchMode[] {
  return getSearchConfiguration(config).tabs;
}
