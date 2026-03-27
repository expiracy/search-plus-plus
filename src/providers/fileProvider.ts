import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileIndex } from '../index/fileIndex';

export class FileProvider implements SearchProvider {
  readonly mode = SearchMode.File;

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
      const matches = this.fileIndex.find(query, 1000, options.excludeGitIgnored);

      if (!cancelled) {
        const fileResults: SearchResult[] = matches.slice(0, maxResults).map((match) => ({
          label: match.item.relativePath.split('/').pop() || match.item.relativePath,
          description: match.item.relativePath,
          mode: SearchMode.File,
          uri: match.item.uri,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          belongsToSection: ResultSection.Files,
        }));

        onResults(fileResults);
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
      const pattern = `**/*${query}*`;
      const uris = await vscode.workspace.findFiles(pattern, undefined, 50);

      if (isCancelled()) return;

      const fileResults: SearchResult[] = uris.map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        return {
          label: relativePath.split('/').pop() || relativePath,
          description: relativePath,
          mode: SearchMode.File,
          uri,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          belongsToSection: ResultSection.Files,
        };
      });

      onResults(fileResults);
    } catch {
      onResults([]);
    }
  }
}
