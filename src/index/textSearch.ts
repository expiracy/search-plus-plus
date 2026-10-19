import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import type { GitIgnoreManager } from '../gitignore';
import type { TextSearchOptions } from '../providers/types';

function resolveRgPath(): string {
  const rgBin = process.platform === 'win32' ? 'rg.exe' : 'rg';

  // Strategy 1: @vscode/ripgrep npm package (works in development)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rgPath: string = require('@vscode/ripgrep').rgPath;
    if (existsSync(rgPath)) {
      return rgPath;
    }
  } catch {
    // Not available (expected in packaged VSIX since node_modules is excluded)
  }

  // Strategy 2: VS Code's bundled ripgrep
  for (const modules of ['node_modules.asar.unpacked', 'node_modules']) {
    const candidates = [
      path.join(vscode.env.appRoot, modules, '@vscode', 'ripgrep', 'bin', rgBin),
      path.join(vscode.env.appRoot, modules, '@vscode', 'ripgrep-universal', 'bin', `${process.platform}-${process.arch}`, rgBin),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  // Strategy 3: system PATH
  return 'rg';
}

let cachedRgPath: string | undefined;
function getDefaultRgPath(): string {
  if (cachedRgPath === undefined) {
    cachedRgPath = resolveRgPath();
  }
  return cachedRgPath;
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

function isRgMatch(value: unknown): value is RgMatch {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  if (msg.type !== 'match') return false;
  const data = msg.data;
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.path === 'object' && d.path !== null &&
    typeof (d.path as Record<string, unknown>).text === 'string' &&
    typeof d.line_number === 'number' &&
    typeof d.lines === 'object' && d.lines !== null &&
    Array.isArray(d.submatches)
  );
}

function isNotebookJson(value: unknown): value is NotebookJson {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.cells === undefined || Array.isArray(obj.cells);
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
  private activeRequest?: vscode.Disposable;
  private rgPath: string;
  private excludePatterns: string[] = [];
  private searchIgnorePatterns: string[] = [];

  constructor(rgPath?: string, private gitIgnore?: GitIgnoreManager) {
    this.rgPath = rgPath ?? getDefaultRgPath();
  }

  setExcludePatterns(patterns: string[]): void {
    this.excludePatterns = patterns;
  }

  setSearchIgnorePatterns(patterns: string[]): void {
    this.searchIgnorePatterns = patterns;
  }

  search(
    query: string,
    options: TextSearchOptions,
    onResults: (results: TextMatch[]) => void,
    onError?: (error: unknown) => void,
    onComplete?: () => void,
  ): vscode.Disposable {
    // Kill any previous search
    this.killActive();

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !query) {
      onResults([]);
      onComplete?.();
      return { dispose: () => {} };
    }

    const args: string[] = [
      '--json',
      '--hidden', '--glob', '!**/.git/**',
      '--glob', '!*.ipynb',
    ];

    if (!options.caseSensitive) {
      args.push('--ignore-case');
    } else {
      args.push('--case-sensitive');
    }

    // --fixed-strings and --word-regexp compose: the query stays literal while
    // ripgrep adds the word boundaries
    if (!options.useRegex) {
      args.push('--fixed-strings');
    }
    if (options.matchWholeWord) {
      args.push('--word-regexp');
    }

    if (options.excludeGitIgnored) {
      // Match the workspace policy: .gitignore files within each root, including
      // workspaces that are not Git repositories.
      args.push('--no-require-git', '--no-ignore-dot', '--no-ignore-global', '--no-ignore-parent', '--no-ignore-exclude');
    } else {
      args.push('--no-ignore');
    }

    // Custom exclude patterns from extension settings
    for (const pattern of this.excludePatterns) {
      args.push('--glob', `!${pattern}`);
    }

    // .searchignore patterns (when toggle is enabled)
    if (options.excludeSearchIgnored) {
      for (const pattern of this.searchIgnorePatterns) {
        args.push('--glob', `!${pattern}`);
      }
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
    let limited = false;
    let stderr = '';

    const rg = spawn(this.rgPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeProcess = rg;
    rg.stderr?.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });

    const flush = () => {
      if (!cancelled && !completed && results.length > 0) {
        onResults([...results]);
      }
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = undefined; flush(); }, 50);
    };

    rg.stdout.setEncoding('utf8');
    rg.stdout.on('data', (data: string) => {
      if (cancelled || completed) return;
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        if (resultCount >= options.maxResults) {
          limited = true;
          rg.kill();
          return;
        }

        try {
          const parsed: unknown = JSON.parse(line);
          if (isRgMatch(parsed)) {
            const match = parsed;
            const filePath = match.data.path.text;
            const relativePath = vscode.workspace.asRelativePath(filePath);
            if (this.gitIgnore?.shouldExclude(relativePath, options, vscode.Uri.file(filePath))) continue;
            const lineText = match.data.lines.text.trim();
            const lineNumber = match.data.line_number;
            const matchText = match.data.submatches[0]?.match?.text ?? lineText;

            results.push({
              filePath,
              relativePath,
              lineNumber: lineNumber - 1, // VSCode is 0-indexed
              column: Buffer.from(match.data.lines.text, 'utf8')
                .subarray(0, match.data.submatches[0]?.start ?? 0).toString('utf8').length,
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

    rg.on('close', (code) => {
      if (flushTimer) clearTimeout(flushTimer);
      if (cancelled || completed) return;
      completed = true;

      if (!limited && code !== 0 && code !== 1) {
        if (this.activeProcess === rg) this.activeProcess = null;
        const error = new Error(stderr.trim() || `ripgrep exited with code ${code}`);
        if (onError) onError(error);
        else onResults([]);
        onComplete?.();
        return;
      }

      // Search notebooks after ripgrep finishes, then deliver all results
      this.searchNotebooks(query, options, results, () => cancelled).then(() => {
        if (cancelled) return;
        onResults([...results]);
        if (this.activeRequest === request) this.activeRequest = undefined;
        if (this.activeProcess === rg) {
          this.activeProcess = null;
        }
        onComplete?.();
      });
    });

    rg.on('error', (error) => {
      if (flushTimer) clearTimeout(flushTimer);
      if (this.activeProcess === rg) {
        this.activeProcess = null;
      }
      if (!completed && !cancelled) {
        completed = true;
        if (onError) onError(error);
        else onResults([]);
        onComplete?.();
      }
    });

    const request = {
      dispose: () => {
        cancelled = true;
        if (flushTimer) clearTimeout(flushTimer);
        rg.kill();
        if (this.activeProcess === rg) {
          this.activeProcess = null;
        }
        if (this.activeRequest === request) this.activeRequest = undefined;
      },
    };
    this.activeRequest = request;
    return request;
  }

  private async searchNotebooks(
    query: string,
    options: TextSearchOptions,
    results: TextMatch[],
    isCancelled: () => boolean,
  ): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || isCancelled() || results.length >= options.maxResults) return;

    try {
      const gi = this.gitIgnore;
      const allNotebookUris = await vscode.workspace.findFiles(
        '**/*.ipynb',
        gi?.getExcludeGlob() ?? '**/.git/**',
      );
      if (isCancelled()) return;

      const notebookUris = gi
        ? allNotebookUris.filter((uri) => {
            const rel = vscode.workspace.asRelativePath(uri);
            return !gi.shouldExclude(rel, options, uri);
          })
        : allNotebookUris;

      const isCaseSensitive = options.caseSensitive;
      let pattern: RegExp;
      try {
        const flags = isCaseSensitive ? 'g' : 'gi';
        if (options.useRegex) {
          pattern = new RegExp(options.matchWholeWord ? `\\b(?:${query})\\b` : query, flags);
        } else {
          const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(options.matchWholeWord ? `\\b${escaped}\\b` : escaped, flags);
        }
      } catch {
        return; // Invalid regex
      }

      for (const uri of notebookUris) {
        if (isCancelled() || results.length >= options.maxResults) break;

        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          if (isCancelled()) return;
          const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
          if (!isNotebookJson(parsed) || !parsed.cells) continue;
          const cells = parsed.cells;

          const filePath = uri.fsPath;
          const relativePath = vscode.workspace.asRelativePath(uri);
          let lineOffset = 0;

          for (const cell of cells) {
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
    this.activeRequest?.dispose();
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  dispose(): void {
    this.killActive();
  }
}
