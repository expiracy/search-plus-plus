import { SearchMode } from '../searchModes';

export const MODES = [
  { id: SearchMode.Everywhere, label: 'Everything', icon: 'search' },
  { id: SearchMode.File, label: 'Files', icon: 'file' },
  { id: SearchMode.Folder, label: 'Folders', icon: 'folder' },
  { id: SearchMode.Text, label: 'Text', icon: 'book' },
  { id: SearchMode.Symbol, label: 'Symbols', icon: 'symbol-method' },
  { id: SearchMode.Usages, label: 'Usages', icon: 'references' },
  { id: SearchMode.Command, label: 'Commands', icon: 'terminal' },
] as const;
export const OPTIONS = [
  { key: 'excludeGitIgnored', label: 'Exclude gitignored (Alt+G)', icon: 'source-control' },
  { key: 'excludeSearchIgnored', label: 'Exclude search ignored (Alt+S)', icon: 'eye-closed' },
  { key: 'caseSensitive', label: 'Match case (Alt+C)', icon: 'case-sensitive' },
  { key: 'useRegex', label: 'Text regex (Alt+R)', icon: 'regex' },
  { key: 'matchWholeWord', label: 'Whole word (Alt+W)', icon: 'whole-word' },
  { key: 'fuzzySearch', label: 'Fuzzy matching (Alt+F)', icon: 'sparkle' },
] as const;
export type OptionKey = typeof OPTIONS[number]['key'];
export interface ViewResult {
  id: string;
  label: string;
  description: string;
  detail?: string;
  icon: string;
  section?: string;
  canOpen: boolean;
  canFindUsages: boolean;
  recent?: boolean;
}
export interface ViewState {
  type: 'state';
  inputVersion: number;
  mode: SearchMode;
  query: string;
  scope: string;
  scopeRegex: boolean;
  options: Record<OptionKey, boolean>;
  results: ViewResult[];
  status: string;
  error?: string;
  busy: boolean;
  usageName?: string;
}
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'focus'; focused: boolean }
  | { type: 'input'; query: string; scope: string; inputVersion: number }
  | { type: 'mode'; mode: SearchMode }
  | { type: 'toggle'; option: OptionKey | 'scopeRegex' }
  | { type: 'select'; id: string }
  | { type: 'open'; id: string; beside?: boolean }
  | { type: 'usages'; id: string }
  | { type: 'removeRecent'; id: string }
  | { type: 'close' };
