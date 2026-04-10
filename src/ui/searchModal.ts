import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from '../providers/types';
import { FileProvider } from '../providers/fileProvider';
import { TextProvider } from '../providers/textProvider';
import { FolderProvider } from '../providers/folderProvider';
import { SymbolProvider } from '../providers/symbolProvider';
import { CommandProvider } from '../providers/commandProvider';
import { EverywhereProvider } from '../providers/everywhereProvider';
import type { IndexManager, IndexState } from '../index/indexManager';
import type { SearchHistory } from '../history';
import { debounce, isAbsolutePath } from '../utils';

/** Extends QuickPick with the proposed `sortByLabel` API (quickPickSortByLabel). */
interface SortableQuickPick<T extends vscode.QuickPickItem> extends vscode.QuickPick<T> {
  sortByLabel: boolean;
}

/** Stable identity key for a SearchResult, used to preserve active item across qp.items replacements. */
function getItemKey(item: SearchResult): string | undefined {
  if (item.kind === vscode.QuickPickItemKind.Separator) return undefined;
  if (item.commandId) return `cmd:${item.commandId}`;
  if (item.uri) {
    const base = item.uri.toString();
    if (item.lineNumber !== undefined) return `${base}:${item.lineNumber}:${item.column ?? 0}`;
    return base;
  }
  return undefined;
}

const TAB_ORDER: SearchMode[] = [
  SearchMode.Everywhere,
  SearchMode.File,
  SearchMode.Folder,
  SearchMode.Text,
  SearchMode.Symbol,
  SearchMode.Command,
];

const PLACEHOLDERS: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Search everywhere...',
  [SearchMode.File]: 'Search files... (append :line:col to jump)',
  [SearchMode.Folder]: 'Search folders...',
  [SearchMode.Text]: 'Search text content...',
  [SearchMode.Symbol]: 'Search symbols... (functions, classes, variables)',
  [SearchMode.Command]: 'Search commands...',
};

const TAB_NAMES: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Everything',
  [SearchMode.File]: 'Files',
  [SearchMode.Folder]: 'Folders',
  [SearchMode.Text]: 'Text',
  [SearchMode.Symbol]: 'Symbols',
  [SearchMode.Command]: 'Commands',
};

const openToSideButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: 'Open to the Side',
};

const removeFromHistoryButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('close'),
  tooltip: 'Remove from History',
};

/** Prepend an indexing indicator to the title when the file index is still building. */
export function buildTitle(baseTitle: string, state: IndexState): string {
  return state === 'building' ? `Indexing... | ${baseTitle}` : baseTitle;
}

/** Parse :line:col suffix from query (only used on Files tab) */
export function parseLineCol(value: string): { query: string; gotoLine?: number; gotoColumn?: number } {
  const parts = value.split(':');
  if (parts.length >= 3) {
    const col = parseInt(parts[parts.length - 1], 10);
    const line = parseInt(parts[parts.length - 2], 10);
    if (!isNaN(line) && line >= 1 && !isNaN(col) && col >= 0) {
      return { query: parts.slice(0, -2).join(':'), gotoLine: line, gotoColumn: col };
    }
  }
  if (parts.length >= 2) {
    const line = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(line) && line >= 1) {
      return { query: parts.slice(0, -1).join(':'), gotoLine: line };
    }
  }
  return { query: value };
}

export class SearchModal implements vscode.Disposable {
  private providers: Map<SearchMode, SearchProvider>;
  private currentSearch: vscode.Disposable | undefined;

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

  // file:line:col goto target from current input
  private gotoLine?: number;
  private gotoColumn?: number;

