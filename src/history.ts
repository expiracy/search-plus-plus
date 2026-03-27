import * as vscode from 'vscode';
import { SearchMode, type SearchResult } from './providers/types';

const RECENT_FILES_KEY = 'searchPlusPlus.recentFiles';
const MAX_RECENT = 20;

interface RecentFileEntry {
  relativePath: string;
  fsPath: string;
  lineNumber?: number;
  column?: number;
}

export class SearchHistory {
  constructor(private state: vscode.Memento) {}

  addOpened(uri: vscode.Uri, lineNumber?: number, column?: number): void {
    const relativePath = vscode.workspace.asRelativePath(uri);
    const entry: RecentFileEntry = { relativePath, fsPath: uri.fsPath, lineNumber, column };

    const recent = this.getRecentEntries();
    // Remove duplicate if exists
    const filtered = recent.filter((e) => e.fsPath !== entry.fsPath || e.lineNumber !== entry.lineNumber);
    filtered.unshift(entry);
    this.state.update(RECENT_FILES_KEY, filtered.slice(0, MAX_RECENT));

    // Lazily prune stale entries in the background
    this.pruneStaleEntries(filtered);
  }

  private async pruneStaleEntries(entries: RecentFileEntry[]): Promise<void> {
    const valid: RecentFileEntry[] = [];
    for (const entry of entries) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(entry.fsPath));
        valid.push(entry);
      } catch {
        // File no longer exists — skip it
      }
    }
    if (valid.length < entries.length) {
      this.state.update(RECENT_FILES_KEY, valid);
    }
  }

  getRecentItems(): SearchResult[] {
    const entries = this.getRecentEntries();
    return entries.map((entry) => {
      const uri = vscode.Uri.file(entry.fsPath);
      const fileName = entry.relativePath.split('/').pop() || entry.relativePath;
      const description = entry.lineNumber !== undefined
        ? `${entry.relativePath}:${entry.lineNumber + 1}`
        : entry.relativePath;

      return {
        label: `$(history) ${fileName}`,
        description,
        mode: entry.lineNumber !== undefined ? SearchMode.Text : SearchMode.File,
        uri,
        lineNumber: entry.lineNumber,
        column: entry.column,
        iconPath: vscode.ThemeIcon.File,
        resourceUri: uri,
        alwaysShow: true,
      };
    });
  }

  private getRecentEntries(): RecentFileEntry[] {
    return this.state.get<RecentFileEntry[]>(RECENT_FILES_KEY, []);
  }
}
