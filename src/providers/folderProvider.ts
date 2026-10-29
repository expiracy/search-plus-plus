import * as vscode from 'vscode';
import { Fzf } from 'fzf';
import { SearchMode, getMaxResults, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { extractFolders } from './folderExtractor';
import { FileIndex, type FileEntry } from '../index/fileIndex';
import { containsQuery, hasCaseSensitiveSubsequence } from '../utils';

export class FolderProvider implements SearchProvider {
  readonly mode = SearchMode.Folder;

  // Keyed by the index's entry array, which is replaced whenever the snapshot changes.
  private readonly folderCache = new WeakMap<readonly FileEntry[], { folders: SearchResult[]; fzf?: Fzf<SearchResult[]> }>();

  constructor(private fileIndex: FileIndex) {}

  search(query: string, options: SearchOptions, onResults: (results: SearchResult[]) => void, onError?: (error: unknown) => void): vscode.Disposable {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Deduplicate all eligible folders before matching and applying the UI limit.
      const entries = this.fileIndex.getEntries(options.excludeGitIgnored, options.excludeSearchIgnored);
      let cached = this.folderCache.get(entries);
      if (!cached) {
        cached = { folders: extractFolders(entries, '', SearchMode.Folder) };
        this.folderCache.set(entries, cached);
      }
      const folders = cached.folders;
      let results: SearchResult[];
      if (options.fuzzySearch && !options.matchWholeWord) {
        cached.fzf ??= new Fzf(folders, { selector: item => item.description ?? '', casing: 'case-insensitive' });
        results = cached.fzf.find(query).map(match => match.item).filter(item =>
          !options.caseSensitive || hasCaseSensitiveSubsequence(item.description ?? '', query),
        );
      } else {
        results = folders.filter(item => containsQuery(item.description ?? '', query, options));
      }
      onResults(results.slice(0, getMaxResults()));
    };
    if (this.fileIndex.isReady) run();
    else void this.fileIndex.ensureReady().then(run, error => {
      if (!cancelled) {
        if (onError) onError(error);
        else onResults([]);
      }
    });
    return { dispose: () => { cancelled = true; } };
  }
}
