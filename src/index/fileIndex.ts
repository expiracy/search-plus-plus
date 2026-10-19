import * as vscode from 'vscode';
import { Fzf, type FzfResultItem } from 'fzf';
import { GitIgnoreManager } from '../gitignore';
import { containsQuery, hasCaseSensitiveSubsequence } from '../utils';

export interface FileEntry {
  relativePath: string;
  uri: vscode.Uri;
}

interface FileChange { uri: vscode.Uri; created: boolean }

export class FileIndex implements vscode.Disposable {
  private entries: FileEntry[] = [];
  private filteredEntries: FileEntry[] = [];
  private fzfInstance: Fzf<FileEntry[]> | null = null;
  private unfilteredFzfInstance: Fzf<FileEntry[]> | null = null;
  private fzfDirty = false;
  private watcher: vscode.FileSystemWatcher | null = null;

  // Debounced batch updates for bulk operations
  private pendingChanges: FileChange[] = [];
  private buildChanges?: FileChange[];
  private pendingCreates = new Map<string, object>();
  private batchTimer: ReturnType<typeof setTimeout> | undefined;

  // Staleness detection
  private eventCount = 0;
  private eventWindowStart = Date.now();
  private _isStale = false;

  // Cancellation for in-progress builds
  private buildCts: vscode.CancellationTokenSource | null = null;
  private buildPromise?: Promise<void>;
  private disposed = false;

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
    return this.filteredEntries.length;
  }

  async ensureReady(): Promise<void> {
    while (!this.isReady && !this.disposed) {
      if (this.buildPromise) await this.buildPromise;
      else {
        await this.gitIgnore.load();
        if (!this.buildPromise && !this.isReady && !this.disposed) await this.build();
      }
    }
    if (this.disposed) throw new Error('File index was disposed');
  }

  build(): Promise<void> {
    const promise = this.buildSnapshot();
    this.buildPromise = promise;
    return promise.finally(() => {
      if (this.buildPromise === promise) this.buildPromise = undefined;
    });
  }

  private async buildSnapshot(): Promise<void> {
    // Cancel any in-progress build
    if (this.buildCts) {
      this.buildCts.cancel();
      this.buildCts.dispose();
    }
    this.buildCts = new vscode.CancellationTokenSource();
    const token = this.buildCts.token;

    this.setupWatcher();
    const changes = [...this.pendingChanges];
    this.buildChanges = changes;

    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        this.buildFromEntries([]);
        return;
      }

      const uris = await vscode.workspace.findFiles(
        '**/*',
        this.gitIgnore.getExcludeGlob(),
        undefined,
        token,
      );

      if (token.isCancellationRequested) return;

      this._isStale = false;

      this.entries = this.applyChanges(uris.map((uri) => ({
        relativePath: vscode.workspace.asRelativePath(uri),
        uri,
      })), changes);

      this.filteredEntries = this.entries.filter(
        (e) => !this.gitIgnore.isGitIgnored(e.relativePath, e.uri),
      );

      this.rebuildFzf();
      this.fzfDirty = false;
    } finally {
      if (this.buildChanges === changes) this.buildChanges = undefined;
    }
  }

  find(query: string, limit = 200, excludeGitIgnored = true, excludeSearchIgnored = true, caseSensitive = false, pathFilter?: (uri: vscode.Uri) => boolean): FzfResultItem<FileEntry>[] {
    if (this.fzfDirty) {
      this.rebuildFzf();
      this.fzfDirty = false;
    }
    const fzf = this.getFzfFor(excludeGitIgnored);
    if (!fzf) return [];
    let results = fzf.find(query);
    if (pathFilter) results = results.filter(result => pathFilter(result.item.uri));
    if (excludeSearchIgnored) {
      results = results.filter((r) => !this.gitIgnore.isSearchIgnored(r.item.relativePath, r.item.uri));
    }
    // When match case is on, require an exact-case subsequence after ranking.
    if (caseSensitive && query.length > 0) {
      results = results.filter((r) => hasCaseSensitiveSubsequence(r.item.relativePath, query));
    }
    // Stable re-sort: prioritize results where the match falls in the filename
    if (query.length > 0) {
      results.sort((a, b) => {
        const aInFilename = a.start > a.item.relativePath.lastIndexOf('/') ? 0 : 1;
        const bInFilename = b.start > b.item.relativePath.lastIndexOf('/') ? 0 : 1;
        return aInFilename - bInFilename;
      });
    }
    return results.slice(0, limit);
  }

  filter(
    query: string,
    limit = 200,
    excludeGitIgnored = true,
    caseSensitive = false,
    matchWholeWord = false,
    excludeSearchIgnored = true,
    pathFilter?: (uri: vscode.Uri) => boolean,
  ): FileEntry[] {
    const entries = this.getEntriesFor(excludeGitIgnored);

    const matches: FileEntry[] = [];
    for (const entry of entries) {
      if (pathFilter && !pathFilter(entry.uri)) continue;
      if (excludeSearchIgnored && this.gitIgnore.isSearchIgnored(entry.relativePath, entry.uri)) continue;
      if (!containsQuery(entry.relativePath, query, { caseSensitive, matchWholeWord })) continue;

      matches.push(entry);
      if (matches.length >= limit) break;
    }

    return matches;
  }

  /** Populate the index directly (for testing without findFiles) */
  buildFromEntries(
    filtered: FileEntry[],
    unfiltered?: FileEntry[],
  ): void {
    this._isStale = false;
    this.filteredEntries = filtered;
    this.entries = unfiltered ?? filtered;
    this.fzfDirty = false;
    this.rebuildFzf();
  }

  private getEntriesFor(excludeGit: boolean): FileEntry[] {
    if (excludeGit) return this.filteredEntries;
    return this.entries;
  }

  private getFzfFor(excludeGit: boolean): Fzf<FileEntry[]> | null {
    if (excludeGit) return this.fzfInstance;
    return this.getUnfilteredFzf();
  }

  private rebuildFzf(): void {
    this.fzfInstance = new Fzf(this.filteredEntries, {
      selector: (item) => item.relativePath,
      casing: 'case-insensitive',
      forward: false,
      tiebreakers: [
        // Prefer shorter paths (less nested)
        (a, b) => a.item.relativePath.length - b.item.relativePath.length,
      ],
    });
    this.unfilteredFzfInstance = null;
  }

  private buildLazyFzf(entries: FileEntry[]): Fzf<FileEntry[]> | null {
    if (entries.length === 0) return null;
    return new Fzf(entries, {
      selector: (item) => item.relativePath,
      casing: 'case-insensitive',
      forward: false,
      tiebreakers: [
        (a, b) => a.item.relativePath.length - b.item.relativePath.length,
      ],
    });
  }

  private getUnfilteredFzf(): Fzf<FileEntry[]> | null {
    if (!this.unfilteredFzfInstance) {
      this.unfilteredFzfInstance = this.buildLazyFzf(this.entries);
    }
    return this.unfilteredFzfInstance;
  }

  private setupWatcher(): void {
    if (this.watcher) return;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const record = (uri: vscode.Uri, created: boolean) => {
      const change = { uri, created };
      this.pendingChanges.push(change);
      this.buildChanges?.push(change);
      this.scheduleBatchUpdate();
    };
    this.watcher.onDidCreate(uri => {
      this.trackEvent();
      const key = uri.toString();
      const ticket = {};
      this.pendingCreates.set(key, ticket);
      void vscode.workspace.fs.stat(uri).then(stat => {
        if (this.disposed || this.pendingCreates.get(key) !== ticket) return;
        this.pendingCreates.delete(key);
        if ((stat.type & vscode.FileType.File) !== 0) record(uri, true);
        else if ((stat.type & vscode.FileType.Directory) !== 0) this.markStale();
      }, () => {
        if (this.pendingCreates.get(key) === ticket) this.pendingCreates.delete(key);
      });
    });
    this.watcher.onDidDelete(uri => {
      this.trackEvent();
      const key = uri.toString();
      for (const pending of this.pendingCreates.keys()) {
        if (pending === key || pending.startsWith(key + '/')) this.pendingCreates.delete(pending);
      }
      record(uri, false);
    });
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
      this.markStale();
    }
  }

  private markStale(): void {
    if (this._isStale) return;
    this._isStale = true;
    this._onDidBecomeStale.fire();
  }

  private scheduleBatchUpdate(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.applyBatchUpdate(), 300);
  }

  private applyChanges(entries: FileEntry[], changes: FileChange[]): FileEntry[] {
    const byUri = new Map(entries.map(entry => [entry.uri.toString(), entry]));
    for (const change of changes) {
      const key = change.uri.toString();
      if (change.created) {
        byUri.set(key, { uri: change.uri, relativePath: vscode.workspace.asRelativePath(change.uri) });
      } else {
        for (const candidate of byUri.keys()) {
          if (candidate === key || candidate.startsWith(key + '/')) byUri.delete(candidate);
        }
      }
    }
    return [...byUri.values()].filter(entry => !this.gitIgnore.isCustomExcluded(entry.relativePath, entry.uri));
  }

  private applyBatchUpdate(): void {
    this.batchTimer = undefined;
    this.entries = this.applyChanges(this.entries, this.pendingChanges.splice(0));
    this.filteredEntries = this.entries.filter(entry => !this.gitIgnore.isGitIgnored(entry.relativePath, entry.uri));
    this.fzfDirty = true;
  }

  private disposeWatcher(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pendingCreates.clear();
    if (this.buildCts) {
      this.buildCts.cancel();
      this.buildCts.dispose();
      this.buildCts = null;
    }
    this.disposeWatcher();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this._onDidBecomeStale.dispose();
  }
}
