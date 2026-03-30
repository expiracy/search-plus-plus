import * as vscode from 'vscode';

export enum SearchMode {
  Everywhere = 'everywhere',
  File = 'file',
  Folder = 'folder',
  Text = 'text',
  Symbol = 'symbol',
  Command = 'command',
}

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

export interface SearchOptions {
  excludeGitIgnored: boolean;
  excludeVscodeExcluded: boolean;
  caseSensitive: boolean;
  useRegex: boolean;
  fuzzySearch: boolean;
  matchWholeWord: boolean;
}

export const DEFAULT_EVERYWHERE_LIMIT = 20;

export const DEFAULT_SECTIONS: ResultSection[] = [
  ResultSection.Files,
  ResultSection.Folders,
  ResultSection.Text,
  ResultSection.Symbols,
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
  ): vscode.Disposable;
}
