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
  entries: readonly PathEntry[],
  query: string,
  mode: SearchMode,
  options: Pick<SearchOptions, 'caseSensitive' | 'matchWholeWord'> = { caseSensitive: false, matchWholeWord: false },
): SearchResult[] {
  const seenFolders = new Set<string>();
  // Workspace folders resolve the same path to the same result, so each is evaluated once.
  const visitedPaths = new Set<string>();
  const folderResults: SearchResult[] = [];

  for (const entry of entries) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(entry.uri);
    const rootPath = wsFolder?.uri.path.replace(/\/$/, '');
    const rootKey = wsFolder?.uri.toString();
    const path = rootPath ? entry.uri.path.slice(rootPath.length + 1) : entry.relativePath;
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      if (rootKey !== undefined) {
        const visitKey = `${rootKey}\n${folderPath}`;
        if (visitedPaths.has(visitKey)) continue;
        visitedPaths.add(visitKey);
      }
      const folderUri = wsFolder
          ? vscode.Uri.joinPath(wsFolder.uri, folderPath)
          : vscode.Uri.joinPath(entry.uri, ...Array(parts.length - i).fill('..'));
      const description = wsFolder ? vscode.workspace.asRelativePath(folderUri) : folderPath;
      const key = folderUri.toString();
      if (!seenFolders.has(key) && containsQuery(description, query, options)) {
        seenFolders.add(key);
        folderResults.push({
          label: parts[i - 1],
          description,
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
