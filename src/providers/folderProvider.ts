import * as vscode from 'vscode';
import { Fzf } from 'fzf';
import { SearchMode, getMaxResults, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { extractFolders } from './folderExtractor';
import { FileIndex } from '../index/fileIndex';
import { containsQuery, hasCaseSensitiveSubsequence } from '../utils';

export class FolderProvider implements SearchProvider {
  readonly mode = SearchMode.Folder;

  constructor(private fileIndex: FileIndex) {}

  search(query: string, options: SearchOptions, onResults: (results: SearchResult[]) => void, onError?: (error: unknown) => void): vscode.Disposable {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Deduplicate all eligible folders before matching and applying the UI limit.
      const entries = this.fileIndex.filter('', Infinity, options.excludeGitIgnored, false, false, options.excludeSearchIgnored);
      const folders = extractFolders(entries, '', SearchMode.Folder)
        .filter(folder => !options.pathFilter || (!!folder.uri && options.pathFilter(folder.uri)));
      let results: SearchResult[];
      if (options.fuzzySearch && !options.matchWholeWord) {
        const finder = new Fzf(folders, { selector: item => item.description ?? '', casing: 'case-insensitive' });
        results = finder.find(query).map(match => match.item).filter(item =>
          !options.caseSensitive || hasCaseSensitiveSubsequence(item.description ?? '', query),
        );
      } else {
        results = folders.filter(item => containsQuery(item.description ?? '', query, options));
      }
      onResults(results.slice(0, getMaxResults()));
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
}
