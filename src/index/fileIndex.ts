import * as vscode from 'vscode';
import { Fzf, type FzfResultItem } from 'fzf';
import { GitIgnoreManager } from '../gitignore';

export interface FileEntry {
  relativePath: string;
  uri: vscode.Uri;
}

export class FileIndex implements vscode.Disposable {
  private entries: FileEntry[] = [];
  private gitFilteredEntries: FileEntry[] = [];
  private vscodeFilteredEntries: FileEntry[] = [];
  private filteredEntries: FileEntry[] = [];
  private fzfInstance: Fzf<FileEntry> | null = null;
  private unfilteredFzfInstance: Fzf<FileEntry> | null = null;
  private gitOnlyFzfInstance: Fzf<FileEntry> | null = null;
  private vscodeOnlyFzfInstance: Fzf<FileEntry> | null = null;
  private fzfDirty = false;
  private watcher: vscode.FileSystemWatcher | null = null;

  // Debounced batch updates for bulk operations
  private pendingAdds: FileEntry[] = [];
  private pendingRemoves = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | undefined;

  // Staleness detection
  private eventCount = 0;
  private eventWindowStart = Date.now();
  private _isStale = false;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;

  // Cancellation for in-progress builds
  private buildCts: vscode.CancellationTokenSource | null = null;

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

  async build(): Promise<void> {
    // Cancel any in-progress build
    if (this.buildCts) {
      this.buildCts.cancel();
      this.buildCts.dispose();
    }
    this.buildCts = new vscode.CancellationTokenSource();
    const token = this.buildCts.token;

    this._isStale = false;
    this.entries = [];
    this.gitFilteredEntries = [];
    this.vscodeFilteredEntries = [];
    this.filteredEntries = [];
    this.fzfInstance = null;
    this.unfilteredFzfInstance = null;
    this.gitOnlyFzfInstance = null;
    this.vscodeOnlyFzfInstance = null;
    this.fzfDirty = false;

    // Clear any pending batch state to prevent stale updates
    this.pendingAdds = [];
    this.pendingRemoves.clear();
    if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = undefined; }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const uris = await vscode.workspace.findFiles(
      '**/*',
      this.gitIgnore.getExcludeGlob(),
      undefined,
      token,
    );

    if (token.isCancellationRequested) return;

    this.entries = uris.map((uri) => ({
      relativePath: vscode.workspace.asRelativePath(uri),
      uri,
    })).filter((e) => !this.gitIgnore.isCustomExcluded(e.relativePath));

    this.gitFilteredEntries = this.entries.filter(
      (e) => !this.gitIgnore.isGitIgnored(e.relativePath),
    );

    this.vscodeFilteredEntries = this.entries.filter(
      (e) => !this.gitIgnore.isVscodeExcluded(e.relativePath),
    );

    this.filteredEntries = this.entries.filter(
      (e) => !this.gitIgnore.isGitIgnored(e.relativePath) && !this.gitIgnore.isVscodeExcluded(e.relativePath),
    );

