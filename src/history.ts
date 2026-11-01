import * as vscode from 'vscode';
import { SearchMode, type SearchResult } from './providers/types';
import { filePresentation } from './filePresentation';

const RECENT_FILES_KEY = 'searchPlusPlus.recentFiles';
const MAX_RECENT = 20;

interface RecentFileEntry {
  relativePath: string;
  fsPath: string;
  uri?: string;
  lineNumber?: number;
  column?: number;
}

function entryUri(entry: RecentFileEntry): vscode.Uri {
  return entry.uri ? vscode.Uri.parse(entry.uri) : vscode.Uri.file(entry.fsPath);
}

export class SearchHistory {
  private revision = 0;

  constructor(private state: vscode.Memento) {}

  async addOpened(uri: vscode.Uri, lineNumber?: number, column?: number): Promise<void> {
    const revision = ++this.revision;
    const relativePath = vscode.workspace.asRelativePath(uri);
    const entry: RecentFileEntry = { relativePath, fsPath: uri.fsPath, uri: uri.toString(), lineNumber, column };

    const recent = this.getRecentEntries();
    // Remove duplicate if exists
    const filtered = recent.filter((e) => entryUri(e).toString() !== entry.uri || e.lineNumber !== entry.lineNumber);
    filtered.unshift(entry);
    const updated = filtered.slice(0, MAX_RECENT);
    await this.state.update(RECENT_FILES_KEY, updated);

    // Lazily prune stale entries in the background
    this.pruneStaleEntries(updated, revision).catch(() => {});
  }

  async removeEntry(resource: vscode.Uri | string, lineNumber?: number): Promise<void> {
    this.revision++;
    const recent = this.getRecentEntries();
    const filtered = recent.filter(
      (e) => !((typeof resource === 'string' ? e.fsPath === resource : entryUri(e).toString() === resource.toString())
        && e.lineNumber === lineNumber),
    );
    await this.state.update(RECENT_FILES_KEY, filtered);
  }

  private async pruneStaleEntries(entries: RecentFileEntry[], revision: number): Promise<void> {
    const valid: RecentFileEntry[] = [];
    for (const entry of entries) {
      try {
        await vscode.workspace.fs.stat(entryUri(entry));
        valid.push(entry);
      } catch {
        // File no longer exists — skip it
      }
    }
    // A later open or removal owns the history now; never restore this snapshot.
    if (revision === this.revision && valid.length < entries.length) {
      await this.state.update(RECENT_FILES_KEY, valid);
    }
  }

  getRecentItems(): SearchResult[] {
    const entries = this.getRecentEntries();
    return entries.map((entry) => {
      const uri = entryUri(entry);
      const presentation = filePresentation(entry.relativePath, uri);

      return {
        ...presentation,
        label: entry.lineNumber !== undefined ? `${presentation.label}:${entry.lineNumber + 1}` : presentation.label,
        mode: entry.lineNumber !== undefined ? SearchMode.Text : SearchMode.File,
        uri,
        lineNumber: entry.lineNumber,
        column: entry.column,
        alwaysShow: true,
      };
    });
  }

  private getRecentEntries(): RecentFileEntry[] {
    return this.state.get<RecentFileEntry[]>(RECENT_FILES_KEY, []);
  }
}
