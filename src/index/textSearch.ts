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

export interface TextSearchOptions {
  caseSensitive: boolean;
  useRegex: boolean;
  excludeGitIgnored: boolean;
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

  constructor(rgPath?: string) {
    this.rgPath = rgPath ?? defaultRgPath;
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
      '--max-count', '5',
      '--max-filesize', '1M',
    ];

    if (!options.caseSensitive) {
      args.push('--smart-case');
    } else {
      args.push('--case-sensitive');
    }

    if (!options.useRegex) {
      args.push('--fixed-strings');
    }

    if (options.excludeGitIgnored) {
      // ripgrep respects .gitignore by default
    } else {
      args.push('--no-ignore');
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
      flush();
      if (this.activeProcess === rg) {
        this.activeProcess = null;
      }
    });

    rg.on('error', () => {
      if (this.activeProcess === rg) {
        this.activeProcess = null;
      }
    });

    return {
      dispose: () => {
        if (flushTimer) clearTimeout(flushTimer);
        rg.kill();
        if (this.activeProcess === rg) {
          this.activeProcess = null;
        }
      },
    };
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
