import * as vscode from 'vscode';
import { Fzf, type FzfResultItem } from 'fzf';
import { GitIgnoreManager } from '../gitignore';

export interface FileEntry {
  relativePath: string;
  uri: vscode.Uri;
}

export class FileIndex implements vscode.Disposable {
  private entries: FileEntry[] = [];
  private fzfInstance: Fzf<FileEntry> | null = null;
  private watcher: vscode.FileSystemWatcher | null = null;
  private disposables: vscode.Disposable[] = [];

  // Debounced batch updates for bulk operations
  private pendingAdds: FileEntry[] = [];
  private pendingRemoves = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | undefined;

  // Staleness detection
  private eventCount = 0;
  private eventWindowStart = Date.now();
  private _isStale = false;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;

  private _onDidBecomeStale = new vscode.EventEmitter<void>();
  readonly onDidBecomeStale = this._onDidBecomeStale.event;

  constructor(private gitIgnore: GitIgnoreManager) {}

  get isReady(): boolean {
    return this.fzfInstance !== null;
  }

  get isStale(): boolean {
    return this._isStale;
  }

  get fileCount(): number {
    return this.entries.length;
  }

  async build(): Promise<void> {
    this._isStale = false;
    this.entries = [];
    this.fzfInstance = null;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const uris = await vscode.workspace.findFiles(
      '**/*',
      this.gitIgnore.getExcludeGlob(),
    );

    this.entries = uris.map((uri) => ({
      relativePath: vscode.workspace.asRelativePath(uri),
      uri,
    }));

    this.rebuildFzf();
    this.setupWatcher();
  }

  find(query: string, limit = 200, excludeGitIgnored = true): FzfResultItem<FileEntry>[] {
    if (!this.fzfInstance) return [];
    let results = this.fzfInstance.find(query);
    if (excludeGitIgnored) {
      results = results.filter(r => !this.gitIgnore.isIgnored(r.item.relativePath));
    }
    return results.slice(0, limit);
  }

  private rebuildFzf(): void {
    this.fzfInstance = new Fzf(this.entries, {
      selector: (item) => item.relativePath,
      tiebreakers: [
        // Prefer shorter paths (less nested)
        (a, b) => a.item.relativePath.length - b.item.relativePath.length,
      ],
    });
  }

  private setupWatcher(): void {
    this.disposeWatcher();

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.watcher.onDidCreate((uri) => {
      this.trackEvent();
      const relativePath = vscode.workspace.asRelativePath(uri);
      this.pendingAdds.push({ relativePath, uri });
      this.scheduleBatchUpdate();
    });

    this.watcher.onDidDelete((uri) => {
      this.trackEvent();
      const relativePath = vscode.workspace.asRelativePath(uri);
      this.pendingRemoves.add(relativePath);
      this.scheduleBatchUpdate();
    });

    // onDidChange is irrelevant for file index (path didn't change)

    this.disposables.push(this.watcher);
  }

  private trackEvent(): void {
    const now = Date.now();
    if (now - this.eventWindowStart > 1000) {
      this.eventCount = 0;
      this.eventWindowStart = now;
    }
    this.eventCount++;

    // Bulk operation detected (e.g., git checkout, npm install)
    if (this.eventCount > 100 && !this._isStale) {
      this._isStale = true;
      this._onDidBecomeStale.fire();
      this.scheduleFullRescan();
    }
  }

  private scheduleBatchUpdate(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.applyBatchUpdate(), 300);
  }

  private applyBatchUpdate(): void {
    if (this.pendingRemoves.size > 0) {
      this.entries = this.entries.filter(
        (e) => !this.pendingRemoves.has(e.relativePath),
      );
    }

    if (this.pendingAdds.length > 0) {
      this.entries.push(...this.pendingAdds);
    }

    this.pendingAdds = [];
    this.pendingRemoves.clear();
    this.rebuildFzf();
  }

  private scheduleFullRescan(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => this.build(), 2000);
  }

  private disposeWatcher(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
  }

  dispose(): void {
    this.disposeWatcher();
    for (const d of this.disposables) d.dispose();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this._onDidBecomeStale.dispose();
  }
}
