import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';

// @vscode/ripgrep provides the path to the ripgrep binary
let defaultRgPath: string;
try {
  defaultRgPath = require('@vscode/ripgrep').rgPath;
} catch {
  // Fallback: VSCode bundles ripgrep, try to find it
  defaultRgPath = 'rg';
}

interface RgMatch {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: Array<{
      match: { text: string };
      start: number;
      end: number;
    }>;
  };
}

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface NotebookJson {
  cells?: NotebookCell[];
}

export interface TextSearchOptions {
  caseSensitive: boolean;
  useRegex: boolean;
  excludeGitIgnored: boolean;
  matchWholeWord: boolean;
  maxResults: number;
}

export interface TextMatch {
  filePath: string;
  relativePath: string;
  lineNumber: number; // 0-indexed for VSCode
  column: number;
  lineText: string;
  matchText: string;
}

export class TextSearch implements vscode.Disposable {
  private activeProcess: ChildProcess | null = null;
  private rgPath: string;
  private excludePatterns: string[] = [];

  constructor(rgPath?: string) {
    this.rgPath = rgPath ?? defaultRgPath;
  }

  setExcludePatterns(patterns: string[]): void {
    this.excludePatterns = patterns;
  }

  search(
    query: string,
    options: TextSearchOptions,
    onResults: (results: TextMatch[]) => void,
  ): vscode.Disposable {
    // Kill any previous search
    this.killActive();

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !query) {
      onResults([]);
      return { dispose: () => {} };
    }

    const args: string[] = [
      '--json',
    ];

    if (!options.caseSensitive) {
      args.push('--smart-case');
    } else {
      args.push('--case-sensitive');
    }

    if (options.matchWholeWord) {
      args.push('--word-regexp');
    } else if (!options.useRegex) {
      args.push('--fixed-strings');
    }

    if (options.excludeGitIgnored) {
      // ripgrep respects .gitignore by default
    } else {
      args.push('--no-ignore');
    }

    // Custom exclude patterns from extension settings
    for (const pattern of this.excludePatterns) {
      args.push('--glob', `!${pattern}`);
    }

    args.push('--', query);

    // Search all workspace folders
    for (const folder of folders) {
      args.push(folder.uri.fsPath);
    }

    const results: TextMatch[] = [];
    let buffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let resultCount = 0;
    let cancelled = false;
    let completed = false;

    const rg = spawn(this.rgPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeProcess = rg;

    const flush = () => {
      if (results.length > 0) {
        onResults([...results]);
      }
    };

    const scheduleFlush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 50);
    };

    rg.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        if (resultCount >= options.maxResults) {
          rg.kill();
          return;
        }

        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const match = parsed as RgMatch;
            const filePath = match.data.path.text;
            const lineText = match.data.lines.text.trim();
            const lineNumber = match.data.line_number;
            const matchText = match.data.submatches[0]?.match?.text ?? lineText;

            results.push({
              filePath,
              relativePath: vscode.workspace.asRelativePath(filePath),
              lineNumber: lineNumber - 1, // VSCode is 0-indexed
              column: match.data.submatches[0]?.start ?? 0,
              lineText,
              matchText,
            });

            resultCount++;
            scheduleFlush();
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    rg.on('close', () => {
      if (flushTimer) clearTimeout(flushTimer);
      if (cancelled || completed) return;
      completed = true;

      // Search notebooks after ripgrep finishes, then deliver all results
      this.searchNotebooks(query, options, results).then(() => {
        onResults([...results]);
        if (this.activeProcess === rg) {
          this.activeProcess = null;
        }
      });
    });

    rg.on('error', () => {
      if (this.activeProcess === rg) {
        this.activeProcess = null;
      }
      if (!completed && !cancelled) {
        completed = true;
        onResults([]);
      }
    });

    return {
      dispose: () => {
        cancelled = true;
        if (flushTimer) clearTimeout(flushTimer);
        rg.kill();
        if (this.activeProcess === rg) {
          this.activeProcess = null;
        }
      },
    };
  }

  private async searchNotebooks(
    query: string,
    options: TextSearchOptions,
    results: TextMatch[],
  ): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    try {
      const notebookUris = await vscode.workspace.findFiles(
        '**/*.ipynb',
        undefined,
        100,
      );

      const isCaseSensitive = options.caseSensitive || query !== query.toLowerCase();
      let pattern: RegExp;
      try {
        const flags = isCaseSensitive ? 'g' : 'gi';
        if (options.useRegex) {
          pattern = new RegExp(options.matchWholeWord ? `\\b${query}\\b` : query, flags);
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(options.matchWholeWord ? `\\b${escaped}\\b` : escaped, flags);
        }
      } catch {
        return; // Invalid regex
      }

      for (const uri of notebookUris) {
        if (results.length >= options.maxResults) break;

        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const notebook: NotebookJson = JSON.parse(new TextDecoder().decode(raw));
          if (!notebook.cells) continue;

          const filePath = uri.fsPath;
          const relativePath = vscode.workspace.asRelativePath(uri);
          let lineOffset = 0;

          for (const cell of notebook.cells) {
            if (results.length >= options.maxResults) break;

            const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
            const cellLines = source.split('\n');

            for (let i = 0; i < cellLines.length; i++) {
              if (results.length >= options.maxResults) break;

              const line = cellLines[i];
              pattern.lastIndex = 0;
              const match = pattern.exec(line);
              if (match) {
                results.push({
                  filePath,
                  relativePath,
                  lineNumber: lineOffset + i,
                  column: match.index,
                  lineText: line.trim(),
                  matchText: match[0],
                });
              }
            }

            lineOffset += cellLines.length;
          }
        } catch {
          // Skip unreadable/malformed notebooks
        }
      }
    } catch {
      // findFiles failed, skip notebook search
    }
  }

  private killActive(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  dispose(): void {
    this.killActive();
  }
}
