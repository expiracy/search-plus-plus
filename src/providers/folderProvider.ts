import * as vscode from 'vscode';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { extractFolders } from './folderExtractor';
import { FileIndex } from '../index/fileIndex';

export class FolderProvider implements SearchProvider {
  readonly mode = SearchMode.Folder;

  constructor(private fileIndex: FileIndex) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    let cancelled = false;

    if (!this.fileIndex.isReady) {
      this.fallbackSearch(query, onResults, () => cancelled);
    } else {
      const config = vscode.workspace.getConfiguration('searchPlusPlus');
      const maxResults = config.get<number>('maxResults', 200);

      let entries;
      if (options.fuzzySearch) {
        const matches = this.fileIndex.find(query, 1000, options.excludeGitIgnored);
        entries = matches.map((m) => m.item);
      } else {
        entries = this.fileIndex.filter(
          query, 1000, options.excludeGitIgnored,
          options.caseSensitive, options.matchWholeWord,
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
    onResults: (results: SearchResult[]) => void,
    isCancelled: () => boolean,
  ): Promise<void> {
    try {
      const uris = await vscode.workspace.findFiles('**/*', undefined, 5000);

      if (isCancelled()) return;

      const entries = uris.map((uri) => ({
        relativePath: vscode.workspace.asRelativePath(uri),
        uri,
      }));
      const folderResults = extractFolders(entries, query, SearchMode.Folder);

      onResults(folderResults);
    } catch {
      onResults([]);
    }
  }
}
