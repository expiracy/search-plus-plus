import * as vscode from 'vscode';
import { ResultSection, SearchMode, DEFAULT_EVERYWHERE_LIMIT, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileProvider } from './fileProvider';
import { FolderProvider } from './folderProvider';
import { TextProvider } from './textProvider';
import { CommandProvider } from './commandProvider';
import { SymbolProvider } from './symbolProvider';
import { debounce, getEnabledSections } from '../utils';

export class EverywhereProvider implements SearchProvider {
  readonly mode = SearchMode.Everywhere;

  constructor(
    private fileProvider: FileProvider,
    private folderProvider: FolderProvider,
    private textProvider: TextProvider,
    private symbolProvider: SymbolProvider,
    private commandProvider: CommandProvider,
  ) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const debounceMs = config.get<number>('debounceMs', 200);
    const sections = getEnabledSections(config.get('everywhere.sections'));
    const limit = Math.max(1, Math.floor(config.get<number>('everywhere.resultLimit', DEFAULT_EVERYWHERE_LIMIT)));
    const enabledSections = new Set(sections);

    const resultStore: Record<ResultSection, SearchResult[]> = {
      [ResultSection.Files]: [],
      [ResultSection.Folders]: [],
      [ResultSection.Text]: [],
      [ResultSection.Symbols]: [],
      [ResultSection.Commands]: [],
    };

    let textDelivered = !enabledSections.has(ResultSection.Text);
    const disposables: vscode.Disposable[] = [];
    let textSearchDisposable: vscode.Disposable | undefined;
    let symbolSearchDisposable: vscode.Disposable | undefined;
    let commandSearchDisposable: vscode.Disposable | undefined;

    const sectionMeta: Record<ResultSection, { searchMode: SearchMode; tabLabel: string }> = {
      [ResultSection.Files]: { searchMode: SearchMode.File, tabLabel: 'Files' },
      [ResultSection.Folders]: { searchMode: SearchMode.Folder, tabLabel: 'Folders' },
      [ResultSection.Text]: { searchMode: SearchMode.Text, tabLabel: 'Text' },
      [ResultSection.Symbols]: { searchMode: SearchMode.Symbol, tabLabel: 'Symbols' },
      [ResultSection.Commands]: { searchMode: SearchMode.Command, tabLabel: 'Commands' },
    };

    let mergeScheduled = false;
    let disposed = false;

    const scheduleMerge = () => {
      if (mergeScheduled || disposed) return;
      mergeScheduled = true;
      queueMicrotask(() => {
        mergeScheduled = false;
        if (!disposed) buildMergedResults();
      });
    };

    const buildMergedResults = () => {
      const merged: SearchResult[] = [];

      for (const section of sections) {
        const results = resultStore[section];
        const { searchMode, tabLabel } = sectionMeta[section];
        const slice = results.slice(0, limit).map(r => ({
          ...r,
          belongsToSection: section,
        }));

        merged.push(...slice);

        if (results.length > limit) {
          merged.push({
            label: `$(ellipsis) see ${results.length - limit} more ${tabLabel.toLowerCase()} results...`,
            description: `Switch to ${tabLabel} tab to see all`,
            mode: searchMode,
            belongsToSection: section,
            moreCount: results.length - limit,
            alwaysShow: true,
          });
        }
      }

      if (merged.length > 0 || textDelivered) {
        onResults(merged);
      }
    };

    // File search (instant, index-based)
    if (enabledSections.has(ResultSection.Files)) {
      disposables.push(
        this.fileProvider.search(query, options, (results) => {
          resultStore[ResultSection.Files] = results;
          scheduleMerge();
        }),
      );
    }

    // Folder search (instant, index-based)
    if (enabledSections.has(ResultSection.Folders)) {
      disposables.push(
        this.folderProvider.search(query, options, (results) => {
          resultStore[ResultSection.Folders] = results;
          scheduleMerge();
        }),
      );
    }

    // Text search (async ripgrep) -- throttled to reduce UI churn on Everything tab
    if (enabledSections.has(ResultSection.Text)) {
      let lastTextMerge = 0;
      let textMergeTimer: ReturnType<typeof setTimeout> | undefined;
      const TEXT_THROTTLE_MS = 300;

      const scheduleTextMerge = () => {
        if (textMergeTimer || disposed) return;
        const elapsed = Date.now() - lastTextMerge;
        if (elapsed >= TEXT_THROTTLE_MS) {
          lastTextMerge = Date.now();
          buildMergedResults();
        } else {
          textMergeTimer = setTimeout(() => {
            textMergeTimer = undefined;
            if (disposed) return;
            lastTextMerge = Date.now();
            buildMergedResults();
          }, TEXT_THROTTLE_MS - elapsed);
        }
      };

      textSearchDisposable = this.textProvider.search(query, options, (results) => {
        resultStore[ResultSection.Text] = results;
        textDelivered = true;
        scheduleTextMerge();
      });

      disposables.push({
        dispose: () => {
          if (textMergeTimer) clearTimeout(textMergeTimer);
        },
      });
    }

    // Symbol search (debounced, async workspace symbol provider)
    if (enabledSections.has(ResultSection.Symbols)) {
      const executeSymbolSearch = () => {
        symbolSearchDisposable?.dispose();
        symbolSearchDisposable = this.symbolProvider.search(query, options, (results) => {
          resultStore[ResultSection.Symbols] = results;
          scheduleMerge();
        });
      };

      const debouncedSymbol = debounce(executeSymbolSearch, debounceMs);
      debouncedSymbol();

      disposables.push({ dispose: () => debouncedSymbol.cancel() });
    }

    // Command search (debounced, async index build)
    if (enabledSections.has(ResultSection.Commands)) {
      const executeCommandSearch = () => {
        commandSearchDisposable?.dispose();
        commandSearchDisposable = this.commandProvider.search(query, options, (results) => {
          resultStore[ResultSection.Commands] = results;
          scheduleMerge();
        });
      };

      const debouncedCommand = debounce(executeCommandSearch, debounceMs);
      debouncedCommand();

      disposables.push({ dispose: () => debouncedCommand.cancel() });
    }

    return {
      dispose: () => {
        disposed = true;
        textSearchDisposable?.dispose();
        symbolSearchDisposable?.dispose();
        commandSearchDisposable?.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  }
}
