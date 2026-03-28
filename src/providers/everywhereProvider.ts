import * as vscode from 'vscode';
import { ResultSection, SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { FileProvider } from './fileProvider';
import { FolderProvider } from './folderProvider';
import { TextProvider } from './textProvider';
import { CommandProvider } from './commandProvider';
import { debounce } from '../utils';

const FOLDER_LIMIT = 10;
const FILE_LIMIT = 20;
const TEXT_LIMIT = 50;
const COMMAND_LIMIT = 5;

export class EverywhereProvider implements SearchProvider {
  readonly mode = SearchMode.Everywhere;

  constructor(
    private fileProvider: FileProvider,
    private folderProvider: FolderProvider,
    private textProvider: TextProvider,
    private commandProvider: CommandProvider,
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
    let commandResults: SearchResult[] = [];
    let textDelivered = false;
    const disposables: vscode.Disposable[] = [];
    let textSearchDisposable: vscode.Disposable | undefined;
    let commandSearchDisposable: vscode.Disposable | undefined;

    const buildMergedResults = () => {
      const fileSlice = fileResults.slice(0, FILE_LIMIT);
      const folderSlice = folderResults.slice(0, FOLDER_LIMIT);
      const textSlice = textResults.slice(0, TEXT_LIMIT).map((r) => ({
        ...r,
        belongsToSection: ResultSection.Text,
      }));
      const commandSlice = commandResults.slice(0, COMMAND_LIMIT).map((r) => ({
        ...r,
        belongsToSection: ResultSection.Commands,
      }));

      // Build merged results with truncation indicators inline after each section
      const merged: SearchResult[] = [];

      merged.push(...fileSlice);
      if (fileResults.length > FILE_LIMIT) {
        merged.push({
          label: `$(info) ${fileResults.length - FILE_LIMIT} more file results`,
          description: 'Switch to Files tab to see all',
          mode: SearchMode.File,
          belongsToSection: ResultSection.Files,
          alwaysShow: true,
        });
      }

      merged.push(...folderSlice);
      if (folderResults.length > FOLDER_LIMIT) {
        merged.push({
          label: `$(info) ${folderResults.length - FOLDER_LIMIT} more folder results`,
          description: 'Switch to Folders tab to see all',
          mode: SearchMode.Folder,
          belongsToSection: ResultSection.Folders,
          alwaysShow: true,
        });
      }

      merged.push(...textSlice);
      if (textResults.length > TEXT_LIMIT) {
        merged.push({
          label: `$(info) ${textResults.length - TEXT_LIMIT} more text results`,
          description: 'Switch to Text tab to see all',
          mode: SearchMode.Text,
          belongsToSection: ResultSection.Text,
          alwaysShow: true,
        });
      }

      merged.push(...commandSlice);
      if (commandResults.length > COMMAND_LIMIT) {
        merged.push({
          label: `$(info) ${commandResults.length - COMMAND_LIMIT} more command results`,
          description: 'Switch to Commands tab to see all',
          mode: SearchMode.Command,
          belongsToSection: ResultSection.Commands,
          alwaysShow: true,
        });
      }

      // Only emit results when we have something to show, or text search
      // has delivered at least once (so empty results are genuine).
      if (merged.length > 0 || textDelivered) {
        onResults(merged);
      }
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

    // Text search runs immediately (cancellation is handled by dispose)
    textSearchDisposable = this.textProvider.search(query, options, (results) => {
      textResults = results;
      textDelivered = true;
      buildMergedResults();
    });

    // Command search is debounced (async index build on first call)
    const executeCommandSearch = () => {
      commandSearchDisposable?.dispose();
      commandSearchDisposable = this.commandProvider.search(query, options, (results) => {
        commandResults = results;
        buildMergedResults();
      });
    };

    const debouncedCommand = debounce(executeCommandSearch, debounceMs);
    debouncedCommand();

    return {
      dispose: () => {
        debouncedCommand.cancel();
        textSearchDisposable?.dispose();
        commandSearchDisposable?.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  }
}
