import * as vscode from 'vscode';
import type { IndexManager } from '../index/indexManager';
import type { SearchHistory } from '../history';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from '../providers/types';
import { isAbsolutePath } from '../utils';
import { compilePathFilter } from '../pathFilter';
import { SearchSession } from '../searchSession';
import { webviewHtml } from './webviewHtml';
import { buildTitle, parseLineCol } from './searchModel';
import { MODES, OPTIONS, type OptionKey, type ViewState, type ViewResult } from './protocol';

export class SearchView implements vscode.Disposable {
  private focused = true;
  private panel?: vscode.WebviewPanel;
  private session = new SearchSession<SearchResult[]>();
  private query = '';
  private inputVersion = 0;
  private scope = '';
  private scopeRegex = false;
  private mode = SearchMode.Everywhere;
  private results: SearchResult[] = [];
  private options: SearchOptions;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private indexSubscription: vscode.Disposable;
  private panelDisposables: vscode.Disposable[] = [];
  private busy = false;
  private error?: string;
  private selectedId?: string;
  private gotoLine?: number;
  private gotoColumn?: number;

  constructor(private extensionUri: vscode.Uri, private index: IndexManager, private history: SearchHistory, private providers: ReadonlyMap<SearchMode, SearchProvider>) {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    this.indexSubscription = index.onDidChangeState(() => {
      if (this.panel?.active) this.search();
    });
    this.options = {
      excludeGitIgnored: config.get('excludeGitIgnored', true),
      excludeSearchIgnored: config.get('excludeSearchIgnored', true),
      caseSensitive: false, useRegex: false, fuzzySearch: false, matchWholeWord: false,
    };
  }

  show(mode?: SearchMode): Promise<void> {
    this.mode = mode ?? this.mode;
    this.focused = true;
    if (this.panel) {
      this.panel.reveal();
      this.updateContexts();
      this.search();
      return this.ready!;
    }
    const resources = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    this.panel = vscode.window.createWebviewPanel('searchPlusPlus.search', 'search++', vscode.ViewColumn.Active, {
      enableScripts: true, localResourceRoots: [resources], retainContextWhenHidden: true,
    });
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.panelDisposables = [
      this.panel.webview.onDidReceiveMessage(message => this.receiveMessage(message)),
      this.panel.onDidChangeViewState(() => this.updateContexts()),
      this.panel.onDidDispose(() => {
        this.session.cancel();
        this.panel = undefined;
        this.updateContexts();
        this.resolveReady?.();
        for (const disposable of this.panelDisposables) disposable.dispose();
        this.panelDisposables = [];
      }),
    ];
    this.updateContexts();
    this.panel.webview.html = webviewHtml(this.panel.webview, resources);
    return this.ready;
  }

  private receiveMessage(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    switch (message.type) {
      case 'ready':
        this.resolveReady?.();
        this.search();
        break;
      case 'focus':
        if (typeof message.focused !== 'boolean') return;
        this.focused = message.focused;
        this.updateContexts();
        break;
      case 'input':
        if (typeof message.query !== 'string' || typeof message.scope !== 'string') return;
        this.inputVersion = typeof message.inputVersion === 'number' && Number.isSafeInteger(message.inputVersion)
          ? message.inputVersion : this.inputVersion + 1;
        this.query = message.query;
        this.scope = message.scope;
        this.search();
        break;
      case 'mode':
        if (MODES.some(mode => mode.id === message.mode)) this.switchMode(message.mode as SearchMode);
        break;
      case 'toggle':
        if (message.option === 'scopeRegex') {
          this.scopeRegex = !this.scopeRegex;
          this.search();
        } else if (OPTIONS.some(option => option.key === message.option)) this.toggle(message.option as OptionKey);
        break;
      case 'select':
        if (typeof message.id === 'string') this.selectedId = message.id;
        break;
      case 'open':
        if (typeof message.id === 'string') void this.openResult(message.id, message.beside === true);
        break;
      case 'usages':
        if (typeof message.id === 'string') void this.findUsages(message.id);
        break;
      case 'removeRecent':
        if (typeof message.id === 'string') void this.removeRecent(message.id);
        break;
      case 'close':
        this.panel?.dispose();
        break;
    }
  }

