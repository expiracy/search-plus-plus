import * as vscode from 'vscode';
import { SearchMode, getMaxResults, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { extractFolders } from './folderExtractor';
import { FileIndex } from '../index/fileIndex';
import { GitIgnoreManager } from '../gitignore';

export class FolderProvider implements SearchProvider {
  readonly mode = SearchMode.Folder;

  constructor(private fileIndex: FileIndex, private gitIgnore: GitIgnoreManager) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    let cancelled = false;

    if (!this.fileIndex.isReady) {
      this.fallbackSearch(query, options, onResults, () => cancelled);
    } else {
      const maxResults = getMaxResults();

      let entries;
      // Whole-word matching is inherently non-fuzzy, so it forces the substring path
      if (options.fuzzySearch && !options.matchWholeWord) {
        const matches = this.fileIndex.find(
          query, 1000, options.excludeGitIgnored,
          options.excludeSearchIgnored, options.caseSensitive,
        );
        entries = matches.map((m) => m.item);
      } else {
        entries = this.fileIndex.filter(
          query, 1000, options.excludeGitIgnored,
          options.caseSensitive, options.matchWholeWord,
          options.excludeSearchIgnored,
        );
      }

      const folderResults = extractFolders(entries, query, SearchMode.Folder, options);

      if (!cancelled) {
        onResults(folderResults.slice(0, maxResults));
      }
    }

    return { dispose: () => { cancelled = true; } };
  }

  private async fallbackSearch(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
    isCancelled: () => boolean,
  ): Promise<void> {
    try {
      const uris = await vscode.workspace.findFiles('**/*', this.gitIgnore.getExcludeGlob(), 5000);

      if (isCancelled()) return;

      const entries: { relativePath: string; uri: vscode.Uri }[] = [];
      for (const uri of uris) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (this.gitIgnore.shouldExclude(relativePath, options)) continue;
        entries.push({ relativePath, uri });
      }
      const folderResults = extractFolders(entries, query, SearchMode.Folder, options);

      onResults(folderResults);
    } catch {
      onResults([]);
    }
  }
}
