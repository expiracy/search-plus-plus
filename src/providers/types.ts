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
}

export interface SearchOptions {
  excludeGitIgnored: boolean;
  caseSensitive: boolean;
  useRegex: boolean;
  fuzzySearch: boolean;
  matchWholeWord: boolean;
}

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
