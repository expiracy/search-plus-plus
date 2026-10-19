import * as vscode from 'vscode';
import { containsQuery, hasCaseSensitiveSubsequence } from '../utils';
import type { GitIgnoreManager } from '../gitignore';
import { SearchMode, getMaxResults, type SearchOptions, type SearchProvider, type SearchResult } from './types';

export class UsagesProvider implements SearchProvider {
  readonly mode = SearchMode.Usages;
  constructor(private gitIgnore: GitIgnoreManager) {}

  search(query: string, options: SearchOptions, onResults: (results: SearchResult[]) => void, onError?: (error: unknown) => void): vscode.Disposable {
    let cancelled = false;
    const run = async () => {
      const target = options.usageTarget;
      if (!target) return [];
      const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', target.uri, target.position) ?? [];
      const results: SearchResult[] = [];
      const seen = new Set<string>();
      const documents = new Map<string, vscode.TextDocument | undefined>();
      const maxResults = getMaxResults();
      for (const location of locations) {
        if (cancelled) return [];
        const relative = vscode.workspace.asRelativePath(location.uri);
        if (this.gitIgnore.shouldExclude(relative, options, location.uri)) continue;
        const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let label = target.name;
        try {
          const documentKey = location.uri.toString();
          if (!documents.has(documentKey)) {
            documents.set(documentKey, await vscode.workspace.openTextDocument(location.uri).then(document => document, () => undefined));
          }
          const document = documents.get(documentKey);
          if (document) label = document.lineAt(location.range.start.line).text.trim() || target.name;
        } catch { /* Keep the reference navigable when its preview cannot be read. */ }
        const candidate = `${relative} ${label}`;
        const matches = options.fuzzySearch && !options.matchWholeWord
          ? hasCaseSensitiveSubsequence(options.caseSensitive ? candidate : candidate.toLowerCase(), options.caseSensitive ? query : query.toLowerCase())
          : containsQuery(candidate, query, options);
        if (!matches) continue;
        results.push({
          label,
          description: `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`,
          mode: SearchMode.Usages, uri: location.uri,
          alwaysShow: true,
          lineNumber: location.range.start.line, column: location.range.start.character,
        });
        if (results.length >= maxResults) break;
      }
      return results;
    };
    void run().then(results => { if (!cancelled) onResults(results); }, error => {
      if (!cancelled) { if (onError) onError(error); else onResults([]); }
    });
    return { dispose: () => { cancelled = true; } };
  }
}
