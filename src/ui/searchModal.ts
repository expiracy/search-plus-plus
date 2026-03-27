import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from '../providers/types';
import { FileProvider } from '../providers/fileProvider';
import { TextProvider } from '../providers/textProvider';
import { FolderProvider } from '../providers/folderProvider';
import { SymbolProvider } from '../providers/symbolProvider';
import { EverywhereProvider } from '../providers/everywhereProvider';
import type { IndexManager } from '../index/indexManager';
import type { SearchHistory } from '../history';
import { debounce, type Debounced } from '../utils';

const TAB_ORDER: SearchMode[] = [
  SearchMode.Everywhere,
  SearchMode.File,
  SearchMode.Folder,
  SearchMode.Text,
  SearchMode.Symbol,
];

const PLACEHOLDERS: Record<SearchMode, string> = {
  [SearchMode.Everywhere]: 'Search everywhere...',
  [SearchMode.File]: 'Search files... (append :line:col to jump)',
  [SearchMode.Folder]: 'Search folders...',
  [SearchMode.Text]: 'Search text content...',
  [SearchMode.Symbol]: 'Search symbols... (functions, classes, variables)',
};

interface SavedEditorState {
  uri: vscode.Uri;
  selection: vscode.Selection;
  visibleRanges: readonly vscode.Range[];
  viewColumn: vscode.ViewColumn | undefined;
}

