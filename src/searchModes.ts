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

/** Respect scope precedence while accepting both the unified list and legacy settings. */
export function getSearchTabs(config: Pick<WorkspaceConfiguration, 'get' | 'inspect'>): SearchMode[] {
  const setting = config.inspect('tabs');
  const order = config.inspect('tabOrder');
  const visible = config.inspect('visibleTabs');
  for (const scope of ['workspaceFolderValue', 'workspaceValue', 'globalValue'] as const) {
    if (setting?.[scope] !== undefined) return readTabs(setting[scope]);
    if (order?.[scope] !== undefined || visible?.[scope] !== undefined) {
      return getTabOrder(config.get('tabOrder'), config.get('visibleTabs'));
    }
  }
  return readTabs(config.get('tabs', DEFAULT_TAB_ORDER));
}

function readTabs(raw: unknown): SearchMode[] {
  const names: Record<string, SearchMode> = {
    Everything: SearchMode.Everywhere, Files: SearchMode.File, Folders: SearchMode.Folder,
    Text: SearchMode.Text, Symbols: SearchMode.Symbol, Commands: SearchMode.Command,
  };
  if (!Array.isArray(raw)) return [...DEFAULT_TAB_ORDER];
  const modes = raw.filter((value): value is string => typeof value === 'string')
    .map(value => names[value] ?? getTabMode(value as SearchMode))
    .filter(mode => DEFAULT_TAB_ORDER.includes(mode));
  return modes.length ? [...new Set(modes)] : [SearchMode.Everywhere];
}
