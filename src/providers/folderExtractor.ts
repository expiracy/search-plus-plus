import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchResult } from './types';

interface PathEntry {
  relativePath: string;
  uri: vscode.Uri;
}

/**
 * Extract matching folders from a list of file paths.
 * Deduplicates and filters by case-insensitive substring match on the query.
 */
export function extractFolders(
  entries: PathEntry[],
  query: string,
  mode: SearchMode,
): SearchResult[] {
  const seenFolders = new Set<string>();
  const folderResults: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      if (!seenFolders.has(folderPath) && folderPath.toLowerCase().includes(queryLower)) {
        seenFolders.add(folderPath);
        folderResults.push({
          label: parts[i - 1],
          description: folderPath,
          mode,
          uri: vscode.Uri.joinPath(entry.uri, ...Array(parts.length - i).fill('..')),
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
