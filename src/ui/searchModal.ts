import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult, type UsageTarget } from '../providers/types';
import type { IndexManager } from '../index/indexManager';
import type { SearchHistory } from '../history';
import { isAbsolutePath } from '../utils';
import { SearchSession } from '../searchSession';
import { ResultPreview } from './resultPreview';
import { buildTitle, parseLineCol } from './searchModel';
import { getSearchConfiguration, getSearchTabs, getTabMode } from '../searchModes';

/** Extends QuickPick with the proposed `sortByLabel` API (quickPickSortByLabel). */
interface SortableQuickPick<T extends vscode.QuickPickItem> extends vscode.QuickPick<T> {
  sortByLabel: boolean;
}

/** Stable identity key for a SearchResult, used to preserve active item across qp.items replacements. */
function getItemKey(item: SearchResult): string | undefined {
  if (item.kind === vscode.QuickPickItemKind.Separator) return undefined;
  if (item.commandId) return `cmd:${item.commandId}`;
  if (item.uri) {
    const base = `${item.mode}:${item.uri.toString()}`;
    if (item.lineNumber !== undefined) return `${base}:${item.lineNumber}:${item.column ?? 0}`;
    return base;
  }
  return undefined;
}

const PLACEHOLDERS: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Search everywhere...',
  [SearchMode.File]: 'Search files... (append :line:col to jump)',
  [SearchMode.Folder]: 'Search folders...',
  [SearchMode.Text]: 'Search text content...',
  [SearchMode.Symbol]: 'Search symbols... (Enter to open, Ctrl+Enter for usages)',
  [SearchMode.Command]: 'Search commands...',
  [SearchMode.Usages]: 'Search symbols to find usages...',
};

const TAB_NAMES: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Everything',
  [SearchMode.File]: 'Files',
  [SearchMode.Folder]: 'Folders',
  [SearchMode.Text]: 'Text',
  [SearchMode.Symbol]: 'Symbols',
  [SearchMode.Command]: 'Commands',
  [SearchMode.Usages]: 'Usages',
};

const goToFileButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('go-to-file'),
  tooltip: 'Go to File',
};

const findUsagesButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('references'),
  tooltip: 'Find Usages (Shift+F12)',
};

const removeFromHistoryButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('close'),
  tooltip: 'Remove from History',
};

