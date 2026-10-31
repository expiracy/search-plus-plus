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