  private search(): void {
    this.gotoLine = undefined;
    this.gotoColumn = undefined;
    const provider = this.providers.get(this.mode);
    if (!provider) return;
    let pathFilter;
    try { pathFilter = compilePathFilter(this.scope, this.scopeRegex); }
    catch (error) {
      this.session.cancel();
      this.showError(`Invalid path regex: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!this.query.trim() && !this.scope.trim() && this.mode !== SearchMode.Usages) {
      this.session.cancel();
      this.error = undefined;
      this.setResults(this.history.getRecentItems());
      return;
    }
    this.busy = true;
    this.results = [];
    this.error = undefined;
    this.publish();
    const fileMode = [SearchMode.File, SearchMode.Everywhere, SearchMode.Folder].includes(this.mode);
    const parsed = fileMode ? parseLineCol(this.query.trim()) : { query: this.query };
    this.gotoLine = parsed.gotoLine;
    this.gotoColumn = parsed.gotoColumn;
    const query = this.mode === SearchMode.File || this.mode === SearchMode.Everywhere ? parsed.query.replace(/:[\d]*$/, '') : parsed.query;
    const delay = [SearchMode.Text, SearchMode.Symbol, SearchMode.Command, SearchMode.Usages].includes(this.mode)
      ? vscode.workspace.getConfiguration('searchPlusPlus').get<number>('debounceMs', 300) : 0;
    const absolute = fileMode && isAbsolutePath(parsed.query);
    this.session.run((publish, fail) => {
      if (absolute) {
        const uri = vscode.Uri.file(parsed.query);
        if (pathFilter && !pathFilter(uri)) { publish([]); return; }
        void vscode.workspace.fs.stat(uri).then(stat => publish([{
          label: parsed.query.split(/[/\\]/).pop() ?? parsed.query, description: parsed.query,
          mode: (stat.type & vscode.FileType.Directory) !== 0 ? SearchMode.Folder : SearchMode.File,
          isFolder: (stat.type & vscode.FileType.Directory) !== 0, uri,
        }]), fail);
        return;
      }
      return provider.search(query, { ...this.options, pathFilter }, publish, fail);
    }, results => {
      this.setResults(results);
    }, error => this.showError(error), delay);
  }

  private setResults(results: SearchResult[]): void {
    this.results = results;
    this.busy = false;
    this.publish();
  }

  private showError(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
    this.setResults([]);
  }

  private publish(): void {
    const state: ViewState = {
      type: 'state', inputVersion: this.inputVersion, query: this.query, scope: this.scope, scopeRegex: this.scopeRegex,
      mode: this.mode, usageName: this.options.usageTarget?.name, options: Object.fromEntries(OPTIONS.map(option => [option.key, this.options[option.key]])) as Record<OptionKey, boolean>, busy: this.busy, error: this.error,
      status: buildTitle(this.status(), this.index.state),
      results: this.results.map(result => this.viewResult(result)),
    };
    void this.panel?.webview.postMessage(state);
  }

  private status(): string {
    if (this.busy) return 'Searching…';
    if (this.index.state === 'error') return 'Index failed. Run search++: Reindex Workspace.';
    if (this.index.state === 'stale') return 'Index may be stale. Reindexing shortly…';
    if (this.mode === SearchMode.Usages && !this.options.usageTarget) return 'Select a symbol in Symbols or Everything, then use Shift+F12.';
    if (this.mode === SearchMode.Usages && !this.results.length) return 'No usages reported. Check the scope and language support for this symbol.';
    if (!this.query.trim() && !this.scope.trim() && this.mode !== SearchMode.Usages) return this.results.length ? 'Recent files' : 'Search the workspace to get started.';
    return this.results.length ? `${this.results.filter(result => !result.moreCount).length} results` : 'No results. Check the query, scope, and exclusion options.';
  }

  private viewResult(result: SearchResult): ViewResult {
    const recent = !this.query.trim() && !this.scope.trim() && this.mode !== SearchMode.Usages;
    const hasIconLabel = recent || result.mode === SearchMode.Symbol || result.mode === SearchMode.Command || !!result.moreCount || !result.uri;
    const glyph = hasIconLabel ? /^\$\(([-a-z0-9]+)\)\s*/.exec(result.label) : null;
    return {
      id: this.resultId(result), label: glyph ? result.label.slice(glyph[0].length) : result.label,
      description: result.description ?? '', detail: result.detail,
      icon: glyph?.[1] ?? (result.isFolder ? 'folder' : result.mode === SearchMode.Usages ? 'references' : 'file'),
      section: recent ? 'Recent' : this.mode === SearchMode.Everywhere ? result.belongsToSection : undefined,
      canOpen: !!result.uri || !!result.commandId || !!result.moreCount,
      canFindUsages: result.mode === SearchMode.Symbol && !!result.uri, recent,
    };
  }

  async findUsages(id = this.selectedId): Promise<void> {
    const result = this.results.find(result => this.resultId(result) === id);
    if (result?.mode === SearchMode.Symbol && result.uri) {
      this.options.usageTarget = { uri: result.uri, position: new vscode.Position(result.lineNumber ?? 0, result.column ?? 0), name: result.label.replace(/\$\([^)]+\)\s*/g, '') };
    } else if (!this.panel?.active && vscode.window.activeTextEditor) {
      const editor = vscode.window.activeTextEditor;
      const position = editor.selection.active;
      const word = editor.document.getWordRangeAtPosition(position);
      this.options.usageTarget = { uri: editor.document.uri, position, name: word ? editor.document.getText(word) : 'Selected symbol' };
    } else {
      this.showError('Select a symbol in Symbols or Everything, then use Shift+F12.');
      return;
    }
    this.query = '';
    await this.show(SearchMode.Usages);
  }

  autofillSelectedPath(): void {
    if (![SearchMode.File, SearchMode.Everywhere].includes(this.mode)) return;
    const result = this.results.find(result => this.resultId(result) === this.selectedId);
    if (!result?.uri || result.isFolder) return;
    this.query = vscode.workspace.asRelativePath(result.uri) + ':';
    this.search();
  }

  private async removeRecent(id: string): Promise<void> {
    if (this.query.trim() || this.scope.trim()) return;
    const result = this.results.find(result => this.resultId(result) === id);
    if (!result?.uri) return;
    await this.history.removeEntry(result.uri.fsPath, result.lineNumber);
    this.search();
  }

  private switchMode(mode: SearchMode): void {
    this.mode = mode;
    this.updateContexts();
    this.search();
  }
  nextTab(): void {
    const index = MODES.findIndex(mode => mode.id === this.mode);
    this.switchMode(MODES[(index + 1) % MODES.length].id);
  }
  prevTab(): void {
    const index = MODES.findIndex(mode => mode.id === this.mode);
    this.switchMode(MODES[(index - 1 + MODES.length) % MODES.length].id);
  }
  private toggle(option: OptionKey): void { this.options[option] = !this.options[option]; this.search(); }
  toggleCaseSensitive(): void { this.toggle('caseSensitive'); }
  toggleRegex(): void { this.toggle('useRegex'); }
  toggleGitIgnore(): void { this.toggle('excludeGitIgnored'); }
  toggleSearchIgnore(): void { this.toggle('excludeSearchIgnored'); }
  toggleFuzzySearch(): void { this.toggle('fuzzySearch'); }
  toggleMatchWholeWord(): void { this.toggle('matchWholeWord'); }

  private updateContexts(): void {
    const active = !!this.panel?.active && this.focused;
    void vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', active);
    void vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', active && [SearchMode.File, SearchMode.Everywhere].includes(this.mode));
    void vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', active && this.mode === SearchMode.Everywhere);
  }

  private resultId(result: SearchResult): string {
    return JSON.stringify([result.mode, result.commandId, result.uri?.toString(), result.lineNumber, result.column, result.moreCount, result.label]);
  }

  private async openResult(id: string, beside: boolean): Promise<void> {
    const result = this.results.find(result => this.resultId(result) === id);
    if (!result) return;
    try {
      if (result.moreCount) { this.switchMode(result.mode); return; }
      if (result.commandId) { await vscode.commands.executeCommand(result.commandId); return; }
      if (!result.uri) return;
      if (result.isFolder) { await vscode.commands.executeCommand('revealInExplorer', result.uri); return; }
      const line = result.lineNumber ?? (this.gotoLine === undefined ? undefined : this.gotoLine - 1);
      const column = result.column ?? Math.max(0, (this.gotoColumn ?? 1) - 1);
      const position = line === undefined ? undefined : new vscode.Position(line, column);
      await this.history.addOpened(result.uri, line, column);
      const viewColumn = beside ? vscode.ViewColumn.Beside : this.panel?.viewColumn;
      if (result.uri.path.endsWith('.ipynb')) await vscode.commands.executeCommand('vscode.open', result.uri, viewColumn);
      else await vscode.window.showTextDocument(result.uri, { viewColumn, selection: position && new vscode.Selection(position, position) });
    } catch (error) { this.showError(error); }
  }

  dispose(): void {
    this.indexSubscription.dispose();
    this.session.dispose();
    this.panel?.dispose();
  }
}
