import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchResult } from './types';
import { containsQuery } from '../utils';

interface PathEntry {
  relativePath: string;
  uri: vscode.Uri;
}

/**
 * Extract matching folders from a list of file paths.
 * Deduplicates and filters by substring match on the query, honoring the
 * match-case and whole-word toggles when provided.
 */
export function extractFolders(
  entries: PathEntry[],
  query: string,
  mode: SearchMode,
  options: Pick<SearchOptions, 'caseSensitive' | 'matchWholeWord'> = { caseSensitive: false, matchWholeWord: false },
): SearchResult[] {
  const seenFolders = new Set<string>();
  const folderResults: SearchResult[] = [];

  for (const entry of entries) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(entry.uri);
    const parts = entry.relativePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      if (!seenFolders.has(folderPath) && containsQuery(folderPath, query, options)) {
        seenFolders.add(folderPath);
        const folderUri = wsFolder
          ? vscode.Uri.joinPath(wsFolder.uri, folderPath)
          : vscode.Uri.joinPath(entry.uri, ...Array(parts.length - i).fill('..'));
        folderResults.push({
          label: parts[i - 1],
          description: folderPath,
          mode,
          uri: folderUri,
          iconPath: vscode.ThemeIcon.Folder,
          alwaysShow: true,
          isFolder: true,
          belongsToSection: ResultSection.Folders,
        });
      }
    }
  }

  return folderResults;
}
