import * as vscode from 'vscode';
import { DEFAULT_TAB_ORDER, getTabOrder, SearchMode } from '../searchModes';

export const WINDOW_TAB_MIME = 'application/vnd.code.tree.searchpluspluswindow';
export type WindowNode = { kind: 'scope' | 'opening' | 'tabs' } | { kind: 'tab'; mode: SearchMode };
interface OpeningChoice extends vscode.QuickPickItem { remember: boolean; mode?: SearchMode }
interface PositionChoice extends vscode.QuickPickItem { position: number }

export const SEARCH_WINDOW_VIEW = 'searchPlusPlus.searchWindow';
const windowSettings = ['tabOrder', 'visibleTabs', 'defaultMode', 'rememberLastMode'] as const;
const tabs: Record<SearchMode, { label: string; icon: string }> = {
  [SearchMode.Everywhere]: { label: 'Everything', icon: 'search' },
  [SearchMode.File]: { label: 'Files', icon: 'file' },
  [SearchMode.Folder]: { label: 'Folders', icon: 'folder' },
  [SearchMode.Text]: { label: 'Text', icon: 'book' },
  [SearchMode.Symbol]: { label: 'Symbols', icon: 'symbol-method' },
  [SearchMode.Command]: { label: 'Commands', icon: 'terminal' },
  [SearchMode.Usages]: { label: 'Symbols', icon: 'symbol-method' },
};

export class SearchWindowConfiguration implements vscode.TreeDataProvider<WindowNode>, vscode.TreeDragAndDropController<WindowNode>, vscode.Disposable {
  readonly dragMimeTypes = [WINDOW_TAB_MIME];
  readonly dropMimeTypes = [WINDOW_TAB_MIME];
  private readonly changed = new vscode.EventEmitter<WindowNode | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<WindowNode>;
  private readonly subscriptions: vscode.Disposable[] = [];
  private target = vscode.ConfigurationTarget.Global;
  private pending = Promise.resolve();
  private readonly scopeNode: WindowNode = { kind: 'scope' };
  private readonly openingNode: WindowNode = { kind: 'opening' };
  private readonly tabsNode: WindowNode = { kind: 'tabs' };

