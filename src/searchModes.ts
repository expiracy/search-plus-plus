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
  SearchMode.Symbol, SearchMode.Usages, SearchMode.Command,
];

/** Reorder known modes and append missing ones so every mode remains reachable. */
export function getTabOrder(raw: unknown): SearchMode[] {
  const configured = Array.isArray(raw)
    ? raw.filter((mode): mode is SearchMode => DEFAULT_TAB_ORDER.includes(mode)) : [];
  return [...new Set([...configured, ...DEFAULT_TAB_ORDER])];
}