export class SearchModal implements vscode.Disposable {
  private searchSession = new SearchSession<SearchResult[]>();
  private preview = new ResultPreview();
  private readonly previewButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('eye'),
    tooltip: `Preview (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Right)`,
  };
  private modernButtons: boolean;
  private readonly configurationListener: vscode.Disposable;

  // Search option toggles
  private excludeGitIgnored: boolean;
  private excludeSearchIgnored: boolean;
  private caseSensitive = false;
  private useRegex = false;
  private fuzzySearch = false;
  private matchWholeWord = false;

  // Tab state
  private activeTab: SearchMode = SearchMode.Everywhere;

  // Full unfiltered results from the last search
  private fullResults: SearchResult[] = [];
  private activeQuickPick: vscode.QuickPick<SearchResult> | undefined;

  // Stored so keyboard shortcut commands can trigger re-search
  private triggerSearch: (() => void) | undefined;

  // Parent query and selected symbol for the nested Usages view.
  private usageTarget?: UsageTarget;
  private usageParent?: {
    mode: SearchMode;
    query: string;
    results?: SearchResult[];
    items: readonly SearchResult[];
    activeItems: readonly SearchResult[];
    options: SearchOptions;
    title?: string;
    gotoLine?: number;
    gotoColumn?: number;
  };
  private ignoredInputValue?: string;
  // file:line:col goto target from current input
  private gotoLine?: number;
  private gotoColumn?: number;

  private get altKey(): string {
    return process.platform === 'darwin' ? 'Option' : 'Alt';
  }

  constructor(
    private indexManager: IndexManager,
    private history: SearchHistory,
    private providers: ReadonlyMap<SearchMode, SearchProvider>,
    private createPicker: () => vscode.QuickPick<SearchResult> = () => vscode.window.createQuickPick<SearchResult>(),
    private workspaceState?: vscode.Memento,
  ) {
    // Location and toggle controls became stable in VS Code 1.109.
    const [major, minor] = (vscode.version ?? '').split('.').map(Number);
    this.modernButtons = !!vscode.QuickInputButtonLocation && (major > 1 || (major === 1 && minor >= 109));
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    this.excludeGitIgnored = config.get<boolean>('excludeGitIgnored', true);
    this.excludeSearchIgnored = config.get<boolean>('excludeSearchIgnored', true);
    this.configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
      if (['enabledSearches', 'showEverythingTab', 'searchOrder', 'tabs', 'tabOrder', 'visibleTabs', 'everywhere.sections', 'everything.sources', 'everything.order']
        .some(key => event.affectsConfiguration(`searchPlusPlus.${key}`)) && this.activeQuickPick) this.rebuildButtons(this.activeQuickPick);
    });
  }

  private filterAndDisplay(): void {
    const qp = this.activeQuickPick;
    if (!qp) return;

    // Count items per section (moreCount items contribute their hidden count)
    const counts: Record<ResultSection, number> = {
      [ResultSection.Folders]: 0,
      [ResultSection.Files]: 0,
      [ResultSection.Text]: 0,
      [ResultSection.Symbols]: 0,
      [ResultSection.Commands]: 0,
    };
    for (const item of this.fullResults) {
      if (item.belongsToSection) {
        if (item.moreCount) {
          counts[item.belongsToSection] += item.moreCount;
        } else {
          counts[item.belongsToSection]++;
        }
      }
    }

    const filtered: SearchResult[] = [];
    let currentSection: ResultSection | undefined;
    const showSeparators = this.activeTab === SearchMode.Everywhere;

    for (const item of this.fullResults) {
      const section = item.belongsToSection;

      // Insert separator when section changes (only on All tab)
      if (showSeparators && section && section !== currentSection) {
        currentSection = section;
        const sectionLabel =
          section === ResultSection.Folders ? `Folders (${counts[ResultSection.Folders]})` :
          section === ResultSection.Files ? `Files (${counts[ResultSection.Files]})` :
          section === ResultSection.Symbols ? `Symbols (${counts[ResultSection.Symbols]})` :
          section === ResultSection.Commands ? `Commands (${counts[ResultSection.Commands]})` :
          `Text Matches (${counts[ResultSection.Text]})`;
        filtered.push({
          label: sectionLabel,
          kind: vscode.QuickPickItemKind.Separator,
          mode: SearchMode.Everywhere,
          alwaysShow: true,
        });
      }

      if (item.uri && !item.isFolder && !item.commandId) {
        filtered.push({ ...item, buttons: item.mode === SearchMode.Symbol
          ? [findUsagesButton, goToFileButton, this.previewButton] : [goToFileButton, this.previewButton] });
      } else {
        filtered.push(item);
      }
    }

    const prevActive = qp.activeItems?.[0];
    const prevKey = prevActive ? getItemKey(prevActive) : undefined;

    qp.items = filtered;

    if (prevKey) {
      const restored = filtered.find(item => getItemKey(item) === prevKey);
      if (restored) {
        qp.activeItems = [restored];
      }
    }

    this.updateTitle(qp, counts);
  }

  private updateTitle(
    qp: vscode.QuickPick<SearchResult>,
    counts: Record<ResultSection, number>,
  ): void {
    const tabName = this.tabTitle();

    const state = this.indexManager.state;

    if (this.activeTab === SearchMode.Everywhere) {
      const total = counts[ResultSection.Folders] + counts[ResultSection.Files] + counts[ResultSection.Text] + counts[ResultSection.Symbols] + counts[ResultSection.Commands];
      if (total === 0) {
        qp.title = buildTitle(tabName, state);
        return;
      }
      const parts: string[] = [];
      if (counts[ResultSection.Files] > 0) parts.push(`${counts[ResultSection.Files]} files`);
      if (counts[ResultSection.Folders] > 0) parts.push(`${counts[ResultSection.Folders]} folders`);
      if (counts[ResultSection.Text] > 0) parts.push(`${counts[ResultSection.Text]} text`);
      if (counts[ResultSection.Symbols] > 0) parts.push(`${counts[ResultSection.Symbols]} symbols`);
      if (counts[ResultSection.Commands] > 0) parts.push(`${counts[ResultSection.Commands]} commands`);
      qp.title = buildTitle(`${tabName}: ${parts.join(', ')}`, state);
    } else {
      const count = this.fullResults.filter(item => item.uri || item.commandId).length;
      if (count === 0) {
        qp.title = buildTitle(this.fullResults.length > 0 ? `${tabName}: 0 results` : tabName, state);
      } else {
        const unit =
          this.activeTab === SearchMode.File ? 'files' :
          this.activeTab === SearchMode.Folder ? 'folders' :
          this.activeTab === SearchMode.Text ? 'matches' :
          this.activeTab === SearchMode.Symbol ? 'symbols' :
          this.activeTab === SearchMode.Command ? 'commands' : 'results';
        qp.title = buildTitle(`${tabName}: ${count} ${unit}`, state);
      }
    }
  }

  show(initialMode?: SearchMode): void {
    if (initialMode) initialMode = getTabMode(initialMode);
    if (this.activeQuickPick) {
      if (initialMode) this.switchTab(initialMode);
      this.activeQuickPick.show();
      return;
    }
    this.fullResults = [];
    const qp = this.createPicker() as SortableQuickPick<SearchResult>;
    this.activeQuickPick = qp;
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const preferences = getSearchConfiguration(config);
    const savedMode = preferences.opening === 'last'
      ? this.workspaceState?.get<unknown>('searchPlusPlus.lastSearchMode') : undefined;
    const visibleTabs = preferences.tabs;
    const savedTab = getTabMode(savedMode as SearchMode);
    const defaultTab = preferences.opening === 'last' ? visibleTabs[0] : preferences.opening;
    this.activeTab = initialMode ?? (visibleTabs.includes(savedTab) ? savedTab
      : visibleTabs.includes(defaultTab) ? defaultTab : visibleTabs[0]);
    qp.placeholder = this.placeholder();
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.sortByLabel = false;
    qp.keepScrollPosition = true;

    this.rebuildButtons(qp);
    qp.title = buildTitle(this.tabTitle(), this.indexManager.state);

    const debounceMs = config.get<number>('debounceMs', 200);

    const buildEmptyQueryItems = (): SearchResult[] => {
      if (this.activeTab === SearchMode.Symbol) return [{
        label: '$(symbol-method) Search for a symbol',
        description: 'Enter opens the symbol; Ctrl+Enter or Shift+F12 shows usages',
        mode: SearchMode.Symbol,
        alwaysShow: true,
      }];
      const items: SearchResult[] = [];
      const recentItems = this.history.getRecentItems();
      if (recentItems.length > 0) {
        items.push({
          label: 'Recent',
          mode: SearchMode.Everywhere,
          alwaysShow: true,
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push(...recentItems.map(item => ({
          ...item,
          buttons: [goToFileButton, this.previewButton, removeFromHistoryButton],
        })));
      }
      return items;
    };

    qp.items = buildEmptyQueryItems();

    const showNoResults = () => {
      if (this.activeTab === SearchMode.Usages) {
        const targetName = this.usageTarget?.name;
        const filteringUsages = targetName !== undefined && qp.value.trim() !== targetName;
        qp.items = [{
          label: filteringUsages ? '$(references) No usages match this filter'
            : this.usageTarget ? '$(references) No references reported' : '$(symbol-method) No symbols found',
          description: filteringUsages
            ? `Try another filter, restore ${targetName} to show all references, or clear the box to choose another symbol`
            : 'Check language support and indexing, try another query, or include ignored files',
          mode: SearchMode.Usages,
          alwaysShow: true,
        }];
        qp.title = `${this.tabTitle()}: 0 results`;
        return;
      }
      const state = this.indexManager.state;
      if (state === 'building') {
        qp.items = [{
          label: '$(sync) Indexing workspace...',
          description: 'Results will appear as files are discovered',
          mode: this.activeTab,
          alwaysShow: true,
        }];
        qp.title = buildTitle(`${this.tabTitle()}: indexing...`, state);
        return;
      }
      const hints = ['Try a different search term'];
      if (this.excludeGitIgnored || this.excludeSearchIgnored) {
        const toggles: string[] = [];
        if (this.excludeGitIgnored) toggles.push(`gitignore (${this.altKey}+G)`);
        if (this.excludeSearchIgnored) toggles.push(`search-ignore (${this.altKey}+S)`);
        hints.push(`or toggle ${toggles.join(', ')} to include excluded files`);
      }
      qp.items = [{
        label: '$(search-stop) No results found',
        description: hints.join(', '),
        mode: this.activeTab,
        alwaysShow: true,
      }];
      qp.title = `${this.tabTitle()}: 0 results`;
    };

    let busyTimer: ReturnType<typeof setTimeout> | undefined;
    const clearBusyTimer = () => {
      if (busyTimer) { clearTimeout(busyTimer); busyTimer = undefined; }
    };

    const handleResults = (results: SearchResult[]) => {
      this.fullResults = results;
      if (results.length === 0) {
        showNoResults();
      } else {
        this.filterAndDisplay();
      }

      if (this.activeTab === SearchMode.Everywhere) {
        // Debounce: keep spinner visible while text results are still streaming
        clearBusyTimer();
        busyTimer = setTimeout(() => { qp.busy = false; }, 400);
      } else {
        qp.busy = false;
      }
    };

    const clearSearch = () => {
      this.searchSession.cancel();
      this.preview.cancel();
      this.fullResults = [];
      this.gotoLine = undefined;
      this.gotoColumn = undefined;
      clearBusyTimer();
      qp.items = buildEmptyQueryItems();
      qp.busy = false;
      qp.title = buildTitle(this.tabTitle(), this.indexManager.state);
    };

    const handleError = (error: unknown) => {
      clearBusyTimer();
      qp.busy = false;
      this.fullResults = [];
      qp.items = [{
        label: '$(error) Search failed',
        description: error instanceof Error ? error.message : String(error),
        mode: this.activeTab,
        alwaysShow: true,
      }];
      qp.title = `${this.tabTitle()}: search failed`;
    };

    const executeSearch = (query: string, delayMs = 0) => {
      clearBusyTimer();
      this.fullResults = [];
      qp.items = [];
      qp.busy = true;
      qp.title = buildTitle(`${this.tabTitle()}: Searching...`, this.indexManager.state);
      const mode = this.activeTab === SearchMode.Usages && !this.usageTarget ? SearchMode.Symbol : this.activeTab;
      const provider = this.providers.get(mode);
      if (!provider) { clearSearch(); return; }
      const options = this.getSearchOptions();
      this.searchSession.run(
        (publish, fail) => provider.search(query, options, publish, fail),
        handleResults, handleError, delayMs,
      );
    };

    // Main search dispatcher
    const executeSearchForCurrentTab = () => {
      const rawValue = this.activeTab === SearchMode.Text ? qp.value : qp.value.trim();
      if (this.activeTab === SearchMode.Usages && this.usageTarget) {
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        executeSearch(rawValue === this.usageTarget.name ? '' : rawValue, debounceMs);
        return;
      }
      if (!rawValue.trim()) { clearSearch(); return; }

      // Absolute path → stat and show single result
      if ((this.activeTab === SearchMode.File || this.activeTab === SearchMode.Everywhere || this.activeTab === SearchMode.Folder) && isAbsolutePath(rawValue)) {
        const { query, gotoLine, gotoColumn } = parseLineCol(rawValue);
        this.gotoLine = gotoLine;
        this.gotoColumn = gotoColumn;
        clearBusyTimer();
        this.fullResults = [];
        qp.items = [];
        qp.busy = true;
        this.searchSession.run(
          (publish, fail) => { void this.handleAbsolutePath(query).then(publish, fail); },
          handleResults, handleError,
        );
        return;
      }

      // Parse line:col on Files and Everywhere tabs
      if (this.activeTab === SearchMode.File || this.activeTab === SearchMode.Everywhere) {
        const { query, gotoLine, gotoColumn } = parseLineCol(rawValue);
        this.gotoLine = gotoLine;
        this.gotoColumn = gotoColumn;
        // Strip trailing colon / partial line:col so fzf only sees the filename
        const fileQuery = query.replace(/:[\d]*$/, '');
        if (!fileQuery.trim()) { clearSearch(); return; }
        executeSearch(fileQuery);
      } else if (this.activeTab === SearchMode.Text || this.activeTab === SearchMode.Symbol || this.activeTab === SearchMode.Command || this.activeTab === SearchMode.Usages) {
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        executeSearch(rawValue, debounceMs);
      } else {
        // Folder (instant fzf)
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        executeSearch(rawValue);
      }
    };

    this.triggerSearch = executeSearchForCurrentTab;

    // Handle input changes
    const inputDisposable = qp.onDidChangeValue(value => {
      if (value === this.ignoredInputValue) { this.ignoredInputValue = undefined; return; }
      this.ignoredInputValue = undefined;
      if (!qp.value.trim() && this.usageTarget) {
        this.clearUsageTarget();
        this.activeTab = SearchMode.Symbol;
        this.updateTabContexts();
        qp.placeholder = this.placeholder();
        this.rebuildButtons(qp);
      }
      executeSearchForCurrentTab();
    });

    const acceptDisposable = this.setupAcceptHandler(qp);
    const staleDisposable = this.setupStaleHandler(qp);
    const itemButtonDisposable = this.setupItemButtonHandler(qp, buildEmptyQueryItems);
    const buttonDisposable = this.setupButtonHandler(qp, executeSearchForCurrentTab);

    // Cleanup on hide
    const hideDisposable = qp.onDidHide(() => {
      if (getSearchConfiguration(vscode.workspace.getConfiguration('searchPlusPlus')).opening === 'last') {
        void this.workspaceState?.update('searchPlusPlus.lastSearchMode', getTabMode(this.activeTab)).then(undefined, () => {});
      }
      clearBusyTimer();
      this.preview.cancel();

      vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', false);
      vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', false);
      vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', false);
      vscode.commands.executeCommand('setContext', 'searchPlusPlusSymbolTab', false);
      this.searchSession.cancel();
      this.activeQuickPick = undefined;
      this.triggerSearch = undefined;
      this.clearUsageTarget();
      this.gotoLine = undefined;
      this.gotoColumn = undefined;
      inputDisposable.dispose();
      acceptDisposable.dispose();
      staleDisposable.dispose();
      itemButtonDisposable.dispose();
      buttonDisposable.dispose();
      hideDisposable.dispose();
      qp.dispose();
    });

    vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', true);
    this.updateTabContexts();
    qp.show();
  }

  // --- Absolute path handling ---

  private async handleAbsolutePath(path: string): Promise<SearchResult[]> {
    const uri = vscode.Uri.file(path);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;
      const name = path.split(/[/\\]/).filter(Boolean).pop() || path;
      return [{
        label: name, description: path,
        mode: isDir ? SearchMode.Folder : SearchMode.File,
        uri, iconPath: isDir ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File,
        alwaysShow: true, isFolder: isDir,
        belongsToSection: isDir ? ResultSection.Folders : ResultSection.Files,
      }];
    } catch {
      return [{ label: '$(warning) Path not found', description: path, mode: SearchMode.File, alwaysShow: true }];
    }
  }

  // --- Tab switching ---

  private switchTab(mode: SearchMode): void {
    if (this.activeTab === SearchMode.Usages && mode === this.usageParent?.mode) {
      this.restoreParentSearch();
      return;
    }
    if (this.activeTab === mode) {
      if (this.activeQuickPick) this.rebuildButtons(this.activeQuickPick);
      return;
    }
    const previousMode = this.activeTab;
    const qp = this.activeQuickPick;
    if (!qp) return;
    if (previousMode === SearchMode.Usages && this.usageTarget) {
      const query = this.usageParent?.query ?? '';
      this.clearUsageTarget();
      this.setInputValue(qp, query);
    }
    this.activeTab = mode;
    this.updateTabContexts();
    qp.placeholder = this.placeholder();
    this.rebuildButtons(qp);
    if (this.triggerSearch) {
      this.triggerSearch();
    }
  }

  private tabOrder(): SearchMode[] {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const visible = getSearchTabs(config);
    const active = getTabMode(this.activeTab);
    return visible.includes(active) ? visible : [...visible, active];
  }

  private updateTabContexts(): void {
    vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', this.activeTab === SearchMode.File || this.activeTab === SearchMode.Everywhere);
    vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', this.activeTab === SearchMode.Everywhere);
    vscode.commands.executeCommand('setContext', 'searchPlusPlusSymbolTab', this.activeTab === SearchMode.Symbol);
  }

  private getSearchOptions(): SearchOptions {
    return {
      excludeGitIgnored: this.excludeGitIgnored, excludeSearchIgnored: this.excludeSearchIgnored,
      caseSensitive: this.caseSensitive, useRegex: this.useRegex,
      fuzzySearch: this.fuzzySearch, matchWholeWord: this.matchWholeWord,
      usageTarget: this.usageTarget,
    };
  }

  nextTab(): void {
    const order = this.tabOrder();
    this.switchTab(order[(order.indexOf(getTabMode(this.activeTab)) + 1) % order.length]);
  }

  prevTab(): void {
    const order = this.tabOrder();
    this.switchTab(order[(order.indexOf(getTabMode(this.activeTab)) - 1 + order.length) % order.length]);
  }

  // --- Buttons ---

  private buttonActions = new Map<vscode.QuickInputButton, () => void>();
  private optionButtons = new Set<vscode.QuickInputButton>();

  private rebuildButtons(qp: vscode.QuickPick<SearchResult>): void {
    const settingsBtn: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('gear'),
      tooltip: 'Open search++ Settings',
      ...(this.modernButtons ? { location: vscode.QuickInputButtonLocation.Inline } : {}),
    };

    // Tab buttons (title bar)
    const everywhereBtn = this.tabButton('search', TAB_NAMES[SearchMode.Everywhere], SearchMode.Everywhere);
    const fileBtn = this.tabButton('file', TAB_NAMES[SearchMode.File], SearchMode.File);
    const folderBtn = this.tabButton('folder', TAB_NAMES[SearchMode.Folder], SearchMode.Folder);
    const textBtn = this.tabButton('book', TAB_NAMES[SearchMode.Text], SearchMode.Text);
    const symbolBtn = this.tabButton('symbol-method', TAB_NAMES[SearchMode.Symbol], SearchMode.Symbol);
    const commandBtn = this.tabButton('terminal', TAB_NAMES[SearchMode.Command], SearchMode.Command);

    // Option toggle buttons (inline)
    const gitIgnoreBtn = this.toggle('source-control', `Exclude Git Ignored (${this.altKey}+G)`, this.excludeGitIgnored,
      vscode.QuickInputButtonLocation?.Inline);
    const searchIgnoreBtn = this.toggle('eye-closed', `Exclude Search Ignored (${this.altKey}+S)`, this.excludeSearchIgnored,
      vscode.QuickInputButtonLocation?.Inline);
    const caseSensitiveBtn = this.toggle('case-sensitive', `Case Sensitive (${this.altKey}+C)`, this.caseSensitive,
      vscode.QuickInputButtonLocation?.Inline);
    const regexBtn = this.toggle('regex', `Regex (${this.altKey}+R)`, this.useRegex,
      vscode.QuickInputButtonLocation?.Inline);
    const wholeWordBtn = this.toggle('whole-word', `Match Whole Word (${this.altKey}+W)`, this.matchWholeWord,
      vscode.QuickInputButtonLocation?.Inline);
    const fuzzyBtn = this.toggle('sparkle', `Fuzzy Search (${this.altKey}+F)`, this.fuzzySearch,
      vscode.QuickInputButtonLocation?.Inline);

    const tabButtons: Record<SearchMode, vscode.QuickInputButton> = {
      [SearchMode.Everywhere]: everywhereBtn, [SearchMode.File]: fileBtn,
      [SearchMode.Folder]: folderBtn, [SearchMode.Text]: textBtn,
      [SearchMode.Symbol]: symbolBtn, [SearchMode.Usages]: symbolBtn, [SearchMode.Command]: commandBtn,
    };
    qp.buttons = [
      ...(this.activeTab === SearchMode.Usages && this.usageTarget ? [vscode.QuickInputButtons.Back] : []),
      ...this.tabOrder().map(mode => tabButtons[mode]),
      gitIgnoreBtn, searchIgnoreBtn, caseSensitiveBtn, regexBtn, wholeWordBtn, fuzzyBtn,
      settingsBtn,
    ];

    this.buttonActions = new Map<vscode.QuickInputButton, () => void>([
      [vscode.QuickInputButtons.Back, () => this.restoreParentSearch()],
      [settingsBtn, () => {
        qp.hide();
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:expiracy.search-plus-plus');
      }],
      [everywhereBtn, () => this.switchTab(SearchMode.Everywhere)],
      [fileBtn, () => this.switchTab(SearchMode.File)],
      [folderBtn, () => this.switchTab(SearchMode.Folder)],
      [textBtn, () => this.switchTab(SearchMode.Text)],
      [symbolBtn, () => this.switchTab(SearchMode.Symbol)],
      [commandBtn, () => this.switchTab(SearchMode.Command)],
      [gitIgnoreBtn, () => { this.excludeGitIgnored = !this.excludeGitIgnored; }],
      [searchIgnoreBtn, () => { this.excludeSearchIgnored = !this.excludeSearchIgnored; }],
      [caseSensitiveBtn, () => { this.caseSensitive = !this.caseSensitive; }],
      [regexBtn, () => { this.useRegex = !this.useRegex; }],
      [wholeWordBtn, () => { this.matchWholeWord = !this.matchWholeWord; }],
      [fuzzyBtn, () => { this.fuzzySearch = !this.fuzzySearch; }],
    ]);

    this.optionButtons = new Set([
      gitIgnoreBtn, searchIgnoreBtn, caseSensitiveBtn, regexBtn, wholeWordBtn, fuzzyBtn,
    ]);
  }

  private tabButton(icon: string, tooltip: string, mode: SearchMode): vscode.QuickInputButton {
    return {
      iconPath: new vscode.ThemeIcon(icon),
      tooltip,
      ...(this.modernButtons ? { location: vscode.QuickInputButtonLocation.Title, toggle: { checked: getTabMode(this.activeTab) === mode } } : {}),
    };
  }

  private toggle(icon: string, tooltip: string, checked: boolean, location?: vscode.QuickInputButtonLocation): vscode.QuickInputButton {
    return { iconPath: new vscode.ThemeIcon(icon), tooltip: this.modernButtons ? tooltip : `${tooltip}: ${checked ? 'on' : 'off'}`,
      ...(this.modernButtons ? { location, toggle: { checked } } : {}),
    };
  }

  // --- Public toggle methods for keyboard shortcuts ---

  toggleCaseSensitive(): void {
    this.caseSensitive = !this.caseSensitive;
    this.applyOptionToggle();
  }

  toggleRegex(): void {
    this.useRegex = !this.useRegex;
    this.applyOptionToggle();
  }

  toggleGitIgnore(): void {
    this.excludeGitIgnored = !this.excludeGitIgnored;
    this.applyOptionToggle();
  }

  toggleSearchIgnore(): void {
    this.excludeSearchIgnored = !this.excludeSearchIgnored;
    this.applyOptionToggle();
  }

  toggleFuzzySearch(): void {
    this.fuzzySearch = !this.fuzzySearch;
    this.applyOptionToggle();
  }

  toggleMatchWholeWord(): void {
    this.matchWholeWord = !this.matchWholeWord;
    this.applyOptionToggle();
  }

  /** Autofill input with the selected file's path + ":" so user can type line:col */
  autofillSelectedPath(): void {
    const qp = this.activeQuickPick;
    if (!qp || (this.activeTab !== SearchMode.File && this.activeTab !== SearchMode.Everywhere)) return;
    const selected = qp.activeItems[0];
    if (!selected?.uri || selected.isFolder || !this.isCurrentItem(selected)) return;
    const relativePath = vscode.workspace.asRelativePath(selected.uri);
    qp.value = relativePath + ':';
    this.triggerSearch?.();
  }

  private applyOptionToggle(): void {
    const qp = this.activeQuickPick;
    if (!qp) return;
    this.rebuildButtons(qp);
    if (this.triggerSearch) {
      this.triggerSearch();
    }
  }

  // --- Event handler setup (extracted from show()) ---

  private setupAcceptHandler(qp: vscode.QuickPick<SearchResult>): vscode.Disposable {
    return qp.onDidAccept(() => {
      if (qp.busy && this.fullResults.length === 0) return;
      const selected = qp.selectedItems[0];
      if (!selected || !this.isCurrentItem(selected)) return;

      if (selected.commandId) {
        qp.hide();
        const command = selected.commandId;
        this.preview.finish().then(() => vscode.commands.executeCommand(command)).then(undefined, () => {});
        return;
      }

      // "More results" truncation indicator -> switch to that tab
      if (selected.moreCount && selected.mode !== this.activeTab) {
        this.switchTab(selected.mode);
        return;
      }

      if (!selected.uri) return;
      const uri = selected.uri;

      // Determine line/col: prefer result's own position (text matches),
      // fall back to file:line:col goto target
      const line = selected.lineNumber ?? (this.gotoLine !== undefined ? this.gotoLine - 1 : undefined);
      const col = selected.column ?? (this.gotoColumn !== undefined ? Math.max(0, this.gotoColumn - 1) : 0);

      qp.hide();

      if (selected.isFolder) {
        this.preview.finish().then(() => vscode.commands.executeCommand('workbench.view.explorer')).then(
          () => { vscode.commands.executeCommand('revealInExplorer', uri); },
          () => {},
        );
        return;
      }

      this.history.addOpened(uri, line, col);

      this.preview.finish(uri).then(() => vscode.commands.executeCommand('vscode.open', uri)).then(
        () => {
          if (line !== undefined && !uri.fsPath.endsWith('.ipynb')) {
            const pos = new vscode.Position(line, col);
            const selection = new vscode.Selection(pos, pos);
            return vscode.window.showTextDocument(uri, { selection }).then(editor => {
              editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
            });
          }
        },
      ).then(undefined, () => {});
    });
  }

  private setupStaleHandler(qp: vscode.QuickPick<SearchResult>): vscode.Disposable {
    return this.indexManager.onDidChangeState((state) => {
      if (state === 'stale') {
        qp.title = 'Index may be stale';
        return;
      }

      // On 'building' or 'ready': re-run the current search if a query is active
      // so result counts and the buildTitle prefix stay in sync with state.
      if (qp.value.trim() && this.triggerSearch) {
        this.triggerSearch();
        return;
      }

      const counts: Record<ResultSection, number> = {
        [ResultSection.Folders]: 0,
        [ResultSection.Files]: 0,
        [ResultSection.Text]: 0,
        [ResultSection.Symbols]: 0,
        [ResultSection.Commands]: 0,
      };
      for (const item of this.fullResults) {
        if (item.belongsToSection) counts[item.belongsToSection]++;
      }
      this.updateTitle(qp, counts);
    });
  }

  private setupItemButtonHandler(
    qp: vscode.QuickPick<SearchResult>,
    buildEmptyQueryItems: () => SearchResult[],
  ): vscode.Disposable {
    return qp.onDidTriggerItemButton((e) => {
      const item = e.item;
      if (!item.uri || !this.isCurrentItem(item)) return;
      const uri = item.uri;

      if (e.button === findUsagesButton) { this.findUsages(item); return; }
      if (e.button === this.previewButton) { void this.previewSelectedResult(item); return; }

      if (e.button === removeFromHistoryButton) {
        this.history.removeEntry(uri.fsPath, item.lineNumber);
        qp.items = buildEmptyQueryItems();
        return;
      }

      // Go to the selected file in the current editor group
      const line = item.lineNumber ?? (this.gotoLine === undefined ? undefined : this.gotoLine - 1);
      const column = item.column ?? Math.max(0, (this.gotoColumn ?? 1) - 1);
      const position = line !== undefined && !uri.fsPath.endsWith('.ipynb')
        ? new vscode.Position(line, column) : undefined;
      const selection = position && new vscode.Selection(position, position);
      qp.hide();

      this.preview.finish(uri).then(() => vscode.commands.executeCommand('vscode.open', uri, {
        ...(selection ? { selection } : {}),
      })).then(() => {
        const editor = vscode.window.activeTextEditor;
        if (selection && editor?.document.uri.toString() === uri.toString()) {
          editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
        }
        return this.history.addOpened(uri, line, column);
      }).then(undefined, () => {});
    });
  }

  private setupButtonHandler(
    qp: vscode.QuickPick<SearchResult>,
    executeSearchForCurrentTab: () => void,
  ): vscode.Disposable {
    return qp.onDidTriggerButton((button) => {
      const action = this.buttonActions.get(button);
      if (!action) return;
      action();
      // Option toggles need button rebuild + re-search; tab switches handle this via switchTab
      if (this.optionButtons.has(button)) {
        this.rebuildButtons(qp);
        executeSearchForCurrentTab();
      }
    });
  }

  private placeholder(): string {
    return this.activeTab === SearchMode.Usages && this.usageTarget
      ? `Filter usages of ${this.usageTarget.name} by text or path...` : PLACEHOLDERS[this.activeTab];
  }

  private clearUsageTarget(): void {
    this.usageTarget = undefined;
    this.usageParent = undefined;
    this.ignoredInputValue = undefined;
  }

  private setInputValue(qp: vscode.QuickPick<SearchResult>, value: string): void {
    if (qp.value === value) return;
    this.ignoredInputValue = value;
    qp.value = value;
  }

  private restoreParentSearch(): void {
    const parent = this.usageParent;
    const qp = this.activeQuickPick;
    if (!parent || !qp) return;
    this.searchSession.cancel();
    this.preview.cancel();
    this.clearUsageTarget();
    this.activeTab = parent.mode;
    this.excludeGitIgnored = parent.options.excludeGitIgnored;
    this.excludeSearchIgnored = parent.options.excludeSearchIgnored;
    this.caseSensitive = parent.options.caseSensitive;
    this.useRegex = parent.options.useRegex;
    this.fuzzySearch = parent.options.fuzzySearch;
    this.matchWholeWord = parent.options.matchWholeWord;
    this.fullResults = parent.results ?? [];
    this.gotoLine = parent.gotoLine;
    this.gotoColumn = parent.gotoColumn;
    this.setInputValue(qp, parent.query);
    qp.items = parent.items;
    qp.activeItems = parent.activeItems;
    qp.title = parent.title;
    qp.busy = false;
    qp.placeholder = this.placeholder();
    this.rebuildButtons(qp);
    this.updateTabContexts();
    if (!parent.results) this.triggerSearch?.();
  }

  private tabTitle(): string {
    return this.activeTab === SearchMode.Usages && this.usageTarget
      ? `Usages of ${this.usageTarget.name}` : TAB_NAMES[this.activeTab];
  }

  private isCurrentItem(item: SearchResult): boolean {
    const key = getItemKey(item);
    return this.activeQuickPick?.items.some(candidate => candidate === item
      || (key !== undefined && candidate.mode === item.mode && getItemKey(candidate) === key)) ?? false;
  }

  findUsages(item = this.activeQuickPick?.activeItems?.[0]): void {
    if (this.activeQuickPick?.busy && this.fullResults.length === 0) return;
    if (this.activeQuickPick && item && !this.isCurrentItem(item)) return;
    let target: UsageTarget;
    if (item?.uri && item.mode === SearchMode.Symbol) {
      target = {
        uri: item.uri, position: new vscode.Position(item.lineNumber ?? 0, item.column ?? 0),
        name: item.label.replace(/^\$\([^)]+\)\s*/, ''),
      };
    } else {
      if (this.activeQuickPick) return;
      const editor = vscode.window.activeTextEditor;
      const position = editor?.selection.active;
      const word = position && editor?.document.getWordRangeAtPosition(position);
      if (!editor || !position || !word) { this.show(SearchMode.Symbol); return; }
      target = { uri: editor.document.uri, position, name: editor.document.getText(word) };
    }
    const previousPicker = this.activeQuickPick;
    if (!previousPicker) this.show(SearchMode.Symbol);
    const qp = this.activeQuickPick!;
    this.usageParent = {
      mode: this.activeTab, query: previousPicker ? qp.value : target.name,
      results: previousPicker ? [...this.fullResults] : undefined, items: [...qp.items],
      activeItems: [...qp.activeItems], title: qp.title,
      options: this.getSearchOptions(),
      gotoLine: this.gotoLine, gotoColumn: this.gotoColumn,
    };
    this.usageTarget = target;
    this.setInputValue(qp, target.name);
    qp.placeholder = `Filter usages of ${target.name} by text or path...`;
    if (this.activeTab === SearchMode.Usages) { this.rebuildButtons(qp); this.triggerSearch?.(); }
    else this.switchTab(SearchMode.Usages);
  }

  async previewSelectedResult(result = this.activeQuickPick?.activeItems[0]): Promise<void> {
    const qp = this.activeQuickPick;
    if (!qp || (qp.busy && this.fullResults.length === 0)) return;
    if (!result?.uri || result.isFolder || result.commandId || !this.isCurrentItem(result)) return;
    const line = result.lineNumber ?? (this.gotoLine === undefined ? undefined : this.gotoLine - 1);
    const column = result.column ?? Math.max(0, (this.gotoColumn ?? 1) - 1);
    const position = line === undefined ? undefined : new vscode.Position(line, column);
    const selection = position && !result.uri.path.endsWith('.ipynb') ? new vscode.Selection(position, position) : undefined;
    try { await this.preview.show(result.uri, selection); }
    catch (error) {
      if (this.activeQuickPick === qp) qp.title = `Preview failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  dispose(): void {
    this.configurationListener.dispose();
    this.preview.dispose();
    this.searchSession.cancel();
    this.activeQuickPick?.hide();
  }
}