  constructor() {
    const configuration = vscode.workspace.getConfiguration('searchPlusPlus');
    if (windowSettings.some(key => configuration.inspect(key)?.workspaceValue !== undefined)) this.target = vscode.ConfigurationTarget.Workspace;
    this.view = vscode.window.createTreeView(SEARCH_WINDOW_VIEW, {
      treeDataProvider: this, dragAndDropController: this, manageCheckboxStateManually: true,
    });
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('searchPlusPlus')) this.refresh();
    }), this.view.onDidChangeCheckboxState(event => { void this.setVisibility(event.items); }));
    this.refresh();
  }

  private read<T>(key: string, fallback: T): T {
    const setting = vscode.workspace.getConfiguration('searchPlusPlus').inspect<T>(key);
    return (this.target === vscode.ConfigurationTarget.Workspace ? setting?.workspaceValue : undefined)
      ?? setting?.globalValue ?? setting?.defaultValue ?? fallback;
  }

  private refresh(): void {
    this.view.description = this.target === vscode.ConfigurationTarget.Global ? 'User settings' : 'Workspace settings';
    this.view.message = 'Drag tabs to arrange them. Checked tabs appear in search. Changes save automatically.';
    if (this.target === vscode.ConfigurationTarget.Global && windowSettings.some(key =>
      vscode.workspace.getConfiguration('searchPlusPlus').inspect(key)?.workspaceValue !== undefined)) {
      this.view.message += ' Some settings are overridden in this workspace.';
    }
    this.changed.fire();
  }

  private change(action: () => Promise<void>): Promise<void> {
    this.pending = this.pending.then(action).catch(error => {
      void vscode.window.showErrorMessage(`Could not update search++ settings: ${error instanceof Error ? error.message : String(error)}`);
    }).then(() => this.refresh());
    return this.pending;
  }

  getChildren(element?: WindowNode): WindowNode[] {
    if (!element) return [this.scopeNode, this.openingNode, this.tabsNode];
    if (element.kind !== 'tabs') return [];
    return getTabOrder(this.read('tabOrder', DEFAULT_TAB_ORDER)).map(mode => ({ kind: 'tab', mode }));
  }

  getParent(node: WindowNode): WindowNode | undefined {
    return node.kind === 'tab' ? this.tabsNode : undefined;
  }

  private visibleTabs(): SearchMode[] {
    return getTabOrder(this.read('tabOrder', DEFAULT_TAB_ORDER), this.read('visibleTabs', DEFAULT_TAB_ORDER));
  }

  private openingTab(): SearchMode {
    const visible = this.visibleTabs();
    const configured = this.read('defaultMode', SearchMode.Everywhere);
    return visible.includes(configured) ? configured : visible[0];
  }

  getTreeItem(node: WindowNode): vscode.TreeItem {
    if (node.kind === 'scope') {
      const item = new vscode.TreeItem('Applies to');
      item.id = 'scope';
      item.description = this.target === vscode.ConfigurationTarget.Global ? 'User settings' : 'This workspace';
      item.iconPath = new vscode.ThemeIcon('settings');
      item.command = { command: 'searchPlusPlus.configureWindow.scope', title: 'Choose where settings apply' };
      item.tooltip = 'User settings apply to all workspaces. Workspace settings override them for this project.';
      return item;
    }
    if (node.kind === 'opening') {
      const item = new vscode.TreeItem('Open search with');
      item.id = 'opening';
      item.iconPath = new vscode.ThemeIcon('play');
      item.description = this.read('rememberLastMode', false) ? 'Last used tab' : tabs[this.openingTab()].label;
      item.command = { command: 'searchPlusPlus.configureWindow.openingTab', title: 'Choose opening tab' };
      return item;
    }
    if (node.kind !== 'tab') {
      const item = new vscode.TreeItem('Visible tabs', vscode.TreeItemCollapsibleState.Expanded);
      item.id = 'tabs';
      return item;
    }
    const item = new vscode.TreeItem(tabs[node.mode].label);
    item.id = `tab.${node.mode}`;
    item.contextValue = 'searchPlusPlus.windowTab';
    item.iconPath = new vscode.ThemeIcon(tabs[node.mode].icon);
    const visible = this.visibleTabs();
    item.checkboxState = visible.includes(node.mode) ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    if (!this.read('rememberLastMode', false) && node.mode === this.openingTab()) item.description = 'Opens first';
    item.tooltip = 'Drag to the position you want, or drop in empty space to move to the end. Right-click for Move tab…';
    return item;
  }

  handleDrag(source: readonly WindowNode[], data: vscode.DataTransfer, token: vscode.CancellationToken): void {
    const tab = source.find(node => node.kind === 'tab');
    if (!token.isCancellationRequested && tab?.kind === 'tab') data.set(WINDOW_TAB_MIME, new vscode.DataTransferItem(tab.mode));
  }

  async chooseOpeningTab(): Promise<void> {
    await this.pending;
    const remember = this.read('rememberLastMode', false);
    const opening = this.openingTab();
    const choices: OpeningChoice[] = [
      { label: 'Last used tab', description: 'Continue where you left off', remember: true },
      ...this.visibleTabs().map(mode => ({ label: tabs[mode].label, description: 'Always open this tab', remember: false, mode })),
    ];
    const current = choices.find(choice => remember ? choice.remember : choice.mode === opening)!;
    current.description = `${current.description} · Current`;
    const selected = await vscode.window.showQuickPick([current, ...choices.filter(choice => choice !== current)], {
      title: 'When search opens', placeHolder: 'Choose the opening tab',
    });
    if (!selected) return;
    await this.change(async () => {
      const configuration = vscode.workspace.getConfiguration('searchPlusPlus');
      if (!selected.remember && selected.mode && this.visibleTabs().includes(selected.mode)) {
        await configuration.update('defaultMode', selected.mode, this.target);
        await configuration.update('rememberLastMode', false, this.target);
      } else if (selected.remember) await configuration.update('rememberLastMode', true, this.target);
    });
  }

  async chooseScope(): Promise<void> {
    await this.pending;
    const choices = [{ label: 'User settings', description: 'All workspaces', target: vscode.ConfigurationTarget.Global }];
    if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
      choices.push({ label: 'This workspace', description: 'Only this project', target: vscode.ConfigurationTarget.Workspace });
    }
    const selected = await vscode.window.showQuickPick(choices, { title: 'Where should these settings apply?' });
    if (!selected) return;
    this.target = selected.target;
    this.refresh();
  }

  async showMenu(): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      { id: 'window', label: '$(layout) Search window', description: 'Arrange tabs, show or hide them, and choose the opening tab' },
      { id: 'results', label: '$(list-filter) Search results', description: 'Result groups, exclusions, limits, and search delay' },
      { id: 'shortcuts', label: '$(keyboard) Keyboard shortcuts', description: 'Choose a shortcut preset' },
      { id: 'all', label: '$(settings-gear) All settings', description: 'Open all search++ settings in VS Code' },
    ], { title: 'search++ settings', placeHolder: 'What would you like to configure?' });
    if (!selected) return;
    if (selected.id === 'window') { await this.show(); return; }
    const keys = selected.id === 'results' ? [
      'everywhere.sections', 'maxResults', 'everywhere.resultLimit', 'debounceMs',
      'excludeGitIgnored', 'excludeSearchIgnored', 'excludePaths',
    ] : selected.id === 'shortcuts' ? ['shortcutPreset'] : [];
    const ids = keys.length ? ` @id:${keys.map(key => `searchPlusPlus.${key}`).join(',')}` : '';
    await vscode.commands.executeCommand('workbench.action.openSettings', `@ext:expiracy.search-plus-plus${ids}`);
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'searchPlusPlus.configuringWindow', true);
    await vscode.commands.executeCommand(`${SEARCH_WINDOW_VIEW}.focus`);
    await this.view.reveal(this.tabsNode, { expand: true, select: false, focus: false });
    await this.view.reveal(this.scopeNode, { select: false, focus: false });
  }

  async close(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'searchPlusPlus.configuringWindow', false);
  }

  async reset(): Promise<void> {
    await this.change(async () => {
      const configuration = vscode.workspace.getConfiguration('searchPlusPlus');
      for (const key of windowSettings) await configuration.update(key, undefined, this.target);
    });
  }

  async moveTab(node: WindowNode | undefined): Promise<void> {
    if (node?.kind !== 'tab' || !DEFAULT_TAB_ORDER.includes(node.mode)) return;
    await this.pending;
    const order = getTabOrder(this.read('tabOrder', DEFAULT_TAB_ORDER));
    const remaining = order.filter(mode => mode !== node.mode);
    const choices: PositionChoice[] = remaining.map((before, position) => ({ label: `${position + 1}. Before ${tabs[before].label}`, position }));
    choices.push({ label: `${order.length}. Last position`, position: order.length - 1 });
    const current = choices[order.indexOf(node.mode)];
    current.description = 'Current position';
    const selected = await vscode.window.showQuickPick([current, ...choices.filter(choice => choice !== current)], {
      title: `Move ${tabs[node.mode].label}`, placeHolder: 'Choose its position',
    });
    if (!selected) return;
    const token = new vscode.CancellationTokenSource();
    try {
      const data = new vscode.DataTransfer();
      this.handleDrag([node], data, token.token);
      await this.handleDrop({ kind: 'tab', mode: order[selected.position] }, data, token.token);
    } finally { token.dispose(); }
  }

  async setVisibility(changes: readonly [WindowNode, vscode.TreeItemCheckboxState][]): Promise<void> {
    await this.change(async () => {
      const order = getTabOrder(this.read('tabOrder', DEFAULT_TAB_ORDER));
      const current = getTabOrder(order, this.read('visibleTabs', DEFAULT_TAB_ORDER));
      const enabled = new Set(current);
      for (const [node, state] of changes) {
        if (node.kind !== 'tab' || !DEFAULT_TAB_ORDER.includes(node.mode)) continue;
        if (state === vscode.TreeItemCheckboxState.Checked) enabled.add(node.mode);
        else enabled.delete(node.mode);
      }
      const next = order.filter(mode => enabled.has(mode));
      if (next.length === 0) {
        void vscode.window.showInformationMessage('Keep at least one search tab visible.');
        return;
      }
      if (next.length === current.length && next.every((mode, i) => mode === current[i])) return;
      const configuration = vscode.workspace.getConfiguration('searchPlusPlus');
      await configuration.update('visibleTabs', next, this.target);
      if (!this.read('rememberLastMode', false) && !next.includes(this.read('defaultMode', SearchMode.Everywhere))) {
        await configuration.update('defaultMode', next[0], this.target);
      }
    });
  }

  async handleDrop(target: WindowNode | undefined, data: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const mode = data.get(WINDOW_TAB_MIME)?.value;
    if (token.isCancellationRequested || !DEFAULT_TAB_ORDER.includes(mode)
      || (target && target.kind !== 'tab' && target.kind !== 'tabs')
      || (target?.kind === 'tab' && (!DEFAULT_TAB_ORDER.includes(target.mode) || target.mode === mode))) return;
    await this.change(async () => {
      if (token.isCancellationRequested) return;
      const order = getTabOrder(this.read('tabOrder', DEFAULT_TAB_ORDER));
      const next = order.filter(tab => tab !== mode);
      const index = target?.kind === 'tab' ? order.indexOf(target.mode) : next.length;
      next.splice(index, 0, mode);
      if (next.every((tab, i) => tab === order[i])) return;
      await vscode.workspace.getConfiguration('searchPlusPlus').update('tabOrder', next, this.target);
    });
  }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    this.view.dispose();
    this.changed.dispose();
  }
}