  constructor(private indexManager: IndexManager, private history: SearchHistory) {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    this.excludeGitIgnored = config.get<boolean>('excludeGitIgnored', true);
    this.excludeSearchIgnored = config.get<boolean>('excludeSearchIgnored', true);

    const fileProvider = new FileProvider(indexManager.fileIndex, indexManager.gitIgnore);
    const textProvider = new TextProvider(indexManager.textSearch);
    const folderProvider = new FolderProvider(indexManager.fileIndex, indexManager.gitIgnore);
    const symbolProvider = new SymbolProvider(indexManager.gitIgnore);
    const commandProvider = new CommandProvider();
    const everywhereProvider = new EverywhereProvider(fileProvider, folderProvider, textProvider, symbolProvider, commandProvider);

    this.providers = new Map<SearchMode, SearchProvider>([
      [SearchMode.File, fileProvider],
      [SearchMode.Text, textProvider],
      [SearchMode.Folder, folderProvider],
      [SearchMode.Symbol, symbolProvider],
      [SearchMode.Command, commandProvider],
      [SearchMode.Everywhere, everywhereProvider],
    ]);
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

      if (!item.isFolder && !item.commandId) {
        filtered.push({ ...item, buttons: [openToSideButton] });
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
    const tabName = TAB_NAMES[this.activeTab];

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
      const count = this.fullResults.length;
      if (count === 0) {
        qp.title = buildTitle(tabName, state);
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
    const qp = vscode.window.createQuickPick<SearchResult>() as SortableQuickPick<SearchResult>;
    this.activeQuickPick = qp;
    this.activeTab = initialMode ?? SearchMode.Everywhere;
    qp.placeholder = PLACEHOLDERS[this.activeTab];
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.sortByLabel = false;
    qp.keepScrollPosition = true;

    this.rebuildButtons(qp);
    qp.title = buildTitle(TAB_NAMES[this.activeTab], this.indexManager.state);

    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const debounceMs = config.get<number>('debounceMs', 200);

    const getOptions = (): SearchOptions => ({
      excludeGitIgnored: this.excludeGitIgnored,
      excludeSearchIgnored: this.excludeSearchIgnored,
      caseSensitive: this.caseSensitive,
      useRegex: this.useRegex,
      fuzzySearch: this.fuzzySearch,
      matchWholeWord: this.matchWholeWord,
    });

    const buildEmptyQueryItems = (): SearchResult[] => {
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
          buttons: [openToSideButton, removeFromHistoryButton],
        })));
      }
      return items;
    };

    qp.items = buildEmptyQueryItems();

    const showNoResults = () => {
      const state = this.indexManager.state;
      if (state === 'building') {
        qp.items = [{
          label: '$(sync) Indexing workspace...',
          description: 'Results will appear as files are discovered',
          mode: this.activeTab,
          alwaysShow: true,
        }];
        qp.title = buildTitle(`${TAB_NAMES[this.activeTab]}: indexing...`, state);
        return;
      }
      const hints = ['Try a different search term'];
      if (this.excludeGitIgnored || this.excludeSearchIgnored) {
        const toggles: string[] = [];
        if (this.excludeGitIgnored) toggles.push('gitignore (Alt+G)');
        if (this.excludeSearchIgnored) toggles.push('search-ignore (Alt+S)');
        hints.push(`or toggle ${toggles.join(', ')} to include excluded files`);
      }
      qp.items = [{
        label: '$(search-stop) No results found',
        description: hints.join(', '),
        mode: this.activeTab,
        alwaysShow: true,
      }];
      qp.title = `${TAB_NAMES[this.activeTab]}: 0 results`;
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
      this.currentSearch?.dispose();
      this.fullResults = [];
      this.gotoLine = undefined;
      this.gotoColumn = undefined;
      clearBusyTimer();
      qp.items = buildEmptyQueryItems();
      qp.busy = false;
      qp.title = buildTitle(TAB_NAMES[this.activeTab], this.indexManager.state);
    };

    // Execute search via the current tab's provider
    const executeSearch = (query: string) => {
      this.currentSearch?.dispose();
      qp.busy = true;
      qp.title = buildTitle(`${TAB_NAMES[this.activeTab]}: Searching...`, this.indexManager.state);
      const provider = this.providers.get(this.activeTab);
      if (!provider) return;

      this.currentSearch = provider.search(query, getOptions(), handleResults);
    };

    // Text and Everywhere tabs debounce; File and Folder are instant
    const debouncedSearch = debounce(executeSearch, debounceMs);

    // Main search dispatcher
    const executeSearchForCurrentTab = () => {
      const rawValue = qp.value.trim();
      if (!rawValue) { clearSearch(); return; }

      // Absolute path → stat and show single result
      if (isAbsolutePath(rawValue)) {
        const { query, gotoLine, gotoColumn } = parseLineCol(rawValue);
        this.gotoLine = gotoLine;
        this.gotoColumn = gotoColumn;
        this.handleAbsolutePath(query, handleResults);
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
      } else if (this.activeTab === SearchMode.Text || this.activeTab === SearchMode.Symbol || this.activeTab === SearchMode.Command) {
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        debouncedSearch(rawValue);
      } else {
        // Folder (instant fzf)
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        executeSearch(rawValue);
      }
    };

    this.triggerSearch = executeSearchForCurrentTab;

    // Handle input changes
    const inputDisposable = qp.onDidChangeValue(() => {
      executeSearchForCurrentTab();
    });

    const acceptDisposable = this.setupAcceptHandler(qp);
    const staleDisposable = this.setupStaleHandler(qp);
    const itemButtonDisposable = this.setupItemButtonHandler(qp, buildEmptyQueryItems);
    const buttonDisposable = this.setupButtonHandler(qp, executeSearchForCurrentTab);

    // Cleanup on hide
    const hideDisposable = qp.onDidHide(() => {
      debouncedSearch.cancel();
      clearBusyTimer();

      vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', false);
      vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', false);
      vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', false);
      this.currentSearch?.dispose();
      this.activeQuickPick = undefined;
      this.triggerSearch = undefined;
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
    vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', this.activeTab === SearchMode.File || this.activeTab === SearchMode.Everywhere);
    vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', this.activeTab === SearchMode.Everywhere);
    qp.show();
  }

  // --- Absolute path handling ---

  private async handleAbsolutePath(
    path: string,
    onResults: (results: SearchResult[]) => void,
  ): Promise<void> {
    const qp = this.activeQuickPick;
    if (!qp) return;
    qp.busy = true;

    const uri = vscode.Uri.file(path);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const isDir = (stat.type & vscode.FileType.Directory) !== 0;
      const name = path.split(/[/\\]/).filter(Boolean).pop() || path;

      onResults([{
        label: name,
        description: path,
        mode: isDir ? SearchMode.Folder : SearchMode.File,
        uri,
        iconPath: isDir ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File,
        alwaysShow: true,
        isFolder: isDir,
        belongsToSection: isDir ? ResultSection.Folders : ResultSection.Files,
      }]);
    } catch {
      onResults([{
        label: '$(warning) Path not found',
        description: path,
        mode: this.activeTab,
        alwaysShow: true,
      }]);
    }
    qp.busy = false;
  }

  // --- Tab switching ---

  private switchTab(mode: SearchMode): void {
    if (this.activeTab === mode) return;
    this.activeTab = mode;
    vscode.commands.executeCommand('setContext', 'searchPlusPlusFileTab', mode === SearchMode.File || mode === SearchMode.Everywhere);
    vscode.commands.executeCommand('setContext', 'searchPlusPlusEverythingTab', mode === SearchMode.Everywhere);
    const qp = this.activeQuickPick;
    if (!qp) return;
    qp.placeholder = PLACEHOLDERS[mode];
    this.rebuildButtons(qp);
    if (this.triggerSearch) {
      this.triggerSearch();
    }
  }

  nextTab(): void {
    const idx = TAB_ORDER.indexOf(this.activeTab);
    this.switchTab(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
  }

  prevTab(): void {
    const idx = TAB_ORDER.indexOf(this.activeTab);
    this.switchTab(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
  }

  // --- Buttons ---

  private buttonActions = new Map<vscode.QuickInputButton, () => void>();
  private optionButtons = new Set<vscode.QuickInputButton>();

  private rebuildButtons(qp: vscode.QuickPick<SearchResult>): void {
    // Tab buttons (title bar)
    const everywhereBtn = this.tabButton('search', TAB_NAMES[SearchMode.Everywhere], SearchMode.Everywhere);
    const fileBtn = this.tabButton('file', TAB_NAMES[SearchMode.File], SearchMode.File);
    const folderBtn = this.tabButton('folder', TAB_NAMES[SearchMode.Folder], SearchMode.Folder);
    const textBtn = this.tabButton('book', TAB_NAMES[SearchMode.Text], SearchMode.Text);
    const symbolBtn = this.tabButton('symbol-method', TAB_NAMES[SearchMode.Symbol], SearchMode.Symbol);
    const commandBtn = this.tabButton('terminal', TAB_NAMES[SearchMode.Command], SearchMode.Command);

    // Option toggle buttons (inline)
    const gitIgnoreBtn = this.toggle('source-control', 'Exclude Git Ignored (Alt+G)', this.excludeGitIgnored,
      vscode.QuickInputButtonLocation.Inline);
    const searchIgnoreBtn = this.toggle('eye-closed', 'Exclude Search Ignored (Alt+S)', this.excludeSearchIgnored,
      vscode.QuickInputButtonLocation.Inline);
    const caseSensitiveBtn = this.toggle('case-sensitive', 'Case Sensitive (Alt+C)', this.caseSensitive,
      vscode.QuickInputButtonLocation.Inline);
    const regexBtn = this.toggle('regex', 'Regex (Alt+R)', this.useRegex,
      vscode.QuickInputButtonLocation.Inline);
    const wholeWordBtn = this.toggle('whole-word', 'Match Whole Word (Alt+W)', this.matchWholeWord,
      vscode.QuickInputButtonLocation.Inline);
    const fuzzyBtn = this.toggle('sparkle', 'Fuzzy Search (Alt+F)', this.fuzzySearch,
      vscode.QuickInputButtonLocation.Inline);

    qp.buttons = [
      everywhereBtn, fileBtn, folderBtn, textBtn, symbolBtn, commandBtn,
      gitIgnoreBtn, searchIgnoreBtn, caseSensitiveBtn, regexBtn, wholeWordBtn, fuzzyBtn,
    ];

    this.buttonActions = new Map<vscode.QuickInputButton, () => void>([
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
      location: vscode.QuickInputButtonLocation.Title,
      toggle: { checked: this.activeTab === mode },
    };
  }

  private toggle(icon: string, tooltip: string, checked: boolean, location: vscode.QuickInputButtonLocation): vscode.QuickInputButton {
    return { iconPath: new vscode.ThemeIcon(icon), tooltip, location, toggle: { checked } };
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
    if (!selected?.uri || selected.isFolder) return;
    const relativePath = selected.description ?? vscode.workspace.asRelativePath(selected.uri);
    qp.value = relativePath + ':';
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
      const selected = qp.selectedItems[0];
      if (!selected) return;

      if (selected.commandId) {
        qp.hide();
        vscode.commands.executeCommand(selected.commandId).then(undefined, () => {});
        return;
      }

      // "More results" truncation indicator -> switch to that tab
      if (!selected.uri && selected.mode !== this.activeTab) {
        this.switchTab(selected.mode);
        return;
      }

      if (!selected.uri) return;
      const uri = selected.uri;

      qp.hide();

      if (selected.isFolder) {
        vscode.commands.executeCommand('workbench.view.explorer').then(
          () => { vscode.commands.executeCommand('revealInExplorer', uri); },
          () => {},
        );
        return;
      }

      // Determine line/col: prefer result's own position (text matches),
      // fall back to file:line:col goto target
      const line = selected.lineNumber ?? (this.gotoLine !== undefined ? this.gotoLine - 1 : undefined);
      const col = selected.column ?? (this.gotoColumn !== undefined ? this.gotoColumn - 1 : 0);

      this.history.addOpened(uri, line, col);

      vscode.commands.executeCommand('vscode.open', uri).then(
        () => {
          if (line !== undefined && !uri.fsPath.endsWith('.ipynb')) {
            const pos = new vscode.Position(line, col);
            vscode.window.showTextDocument(uri, {
              selection: new vscode.Selection(pos, pos),
            });
          }
        },
        () => {},
      );
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
      if (!item.uri) return;
      const uri = item.uri;

      if (e.button === removeFromHistoryButton) {
        this.history.removeEntry(uri.fsPath, item.lineNumber);
        qp.items = buildEmptyQueryItems();
        return;
      }

      // Open to the side
      qp.hide();

      vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside).then(
        () => {
          if (item.lineNumber !== undefined && !uri.fsPath.endsWith('.ipynb')) {
            const pos = new vscode.Position(item.lineNumber, item.column ?? 0);
            vscode.window.showTextDocument(uri, {
              viewColumn: vscode.ViewColumn.Beside,
              selection: new vscode.Selection(pos, pos),
            });
          }
        },
        () => {},
      );
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

  dispose(): void {
    this.currentSearch?.dispose();
    this.activeQuickPick?.dispose();
  }
}
