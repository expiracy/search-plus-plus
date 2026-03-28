import * as vscode from 'vscode';
import { Fzf, type FzfResultItem } from 'fzf';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';

interface CommandEntry {
  id: string;
  title: string;
  category?: string;
  searchText: string;
}

export class CommandProvider implements SearchProvider {
  readonly mode = SearchMode.Command;

  private entries: CommandEntry[] = [];
  private fzfInstance: Fzf<CommandEntry> | null = null;
  private dirty = true;
  private extensionChangeDisposable: vscode.Disposable;

  constructor() {
    this.extensionChangeDisposable = vscode.extensions.onDidChange(() => {
      this.dirty = true;
      this.fzfInstance = null;
    });
  }

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    let cancelled = false;

    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const maxResults = config.get<number>('maxResults', 200);

    this.ensureIndex().then(() => {
      if (cancelled) return;
      const results = this.performSearch(query, options, maxResults);
      if (!cancelled) onResults(results);
    });

    return { dispose: () => { cancelled = true; } };
  }

  private async ensureIndex(): Promise<void> {
    if (!this.dirty && this.entries.length > 0) return;

    // Build title/category map from extension metadata
    const metadata = new Map<string, { title: string; category?: string }>();
    for (const ext of vscode.extensions.all) {
      const commands = ext.packageJSON?.contributes?.commands;
      if (!Array.isArray(commands)) continue;
      for (const cmd of commands) {
        if (cmd.command && cmd.title) {
          metadata.set(cmd.command, { title: cmd.title, category: cmd.category });
        }
      }
    }

    // Get all non-internal commands
    const commandIds = await vscode.commands.getCommands(true);

    this.entries = commandIds.map((id) => {
      const meta = metadata.get(id);
      const title = meta?.title ?? id;
      const category = meta?.category;
      const searchText = category ? `${category}: ${title} ${id}` : `${title} ${id}`;
      return { id, title, category, searchText };
    });

    // Sort: commands with titles first, then alphabetically
    this.entries.sort((a, b) => {
      const aHasTitle = a.title !== a.id;
      const bHasTitle = b.title !== b.id;
      if (aHasTitle !== bHasTitle) return aHasTitle ? -1 : 1;
      return a.searchText.localeCompare(b.searchText);
    });

    this.fzfInstance = null;
    this.dirty = false;
  }

  private performSearch(query: string, options: SearchOptions, maxResults: number): SearchResult[] {
    if (options.fuzzySearch) {
      return this.fuzzySearch(query, maxResults);
    }
    return this.substringSearch(query, options, maxResults);
  }

  private fuzzySearch(query: string, maxResults: number): SearchResult[] {
    if (!this.fzfInstance) {
      this.fzfInstance = new Fzf(this.entries, {
        selector: (item) => item.searchText,
        limit: 1000,
      });
    }

    return this.fzfInstance.find(query).slice(0, maxResults).map((result) =>
      this.toSearchResult(result.item),
    );
  }

  private substringSearch(query: string, options: SearchOptions, maxResults: number): SearchResult[] {
    const q = options.caseSensitive ? query : query.toLowerCase();
    const matches: CommandEntry[] = [];

    for (const entry of this.entries) {
      const text = options.caseSensitive ? entry.searchText : entry.searchText.toLowerCase();

      if (options.matchWholeWord) {
        const words = text.split(/[\s:.\-_]/);
        if (!words.some((w) => w === q)) continue;
      } else {
        if (!text.includes(q)) continue;
      }

      matches.push(entry);
      if (matches.length >= maxResults) break;
    }

    return matches.map((entry) => this.toSearchResult(entry));
  }

  private toSearchResult(entry: CommandEntry): SearchResult {
    const label = entry.category
      ? `$(terminal) ${entry.category}: ${entry.title}`
      : `$(terminal) ${entry.title}`;

    return {
      label,
      description: entry.id,
      mode: SearchMode.Command,
      commandId: entry.id,
      alwaysShow: true,
    };
  }

  dispose(): void {
    this.extensionChangeDisposable.dispose();
  }
}
