import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileProvider } from './fileProvider';
import { FolderProvider } from './folderProvider';
import { TextProvider } from './textProvider';
import { debounce } from '../utils';

const FOLDER_LIMIT = 10;
const FILE_LIMIT = 20;
const TEXT_LIMIT = 50;

export class EverywhereProvider implements SearchProvider {
  readonly mode = SearchMode.Everywhere;

  constructor(
    private fileProvider: FileProvider,
    private folderProvider: FolderProvider,
    private textProvider: TextProvider,
  ) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const debounceMs = config.get<number>('debounceMs', 200);
    let folderResults: SearchResult[] = [];
    let fileResults: SearchResult[] = [];
    let textResults: SearchResult[] = [];
    const disposables: vscode.Disposable[] = [];
    let textSearchDisposable: vscode.Disposable | undefined;

    const buildMergedResults = () => {
      const folderSlice = folderResults.slice(0, FOLDER_LIMIT);
      const fileSlice = fileResults.slice(0, FILE_LIMIT);
      const textSlice = textResults.slice(0, TEXT_LIMIT).map((r) => ({
        ...r,
        belongsToSection: ResultSection.Text,
      }));

      const merged: SearchResult[] = [...fileSlice, ...folderSlice, ...textSlice];

      // Truncation indicators
      if (folderResults.length > FOLDER_LIMIT) {
        merged.push({
          label: `$(info) ${folderResults.length - FOLDER_LIMIT} more folder results`,
          description: 'Switch to Folders tab to see all',
          mode: SearchMode.Folder,
          belongsToSection: ResultSection.Folders,
          alwaysShow: true,
        });
      }
      if (fileResults.length > FILE_LIMIT) {
        merged.push({
          label: `$(info) ${fileResults.length - FILE_LIMIT} more file results`,
          description: 'Switch to Files tab to see all',
          mode: SearchMode.File,
          belongsToSection: ResultSection.Files,
          alwaysShow: true,
        });
      }
      if (textResults.length > TEXT_LIMIT) {
        merged.push({
          label: `$(info) ${textResults.length - TEXT_LIMIT} more text results`,
          description: 'Switch to Text tab to see all',
          mode: SearchMode.Text,
          belongsToSection: ResultSection.Text,
          alwaysShow: true,
        });
      }

      onResults(merged);
    };

    // Folder + file search runs instantly
    disposables.push(
      this.folderProvider.search(query, options, (results) => {
        folderResults = results;
        buildMergedResults();
      }),
    );
    disposables.push(
      this.fileProvider.search(query, options, (results) => {
        fileResults = results;
        buildMergedResults();
      }),
    );

    // Text search is debounced
    const executeTextSearch = () => {
      textSearchDisposable?.dispose();
      textSearchDisposable = this.textProvider.search(query, options, (results) => {
        textResults = results;
        buildMergedResults();
      });
    };

    const debouncedText = debounce(executeTextSearch, debounceMs);
    debouncedText();

    return {
      dispose: () => {
        debouncedText.cancel();
        textSearchDisposable?.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  }
}
