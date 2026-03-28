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

  private _onDidChangeState = new vscode.EventEmitter<IndexState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  constructor(context: vscode.ExtensionContext) {
    this.gitIgnore = new GitIgnoreManager();
    this.fileIndex = new FileIndex(this.gitIgnore);
    this.textSearch = new TextSearch();

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
      this.fileIndex.onDidBecomeStale(() => this.updateStatusBar('stale')),
    );

    // Gitignore changes trigger full file rescan
    this.disposables.push(
      this.gitIgnore.onDidChange(() => this.rebuildFileIndex()),
    );

    // Workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.rebuildFileIndex()),
    );

    // Config changes for files.exclude / search.exclude are handled by
    // GitIgnoreManager.onDidChange (above), which already triggers rebuildFileIndex.
  }

  get state(): IndexState {
    return this._state;
  }

  async buildAll(): Promise<void> {
    this.updateStatusBar('building');

    try {
      await this.gitIgnore.load();
      this.textSearch.setExcludePatterns(this.gitIgnore.getCustomExcludePatterns());
      await this.fileIndex.build();
      this.updateStatusBar('ready');
    } catch (err) {
      console.error('[search++] Index build failed:', err);
      this.updateStatusBar('error');
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
    this.fileIndex.dispose();
    this.textSearch.dispose();
    this.gitIgnore.dispose();
    this.statusBarItem.dispose();
    this._onDidChangeState.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