const openToSideButton: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: 'Open to the Side',
};

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
  private caseSensitive = false;
  private useRegex = false;

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

    const fileProvider = new FileProvider(indexManager.fileIndex);
    const textProvider = new TextProvider(indexManager.textSearch);
    const folderProvider = new FolderProvider(indexManager.fileIndex);
    const symbolProvider = new SymbolProvider(indexManager.gitIgnore);
    const everywhereProvider = new EverywhereProvider(fileProvider, textProvider);

    this.providers = new Map<SearchMode, SearchProvider>([
      [SearchMode.File, fileProvider],
      [SearchMode.Text, textProvider],
      [SearchMode.Folder, folderProvider],
      [SearchMode.Symbol, symbolProvider],
      [SearchMode.Everywhere, everywhereProvider],
    ]);
  }

  private filterAndDisplay(): void {
    const qp = this.activeQuickPick;
    if (!qp) return;

    // Count items per section
    const counts: Record<ResultSection, number> = {
      [ResultSection.Folders]: 0,
      [ResultSection.Files]: 0,
      [ResultSection.Text]: 0,
    };
    for (const item of this.fullResults) {
      if (item.belongsToSection) counts[item.belongsToSection]++;
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
          `Text Matches (${counts[ResultSection.Text]})`;
        filtered.push({
          label: sectionLabel,
          kind: vscode.QuickPickItemKind.Separator,
          mode: SearchMode.Everywhere,
          alwaysShow: true,
        });
      }

      if (!item.isFolder) {
        filtered.push({ ...item, buttons: [openToSideButton] });
      } else {
        filtered.push(item);
      }
    }

    qp.items = filtered;
    this.updateTitle(qp, counts);
  }

  private updateTitle(
    qp: vscode.QuickPick<SearchResult>,
    counts: Record<ResultSection, number>,
  ): void {
    const total = counts[ResultSection.Folders] + counts[ResultSection.Files] + counts[ResultSection.Text];
    if (total === 0) {
      qp.title = 'search++';
      return;
    }

    if (this.activeTab === SearchMode.Everywhere) {
      const parts: string[] = [];
      const fileCount = counts[ResultSection.Folders] + counts[ResultSection.Files];
      if (fileCount > 0) parts.push(`${fileCount} files`);
      if (counts[ResultSection.Text] > 0) parts.push(`${counts[ResultSection.Text]} text`);
      qp.title = parts.join(', ');
    } else {
      qp.title = `${total} results`;
    }
  }

  show(initialMode?: SearchMode): void {
    // Capture original editor state for restoration on cancel
    const savedState: SavedEditorState | undefined = (() => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return undefined;
      return {
        uri: editor.document.uri,
        selection: editor.selection,
        visibleRanges: editor.visibleRanges,
        viewColumn: editor.viewColumn,
      };
    })();
    let accepted = false;

    const qp = vscode.window.createQuickPick<SearchResult>();
    this.activeQuickPick = qp;
    this.activeTab = initialMode ?? SearchMode.Everywhere;
    qp.placeholder = PLACEHOLDERS[this.activeTab];
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.sortByLabel = false;
    qp.keepScrollPosition = true;

    this.rebuildButtons(qp);
    qp.title = 'search++';

    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const debounceMs = config.get<number>('debounceMs', 200);

    const getOptions = (): SearchOptions => ({
      excludeGitIgnored: this.excludeGitIgnored,
      caseSensitive: this.caseSensitive,
      useRegex: this.useRegex,
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
        items.push(...recentItems);
      }
      return items;
    };

    qp.items = buildEmptyQueryItems();

    const showNoResults = () => {
      qp.items = [{
        label: '$(info) No results found',
        kind: vscode.QuickPickItemKind.Separator,
        mode: SearchMode.Everywhere,
        alwaysShow: true,
      }];
      qp.title = '0 results';
    };

    const handleResults = (results: SearchResult[]) => {
      this.fullResults = results;
      if (results.length === 0) {
        showNoResults();
      } else {
        this.filterAndDisplay();
      }
      qp.busy = false;
    };

    const clearSearch = () => {
      this.currentSearch?.dispose();
      this.fullResults = [];
      this.gotoLine = undefined;
      this.gotoColumn = undefined;
      qp.items = buildEmptyQueryItems();
      qp.busy = false;
      qp.title = 'search++';
    };

    // Execute search via the current tab's provider
    const executeSearch = (query: string) => {
      this.currentSearch?.dispose();
      qp.busy = true;
      const provider = this.providers.get(this.activeTab);
      if (!provider) return;

      this.currentSearch = provider.search(query, getOptions(), handleResults);
    };

    // Text and Everywhere tabs debounce; File and Folder are instant
    const debouncedSearch: Debounced<(query: string) => void> = debounce(executeSearch, debounceMs);

    // Main search dispatcher
    const executeSearchForCurrentTab = () => {
      const rawValue = qp.value.trim();
      if (!rawValue) { clearSearch(); return; }

      // Parse line:col on Files tab
      if (this.activeTab === SearchMode.File) {
        const { query, gotoLine, gotoColumn } = parseLineCol(rawValue);
        this.gotoLine = gotoLine;
        this.gotoColumn = gotoColumn;
        if (!query.trim()) { clearSearch(); return; }
        executeSearch(query);
      } else if (this.activeTab === SearchMode.Text || this.activeTab === SearchMode.Symbol) {
        this.gotoLine = undefined;
        this.gotoColumn = undefined;
        debouncedSearch(rawValue);
      } else {
        // Everywhere (has internal debounce for text) and Folder (instant fzf)
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

    // Handle selection
    const acceptDisposable = qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      if (!selected) return;

      // "More results" truncation indicator → switch to that tab
      if (!selected.uri && selected.mode !== this.activeTab) {
        this.switchTab(selected.mode);
        return;
      }

      if (!selected.uri) return;

      accepted = true;
      qp.hide();

      if (selected.isFolder) {
        vscode.commands.executeCommand('revealInExplorer', selected.uri);
        return;
      }

      // Determine line/col: prefer result's own position (text matches),
      // fall back to file:line:col goto target
      const line = selected.lineNumber ?? (this.gotoLine !== undefined ? this.gotoLine - 1 : undefined);
      const col = selected.column ?? (this.gotoColumn !== undefined ? this.gotoColumn - 1 : 0);

      // Record in history
      this.history.addOpened(selected.uri, line, col);

      if (line !== undefined) {
        const pos = new vscode.Position(line, col);
        vscode.window.showTextDocument(selected.uri, {
          selection: new vscode.Selection(pos, pos),
        });
      } else {
        vscode.window.showTextDocument(selected.uri);
      }
    });

    // Preview file as user navigates results
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    const activeDisposable = qp.onDidChangeActive((items) => {
      if (previewTimer) clearTimeout(previewTimer);
      const item = items[0];
      if (!item?.uri || item.isFolder) return;

      previewTimer = setTimeout(() => {
        const opts: vscode.TextDocumentShowOptions = { preserveFocus: true, preview: true };
        if (item.lineNumber !== undefined) {
          const pos = new vscode.Position(item.lineNumber, item.column ?? 0);
          opts.selection = new vscode.Selection(pos, pos);
        }
        vscode.window.showTextDocument(item.uri!, opts);
      }, 75);
    });

    // Stale index notification while modal is open
    const staleDisposable = this.indexManager.onDidChangeState((state) => {
      if (state === 'stale') {
        qp.title = '$(warning) Index may be stale';
      } else if (state === 'building') {
        qp.title = '$(sync~spin) Reindexing...';
      } else if (state === 'ready') {
        const counts: Record<ResultSection, number> = {
          [ResultSection.Folders]: 0,
          [ResultSection.Files]: 0,
          [ResultSection.Text]: 0,
        };
        for (const item of this.fullResults) {
          if (item.belongsToSection) counts[item.belongsToSection]++;
        }
        this.updateTitle(qp, counts);
      }
    });

    // Handle open-to-side item button
    const itemButtonDisposable = qp.onDidTriggerItemButton((e) => {
      const item = e.item;
      if (!item.uri) return;

      accepted = true;
      qp.hide();

      const opts: vscode.TextDocumentShowOptions = {
        viewColumn: vscode.ViewColumn.Beside,
      };
      if (item.lineNumber !== undefined) {
        const pos = new vscode.Position(item.lineNumber, item.column ?? 0);
        opts.selection = new vscode.Selection(pos, pos);
      }
      vscode.window.showTextDocument(item.uri, opts);
    });

    // Handle button clicks (tabs + search options)
    const buttonDisposable = qp.onDidTriggerButton((button) => {
      const index = qp.buttons.indexOf(button);
      const action = this.buttonActions[index];
      if (!action) return;
      action();
      this.rebuildButtons(qp);
      executeSearchForCurrentTab();
    });

    // Cleanup on hide
    const hideDisposable = qp.onDidHide(() => {
      if (previewTimer) clearTimeout(previewTimer);
      debouncedSearch.cancel();

      // Restore original editor position on cancel
      if (!accepted && savedState) {
        vscode.window.showTextDocument(savedState.uri, {
          preview: false,
          preserveFocus: false,
          selection: savedState.selection,
          viewColumn: savedState.viewColumn,
        }).then((editor) => {
          if (savedState.visibleRanges.length > 0) {
            editor.revealRange(
              savedState.visibleRanges[0],
              vscode.TextEditorRevealType.AtTop,
            );
          }
        });
      }

      vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', false);
      this.currentSearch?.dispose();
      this.activeQuickPick = undefined;
      this.triggerSearch = undefined;
      this.gotoLine = undefined;
      this.gotoColumn = undefined;
      inputDisposable.dispose();
      acceptDisposable.dispose();
      activeDisposable.dispose();
      staleDisposable.dispose();
      itemButtonDisposable.dispose();
      buttonDisposable.dispose();
      hideDisposable.dispose();
      qp.dispose();
    });

    vscode.commands.executeCommand('setContext', 'searchPlusPlusModalOpen', true);
    qp.show();
  }

  // --- Tab switching ---

  private switchTab(mode: SearchMode): void {
    if (this.activeTab === mode) return;
    this.activeTab = mode;
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

  private buttonActions: Record<number, (() => void) | undefined> = {};

  private rebuildButtons(qp: vscode.QuickPick<SearchResult>): void {
    const buttons: vscode.QuickInputButton[] = [
      // Tabs (title bar)
      this.tabButton('search', 'All', SearchMode.Everywhere),
      this.tabButton('file', 'Files', SearchMode.File),
      this.tabButton('folder', 'Folders', SearchMode.Folder),
      this.tabButton('book', 'Text', SearchMode.Text),
      this.tabButton('symbol-method', 'Symbols', SearchMode.Symbol),
      // Search options (inline)
      this.toggle('source-control', 'Only Git Trackable (Alt+G)', this.excludeGitIgnored,
        vscode.QuickInputButtonLocation.Inline),
      this.toggle('case-sensitive', 'Case Sensitive (Alt+C)', this.caseSensitive,
        vscode.QuickInputButtonLocation.Inline),
      this.toggle('regex', 'Regex (Alt+R)', this.useRegex,
        vscode.QuickInputButtonLocation.Inline),
    ];

    this.buttonActions = {
      0: () => { this.switchTab(SearchMode.Everywhere); },
      1: () => { this.switchTab(SearchMode.File); },
      2: () => { this.switchTab(SearchMode.Folder); },
      3: () => { this.switchTab(SearchMode.Text); },
      4: () => { this.switchTab(SearchMode.Symbol); },
      5: () => { this.excludeGitIgnored = !this.excludeGitIgnored; },
      6: () => { this.caseSensitive = !this.caseSensitive; },
      7: () => { this.useRegex = !this.useRegex; },
    };

    qp.buttons = buttons;
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

  private applyOptionToggle(): void {
    const qp = this.activeQuickPick;
    if (!qp) return;
    this.rebuildButtons(qp);
    if (this.triggerSearch) {
      this.triggerSearch();
    }
  }

  dispose(): void {
    this.currentSearch?.dispose();
    this.activeQuickPick?.dispose();
  }
}
