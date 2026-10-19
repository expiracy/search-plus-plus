import * as vscode from 'vscode';
import { FileIndex } from './fileIndex';
import { TextSearch } from './textSearch';
import { GitIgnoreManager } from '../gitignore';

export type IndexState = 'building' | 'ready' | 'stale' | 'error';

export class IndexManager implements vscode.Disposable {
  readonly fileIndex: FileIndex;
  readonly textSearch: TextSearch;
  readonly gitIgnore: GitIgnoreManager;

  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private _state: IndexState = 'building';
  private buildPromise?: Promise<void>;
  private rebuildRequested = false;
  private rescanTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  private _onDidChangeState = new vscode.EventEmitter<IndexState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(_context: vscode.ExtensionContext) {
    this.gitIgnore = new GitIgnoreManager();
    this.fileIndex = new FileIndex(this.gitIgnore);
    this.textSearch = new TextSearch(undefined, this.gitIgnore);

    // Status bar
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = 'searchPlusPlus.reindex';
    this.statusBarItem.show();
    this.updateStatusBar('building');

    // File index staleness
    this.disposables.push(
      this.fileIndex.onDidBecomeStale(() => {
        this.updateStatusBar('stale');
        if (this.rescanTimer) clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(() => { void this.buildAll(); }, 2000);
      }),
    );

    // Gitignore changes trigger full file rescan
    this.disposables.push(
      this.gitIgnore.onDidChange(() => this.rebuildFileIndex()),
    );

    // Workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.rebuildFileIndex()),
    );

  }

  get state(): IndexState {
    return this._state;
  }

  buildAll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.rebuildRequested = true;
    if (!this.buildPromise) {
      this.buildPromise = this.runBuilds().finally(() => { this.buildPromise = undefined; });
    }
    return this.buildPromise;
  }

  private async runBuilds(): Promise<void> {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    while (this.rebuildRequested && !this.disposed) {
      this.rebuildRequested = false;
      this.updateStatusBar('building');
      try {
        await this.gitIgnore.load();
        if (this.disposed) return;
        await this.fileIndex.build();
        if (!this.disposed && !this.rebuildRequested) this.updateStatusBar('ready');
      } catch (err) {
        console.error('[search++] Index build failed:', err);
        if (!this.disposed && !this.rebuildRequested) this.updateStatusBar('error');
      }
    }
  }

  async reindex(): Promise<void> {
    await this.buildAll();
  }

  private async rebuildFileIndex(): Promise<void> {
    await this.buildAll();
  }

  private updateStatusBar(state: IndexState): void {
    this._state = state;
    this._onDidChangeState.fire(state);

    switch (state) {
      case 'building':
        this.statusBarItem.text = '$(sync~spin) search++';
        this.statusBarItem.tooltip = 'Indexing workspace...';
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'ready':
        this.statusBarItem.text = '$(search) search++';
        this.statusBarItem.tooltip = `search++ ready: ${this.fileIndex.fileCount} files indexed. Click to reindex.`;
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'stale':
        this.statusBarItem.text = '$(warning) search++';
        this.statusBarItem.tooltip =
          'Index may be stale (bulk operation detected). Click to reindex.';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        );
        break;
      case 'error':
        this.statusBarItem.text = '$(error) search++';
        this.statusBarItem.tooltip = 'Index error. Click to reindex.';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.fileIndex.dispose();
    this.textSearch.dispose();
    this.gitIgnore.dispose();
    this.statusBarItem.dispose();
    this._onDidChangeState.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
