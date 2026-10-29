import * as vscode from 'vscode';
import { Fzf, type FzfResultItem } from 'fzf';
import { GitIgnoreManager } from '../gitignore';
import { containsQuery, hasCaseSensitiveSubsequence } from '../utils';

export interface FileEntry {
  relativePath: string;
  uri: vscode.Uri;
}

interface FileChange { uri: vscode.Uri; created: boolean }

/** Snapshot entries for one combination of the ignore toggles. */
interface IndexView {
  entries: FileEntry[];
  fzf?: Fzf<FileEntry[]>;
  notebooks?: vscode.Uri[];
  /** Candidates for queries extending `query`, in snapshot order so ranking ties are unchanged. */
  narrowed?: { query: string; matches: FileEntry[]; fzf?: Fzf<FileEntry[]> };
}

function createFzf(entries: FileEntry[]): Fzf<FileEntry[]> {
  return new Fzf(entries, {
    selector: (item) => item.relativePath,
    casing: 'case-insensitive',
    forward: false,
    tiebreakers: [
      // Prefer shorter paths (less nested)
      (a, b) => a.item.relativePath.length - b.item.relativePath.length,
    ],
  });
}

/** True when `key` lies inside one of the directory URIs in `directories`. */
function isWithinAny(key: string, directories: ReadonlySet<string>): boolean {
  for (let slash = key.lastIndexOf('/'); slash > 0; slash = key.lastIndexOf('/', slash - 1)) {
    if (directories.has(key.slice(0, slash))) return true;
  }
  return false;
}

export class FileIndex implements vscode.Disposable {
  private entries: FileEntry[] = [];
  private filteredEntries: FileEntry[] = [];
  // Built lazily per snapshot so searches never re-evaluate ignore rules per keystroke.
  private readonly views = new Map<string, IndexView>();
  private ready = false;
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
    return this.ready;
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

      const discovered = uris
        .map((uri) => ({ relativePath: vscode.workspace.asRelativePath(uri), uri }))
        .filter(entry => !this.gitIgnore.isCustomExcluded(entry.relativePath, entry.uri));
      this.entries = this.applyChanges(discovered, changes);

      this.filteredEntries = this.entries.filter(
        (e) => !this.gitIgnore.isGitIgnored(e.relativePath, e.uri),
      );

      this.publishSnapshot();
    } finally {
      if (this.buildChanges === changes) this.buildChanges = undefined;
    }
  }

  find(query: string, limit = 200, excludeGitIgnored = true, excludeSearchIgnored = true, caseSensitive = false): FzfResultItem<FileEntry>[] {
    let results = this.findInView(this.getView(excludeGitIgnored, excludeSearchIgnored), query);
    // When match case is on, require an exact-case subsequence after ranking.
    if (caseSensitive && query.length > 0) {
      results = results.filter((r) => hasCaseSensitiveSubsequence(r.item.relativePath, query));
    }
    // Stable partition: prioritize results where the match falls in the filename
    if (query.length > 0) {
      const inFilename: FzfResultItem<FileEntry>[] = [];
      const inPath: FzfResultItem<FileEntry>[] = [];
      for (const result of results) {
        if (result.start > result.item.relativePath.lastIndexOf('/')) {
          inFilename.push(result);
          if (inFilename.length >= limit) break;
        } else if (inPath.length < limit) {
          inPath.push(result);
        }
      }
      results = inFilename.concat(inPath);
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
  ): FileEntry[] {
    const matches: FileEntry[] = [];
    for (const entry of this.getEntries(excludeGitIgnored, excludeSearchIgnored)) {
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
    this.publishSnapshot();
  }

  /** Eligible entries for the toggles; the same array is returned until the snapshot changes. */
  getEntries(excludeGitIgnored = true, excludeSearchIgnored = true): readonly FileEntry[] {
    return this.getView(excludeGitIgnored, excludeSearchIgnored).entries;
  }

  /** Notebook files eligible for the toggles, cached with the snapshot. */
  getNotebooks(excludeGitIgnored = true, excludeSearchIgnored = true): readonly vscode.Uri[] {
    const view = this.getView(excludeGitIgnored, excludeSearchIgnored);
    // Matches ripgrep's case-sensitive `!*.ipynb` glob, so no file is searched twice or skipped.
    view.notebooks ??= view.entries.filter(entry => entry.uri.path.endsWith('.ipynb')).map(entry => entry.uri);
    return view.notebooks;
  }

  private getView(excludeGit: boolean, excludeSearch: boolean): IndexView {
    const key = `${excludeGit}:${excludeSearch}`;
    let view = this.views.get(key);
    if (!view) {
      const base = excludeGit ? this.filteredEntries : this.entries;
      view = {
        entries: excludeSearch
          ? base.filter(entry => !this.gitIgnore.isSearchIgnored(entry.relativePath, entry.uri))
          : base,
      };
      this.views.set(key, view);
    }
    return view;
  }

  private findInView(view: IndexView, query: string): FzfResultItem<FileEntry>[] {
    // Match fzf's normalization and casing before checking whether candidates can narrow.
    const normalizedQuery = query.normalize().toLowerCase();
    const narrowed = query && view.narrowed && normalizedQuery.startsWith(view.narrowed.query) ? view.narrowed : undefined;
    let fzf: Fzf<FileEntry[]>;
    if (narrowed) fzf = narrowed.fzf ??= createFzf(narrowed.matches);
    else fzf = view.fzf ??= createFzf(view.entries);
    const results = fzf.find(query);
    const source = narrowed?.matches ?? view.entries;
    // Rebuilding a matcher only pays off when the query removed most candidates.
    if (query && results.length <= source.length / 2) {
      const matched = new Set(results.map(result => result.item));
      view.narrowed = { query: normalizedQuery, matches: source.filter(entry => matched.has(entry)) };
    } else if (!narrowed) {
      view.narrowed = undefined;
    }
    return results;
  }

  private publishSnapshot(): void {
    this.views.clear();
    this.ready = true;
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

  private applyChanges(entries: FileEntry[], changes: FileChange[], created?: Set<FileEntry>): FileEntry[] {
    const byUri = new Map(entries.map(entry => [entry.uri.toString(), entry]));
    // Deleted directories share one scan of the index, made before any later creation.
    const deletedDirectories = new Set<string>();
    const removeDeletedDirectories = () => {
      if (!deletedDirectories.size) return;
      for (const key of byUri.keys()) {
        if (isWithinAny(key, deletedDirectories)) byUri.delete(key);
      }
      deletedDirectories.clear();
    };
    for (const change of changes) {
      const key = change.uri.toString();
      if (change.created) {
        removeDeletedDirectories();
        const entry = { uri: change.uri, relativePath: vscode.workspace.asRelativePath(change.uri) };
        if (this.gitIgnore.isCustomExcluded(entry.relativePath, entry.uri)) continue;
        byUri.set(key, entry);
        created?.add(entry);
      } else if (!byUri.delete(key)) {
        deletedDirectories.add(key);
      }
    }
    removeDeletedDirectories();
    return [...byUri.values()];
  }

  private applyBatchUpdate(): void {
    this.batchTimer = undefined;
    const created = new Set<FileEntry>();
    const visible = new Set(this.filteredEntries);
    this.entries = this.applyChanges(this.entries, this.pendingChanges.splice(0), created);
    // Rule changes rebuild the index, so only created entries need the ignore rules.
    this.filteredEntries = this.entries.filter(entry => created.has(entry)
      ? !this.gitIgnore.isGitIgnored(entry.relativePath, entry.uri)
      : visible.has(entry));
    this.views.clear();
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
