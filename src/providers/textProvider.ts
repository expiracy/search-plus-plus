import * as vscode from 'vscode';
import { SearchMode, type SearchOptions, type SearchProvider, type SearchResult } from './types';
import { TextSearch } from '../index/textSearch';

export class TextProvider implements SearchProvider {
  readonly mode = SearchMode.Text;

  constructor(private textSearch: TextSearch) {}

  search(
    query: string,
    options: SearchOptions,
    onResults: (results: SearchResult[]) => void,
  ): vscode.Disposable {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const maxResults = config.get<number>('maxResults', 200);

    return this.textSearch.search(
      query,
      { ...options, maxResults },
      (matches) => {
        const results: SearchResult[] = matches.map((match) => {
          const uri = vscode.Uri.file(match.filePath);
          return {
            label: match.matchText.substring(0, 80),
            description: `${match.relativePath}:${match.lineNumber + 1}`,
            detail: match.lineText.substring(0, 200),
            mode: SearchMode.Text,
            uri,
            resourceUri: uri,
            lineNumber: match.lineNumber,
            column: match.column,
            iconPath: vscode.ThemeIcon.File,
            alwaysShow: true,
          };
        });
        onResults(results);
      },
    );
  }
}
