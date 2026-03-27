import * as vscode from 'vscode';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { GitIgnoreManager } from '../gitignore';

const SYMBOL_ICONS: Partial<Record<vscode.SymbolKind, string>> = {
  [vscode.SymbolKind.File]: 'symbol-file',
  [vscode.SymbolKind.Module]: 'symbol-module',
  [vscode.SymbolKind.Namespace]: 'symbol-namespace',
  [vscode.SymbolKind.Package]: 'symbol-package',
  [vscode.SymbolKind.Class]: 'symbol-class',
  [vscode.SymbolKind.Method]: 'symbol-method',
  [vscode.SymbolKind.Property]: 'symbol-property',
  [vscode.SymbolKind.Field]: 'symbol-field',
  [vscode.SymbolKind.Constructor]: 'symbol-constructor',
  [vscode.SymbolKind.Enum]: 'symbol-enum',
  [vscode.SymbolKind.Interface]: 'symbol-interface',
  [vscode.SymbolKind.Function]: 'symbol-function',
  [vscode.SymbolKind.Variable]: 'symbol-variable',
  [vscode.SymbolKind.Constant]: 'symbol-constant',
  [vscode.SymbolKind.String]: 'symbol-string',
  [vscode.SymbolKind.Number]: 'symbol-number',
  [vscode.SymbolKind.Boolean]: 'symbol-boolean',
  [vscode.SymbolKind.Array]: 'symbol-array',
  [vscode.SymbolKind.Object]: 'symbol-object',
  [vscode.SymbolKind.Key]: 'symbol-key',
  [vscode.SymbolKind.EnumMember]: 'symbol-enum-member',
  [vscode.SymbolKind.Struct]: 'symbol-struct',
  [vscode.SymbolKind.Event]: 'symbol-event',
  [vscode.SymbolKind.Operator]: 'symbol-operator',
  [vscode.SymbolKind.TypeParameter]: 'symbol-type-parameter',
};

export class SymbolProvider implements SearchProvider {
  readonly mode = SearchMode.Symbol;

  constructor(private gitIgnore: GitIgnoreManager) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    let cancelled = false;

    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const maxResults = config.get<number>('maxResults', 200);

    vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    ).then((symbols) => {
      if (cancelled || !symbols) {
        onResults([]);
        return;
      }

      let results: SearchResult[] = symbols.slice(0, maxResults).map((sym) => {
        const line = sym.location.range.start.line;
        const col = sym.location.range.start.character;
        const relativePath = vscode.workspace.asRelativePath(sym.location.uri);
        const icon = SYMBOL_ICONS[sym.kind] ?? 'symbol-misc';
        const container = sym.containerName ? `${sym.containerName} - ` : '';

        return {
          label: `$(${icon}) ${sym.name}`,
          description: `${container}${relativePath}:${line + 1}`,
          mode: SearchMode.Symbol,
          uri: sym.location.uri,
          lineNumber: line,
          column: col,
          alwaysShow: true,
        };
      });

      if (options.excludeGitIgnored) {
        results = results.filter((r) => {
          if (!r.uri) return true;
          const rel = vscode.workspace.asRelativePath(r.uri);
          return !this.gitIgnore.isIgnored(rel);
        });
      }

      onResults(results);
    });

    return { dispose: () => { cancelled = true; } };
  }
}
