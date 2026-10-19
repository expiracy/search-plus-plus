import * as vscode from 'vscode';
import { ResultSection, SearchMode, getMaxResults, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileIndex } from '../index/fileIndex';

export class FileProvider implements SearchProvider {
  readonly mode = SearchMode.File;

  constructor(private fileIndex: FileIndex) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
    onError?: (error: unknown) => void,
  ): vscode.Disposable {
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      const maxResults = getMaxResults();

      let fileResults: SearchResult[];

      // Whole-word matching is inherently non-fuzzy, so it forces the substring path
      if (options.fuzzySearch && !options.matchWholeWord) {
        const matches = this.fileIndex.find(
          query, maxResults, options.excludeGitIgnored,
          options.excludeSearchIgnored, options.caseSensitive, options.pathFilter,
        );
        fileResults = matches.map((match) => this.toFileResult(match.item.relativePath, match.item.uri));
      } else {
        const entries = this.fileIndex.filter(
          query, maxResults, options.excludeGitIgnored,
          options.caseSensitive, options.matchWholeWord,
          options.excludeSearchIgnored, options.pathFilter,
        );
        fileResults = entries.map((entry) => this.toFileResult(entry.relativePath, entry.uri));
      }

      if (!cancelled) {
        onResults(fileResults);
      }
    };
    if (this.fileIndex.isReady) run();
    else void this.fileIndex.ensureReady().then(run, error => {
      if (!cancelled) {
        if (onError) onError(error);
        else onResults([]);
      }
    });

    return { dispose: () => { cancelled = true; } };
  }

  private toFileResult(relativePath: string, uri: vscode.Uri): SearchResult {
    return {
      label: relativePath.split('/').pop() || relativePath,
      description: relativePath,
      mode: SearchMode.File,
      uri,
      iconPath: vscode.ThemeIcon.File,
      alwaysShow: true,
      belongsToSection: ResultSection.Files,
    };
  }

}
