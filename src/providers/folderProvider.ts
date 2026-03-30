import * as vscode from 'vscode';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
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
      const config = vscode.workspace.getConfiguration('searchPlusPlus');
      const maxResults = config.get<number>('maxResults', 200);

      let entries;
      if (options.fuzzySearch) {
        const matches = this.fileIndex.find(query, 1000, options.excludeGitIgnored, options.excludeSearchIgnored);
        entries = matches.map((m) => m.item);
      } else {
        entries = this.fileIndex.filter(
          query, 1000, options.excludeGitIgnored,
          options.caseSensitive, options.matchWholeWord,
          options.excludeSearchIgnored,
        );
      }

      const folderResults = extractFolders(entries, query, SearchMode.Folder);

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
        if (this.gitIgnore.isCustomExcluded(relativePath)) continue;
        if (options.excludeSearchIgnored && this.gitIgnore.isSearchIgnored(relativePath)) continue;
        if (options.excludeGitIgnored && this.gitIgnore.isGitIgnored(relativePath)) continue;
        entries.push({ relativePath, uri });
      }
      const folderResults = extractFolders(entries, query, SearchMode.Folder);

      onResults(folderResults);
    } catch {
      onResults([]);
    }
  }
}