    this.rebuildFzf();
    this.setupWatcher();
  }

  find(query: string, limit = 200, excludeGitIgnored = true, excludeVscodeExcluded = true): FzfResultItem<FileEntry>[] {
    if (this.fzfDirty) {
      this.rebuildFzf();
      this.fzfDirty = false;
    }
    const fzf = this.getFzfFor(excludeGitIgnored, excludeVscodeExcluded);
    if (!fzf) return [];
    return fzf.find(query).slice(0, limit);
  }

  filter(
    query: string,
    limit = 200,
    excludeGitIgnored = true,
    caseSensitive = false,
    matchWholeWord = false,
    excludeVscodeExcluded = true,
  ): FileEntry[] {
    const entries = this.getEntriesFor(excludeGitIgnored, excludeVscodeExcluded);
    const q = caseSensitive ? query : query.toLowerCase();

    const matches: FileEntry[] = [];
    for (const entry of entries) {
      const path = caseSensitive ? entry.relativePath : entry.relativePath.toLowerCase();

      if (matchWholeWord) {
        // Split path on common separators and check for exact segment match
        const segments = path.split(/[/\\\-_.]/);
        if (!segments.some((seg) => seg === q)) continue;
      } else {
        if (!path.includes(q)) continue;
      }

      matches.push(entry);
      if (matches.length >= limit) break;
    }

    return matches;
  }

  /** Populate the index directly (for testing without findFiles) */
  buildFromEntries(
    filtered: FileEntry[],
    unfiltered?: FileEntry[],
    gitFiltered?: FileEntry[],
    vscodeFiltered?: FileEntry[],
  ): void {
    this._isStale = false;
    this.filteredEntries = filtered;
    this.entries = unfiltered ?? filtered;
    this.gitFilteredEntries = gitFiltered ?? filtered;
    this.vscodeFilteredEntries = vscodeFiltered ?? (unfiltered ?? filtered);
    this.fzfDirty = false;
    this.rebuildFzf();
  }

  private getEntriesFor(excludeGit: boolean, excludeVscode: boolean): FileEntry[] {
    if (excludeGit && excludeVscode) return this.filteredEntries;
    if (excludeGit) return this.gitFilteredEntries;
    if (excludeVscode) return this.vscodeFilteredEntries;
    return this.entries;
  }

  private getFzfFor(excludeGit: boolean, excludeVscode: boolean): Fzf<FileEntry> | null {
    if (excludeGit && excludeVscode) return this.fzfInstance;
    if (excludeGit) return this.getGitOnlyFzf();
    if (excludeVscode) return this.getVscodeOnlyFzf();
    return this.getUnfilteredFzf();
  }

  private rebuildFzf(): void {
    this.fzfInstance = new Fzf(this.filteredEntries, {
      selector: (item) => item.relativePath,
      limit: 1000,
      tiebreakers: [
        // Prefer shorter paths (less nested)
        (a, b) => a.item.relativePath.length - b.item.relativePath.length,
      ],
    });
    this.unfilteredFzfInstance = null;
    this.gitOnlyFzfInstance = null;
    this.vscodeOnlyFzfInstance = null;
  }

  private buildLazyFzf(entries: FileEntry[]): Fzf<FileEntry> | null {
    if (entries.length === 0) return null;
    return new Fzf(entries, {
      selector: (item) => item.relativePath,
      tiebreakers: [
        (a, b) => a.item.relativePath.length - b.item.relativePath.length,
      ],
    });
  }

  private getUnfilteredFzf(): Fzf<FileEntry> | null {
    if (!this.unfilteredFzfInstance) {
      this.unfilteredFzfInstance = this.buildLazyFzf(this.entries);
    }
    return this.unfilteredFzfInstance;
  }

  private getGitOnlyFzf(): Fzf<FileEntry> | null {
    if (!this.gitOnlyFzfInstance) {
      this.gitOnlyFzfInstance = this.buildLazyFzf(this.gitFilteredEntries);
    }
    return this.gitOnlyFzfInstance;
  }

  private getVscodeOnlyFzf(): Fzf<FileEntry> | null {
    if (!this.vscodeOnlyFzfInstance) {
      this.vscodeOnlyFzfInstance = this.buildLazyFzf(this.vscodeFilteredEntries);
    }
    return this.vscodeOnlyFzfInstance;
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
      const notRemoved = (e: FileEntry) => !this.pendingRemoves.has(e.relativePath);
      this.entries = this.entries.filter(notRemoved);
      this.gitFilteredEntries = this.gitFilteredEntries.filter(notRemoved);
      this.vscodeFilteredEntries = this.vscodeFilteredEntries.filter(notRemoved);
      this.filteredEntries = this.filteredEntries.filter(notRemoved);
    }

    if (this.pendingAdds.length > 0) {
      const customFiltered = this.pendingAdds.filter(
        (e) => !this.gitIgnore.isCustomExcluded(e.relativePath),
      );
      this.entries.push(...customFiltered);

      const notGitIgnored = customFiltered.filter(
        (e) => !this.gitIgnore.isGitIgnored(e.relativePath),
      );
      this.gitFilteredEntries.push(...notGitIgnored);

      const notVscodeExcluded = customFiltered.filter(
        (e) => !this.gitIgnore.isVscodeExcluded(e.relativePath),
      );
      this.vscodeFilteredEntries.push(...notVscodeExcluded);

      const notEither = customFiltered.filter(
        (e) => !this.gitIgnore.isGitIgnored(e.relativePath) && !this.gitIgnore.isVscodeExcluded(e.relativePath),
      );
      this.filteredEntries.push(...notEither);
    }

    this.pendingAdds = [];
    this.pendingRemoves.clear();
    this.fzfDirty = true;
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
    if (this.buildCts) {
      this.buildCts.cancel();
      this.buildCts.dispose();
      this.buildCts = null;
    }
    this.disposeWatcher();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this._onDidBecomeStale.dispose();
  }
}
