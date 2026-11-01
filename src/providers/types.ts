import * as vscode from 'vscode';

import { SearchMode } from '../searchModes';
import { getResultSetting } from '../resultSettings';
export { SearchMode } from '../searchModes';

export enum ResultSection {
  Folders = 'folders',
  Files = 'files',
  Text = 'text',
  Symbols = 'symbols',
  Commands = 'commands',
}

export interface SearchResult extends vscode.QuickPickItem {
  mode: SearchMode;
  uri?: vscode.Uri;
  lineNumber?: number;
  column?: number;
  /** Links a result to its display category */
  belongsToSection?: ResultSection;
  /** Whether this result represents a folder (changes selection behavior) */
  isFolder?: boolean;
  /** Command ID for executable command results */
  commandId?: string;
  /** Number of additional results hidden behind a "see more" indicator */
  moreCount?: number;
}

export interface UsageTarget {
  uri: vscode.Uri;
  position: vscode.Position;
  name: string;
}

export interface SearchOptions {
  usageTarget?: UsageTarget;
  excludeGitIgnored: boolean;
  excludeSearchIgnored: boolean;
  caseSensitive: boolean;
  useRegex: boolean;
  fuzzySearch: boolean;
  matchWholeWord: boolean;
}

export const DEFAULT_EVERYWHERE_LIMIT = 20;
export const DEFAULT_MAX_RESULTS = 200;

export function getMaxResults(): number {
  const value = getResultSetting(vscode.workspace.getConfiguration('searchPlusPlus'), 'resultsPerSearchType', DEFAULT_MAX_RESULTS);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : DEFAULT_MAX_RESULTS;
}

export interface TextSearchOptions extends Omit<SearchOptions, 'fuzzySearch'> {
  maxResults: number;
}

export const DEFAULT_SECTIONS: ResultSection[] = [
  ResultSection.Files,
  ResultSection.Folders,
  ResultSection.Symbols,
  ResultSection.Text,
  ResultSection.Commands,
];

export interface SearchProvider {
  readonly mode: SearchMode;

  /**
   * Perform a search. Returns results incrementally via the callback.
   * Returns a Disposable that cancels the in-flight search when disposed.
   */
  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
    onError?: (error: unknown) => void,
  ): vscode.Disposable;
}
