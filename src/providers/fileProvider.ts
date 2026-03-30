import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileIndex } from '../index/fileIndex';
import { GitIgnoreManager } from '../gitignore';

export class FileProvider implements SearchProvider {
  readonly mode = SearchMode.File;

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

      let fileResults: SearchResult[];

      if (options.fuzzySearch) {
        const matches = this.fileIndex.find(query, maxResults, options.excludeGitIgnored, options.excludeVscodeExcluded);
        fileResults = matches.map((match) => ({
          label: match.item.relativePath.split('/').pop() || match.item.relativePath,
          description: match.item.relativePath,
          mode: SearchMode.File,
          uri: match.item.uri,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          belongsToSection: ResultSection.Files,
        }));
      } else {
        const entries = this.fileIndex.filter(
          query, maxResults, options.excludeGitIgnored,
          options.caseSensitive, options.matchWholeWord, options.excludeVscodeExcluded,
        );
        fileResults = entries.map((entry) => ({
          label: entry.relativePath.split('/').pop() || entry.relativePath,
          description: entry.relativePath,
          mode: SearchMode.File,
          uri: entry.uri,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          belongsToSection: ResultSection.Files,
        }));
      }

      if (!cancelled) {
        onResults(fileResults);
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
      const pattern = `**/*${query}*`;
      const uris = await vscode.workspace.findFiles(pattern, this.gitIgnore.getExcludeGlob(), 200);

      if (isCancelled()) return;

      const fileResults: SearchResult[] = [];
      for (const uri of uris) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        if (this.gitIgnore.isCustomExcluded(relativePath)) continue;
        if (options.excludeGitIgnored && this.gitIgnore.isGitIgnored(relativePath)) continue;
        if (options.excludeVscodeExcluded && this.gitIgnore.isVscodeExcluded(relativePath)) continue;

        fileResults.push({
          label: relativePath.split('/').pop() || relativePath,
          description: relativePath,
          mode: SearchMode.File,
          uri,
          iconPath: vscode.ThemeIcon.File,
          alwaysShow: true,
          belongsToSection: ResultSection.Files,
        });
      }

      onResults(fileResults);
    } catch {
      onResults([]);
    }
  }
}
