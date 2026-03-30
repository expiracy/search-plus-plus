// Minimal vscode mock for testing search++ extension modules

import path from 'path';

// --- Uri ---
export class Uri {
  scheme: string;
  fsPath: string;
  path: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = fsPath.replace(/\\/g, '/');
  }

  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = path.posix.join(base.path, ...segments);
    return new Uri(base.scheme, joined);
  }

  toString() {
    return `${this.scheme}://${this.path}`;
  }
}

// --- ThemeIcon ---
export class ThemeIcon {
  static File = new ThemeIcon('file');
  static Folder = new ThemeIcon('folder');
  constructor(public id: string) {}
}

// --- ThemeColor ---
export class ThemeColor {
  constructor(public id: string) {}
}

// --- Position ---
export class Position {
  constructor(public line: number, public character: number) {}
}

// --- Selection ---
export class Selection {
  constructor(public anchor: Position, public active: Position) {}
}

// --- Range ---
export class Range {
  constructor(public start: Position, public end: Position) {}
}

// --- EventEmitter ---
export class EventEmitter<T = void> {
  private listeners: ((data: T) => void)[] = [];

  event = (listener: (data: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      },
    };
  };

  fire(data: T) {
    for (const l of this.listeners) l(data);
  }

  dispose() {
    this.listeners = [];
  }
}

// --- Enums ---
export const QuickPickItemKind = { Separator: -1 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { Beside: -2 };
export const TextEditorRevealType = { AtTop: 3 };
export const QuickInputButtonLocation = { Title: 0, Inline: 1 };
export const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4,
  Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9,
  Interface: 10, Function: 11, Variable: 12, Constant: 13,
  String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18,
  Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23,
  Operator: 24, TypeParameter: 25,
};

// --- CancellationTokenSource ---
export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}

// --- workspace ---
export const workspace = {
  workspaceFolders: undefined as any,
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultVal: T): T => defaultVal,
  }),
  asRelativePath: (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string'
      ? pathOrUri
      : (pathOrUri.fsPath ?? pathOrUri.path);
    return p.replace(/\\/g, '/');
  },
  getWorkspaceFolder: (uri: Uri) => {
    const folders = workspace.workspaceFolders;
    if (!folders) return undefined;
    const uriPath = uri.path.replace(/\\/g, '/');
    return folders.find((f: { uri: Uri }) => uriPath.startsWith(f.uri.path.replace(/\\/g, '/')));
  },
  findFiles: async () => [] as Uri[],
  findTextInFiles: async (
    query: { pattern: string; isRegExp?: boolean; isCaseSensitive?: boolean; isWordMatch?: boolean },
    optionsOrCallback: any,
    callbackOrToken?: any,
    maybeToken?: any,
  ): Promise<{ limitHit: boolean }> => {
    // Handle overloaded signature
    let options: any;
    let callback: (result: any) => void;
    let token: any;
    if (typeof optionsOrCallback === 'function') {
      options = {};
      callback = optionsOrCallback;
      token = callbackOrToken;
    } else {
      options = optionsOrCallback || {};
      callback = callbackOrToken;
      token = maybeToken;
    }

    // Use ripgrep for realistic test search
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rgPath = require('@vscode/ripgrep').rgPath;

    const args: string[] = ['--json', '--max-filesize', '1M'];

    if (query.isCaseSensitive) {
      args.push('--case-sensitive');
    } else {
      args.push('--ignore-case');
    }

    if (query.isWordMatch) args.push('--word-regexp');
    if (!query.isRegExp && !query.isWordMatch) args.push('--fixed-strings');
    if (options.useIgnoreFiles === false) args.push('--no-ignore');

    args.push('--', query.pattern);
    for (const folder of (workspace.workspaceFolders || [])) {
      args.push(folder.uri.fsPath);
    }

    const maxResults = options.maxResults || 200;

    return new Promise((resolve) => {
      const rg = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let buffer = '';
      let resultCount = 0;

      rg.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          if (token?.isCancellationRequested) { rg.kill(); return; }
          if (resultCount >= maxResults) { rg.kill(); return; }

          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match') {
              const filePath = parsed.data.path.text;
              const lineNumber = parsed.data.line_number - 1;
              const lineText = parsed.data.lines.text.trimEnd();
              const submatches = parsed.data.submatches || [];

              const ranges = submatches.map((sm: any) =>
                new Range(new Position(lineNumber, sm.start), new Position(lineNumber, sm.end)),
              );
              const previewRanges = submatches.map((sm: any) =>
                new Range(new Position(0, sm.start), new Position(0, sm.end)),
              );

              callback({
                uri: Uri.file(filePath),
                ranges: ranges.length === 1 ? ranges[0] : ranges,
                preview: {
                  text: lineText,
                  matches: previewRanges.length === 1 ? previewRanges[0] : previewRanges,
                },
              });

              resultCount += submatches.length;
            }
          } catch { /* skip malformed lines */ }
        }
      });

      rg.on('close', () => resolve({ limitHit: resultCount >= maxResults }));
      rg.on('error', () => resolve({ limitHit: false }));
    });
  },
  fs: {
    readFile: async () => new Uint8Array(),
    stat: async () => ({}),
  },
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
  onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
};

// --- window ---
export const window = {
  activeTextEditor: undefined,
  showTextDocument: async () => ({}),
  createQuickPick: () => ({
    onDidChangeValue: () => ({ dispose() {} }),
    onDidAccept: () => ({ dispose() {} }),
    onDidChangeActive: () => ({ dispose() {} }),
    onDidHide: () => ({ dispose() {} }),
    onDidTriggerButton: () => ({ dispose() {} }),
    onDidTriggerItemButton: () => ({ dispose() {} }),
    show() {},
    hide() {},
    dispose() {},
    items: [],
    buttons: [],
    value: '',
    placeholder: '',
    title: '',
    busy: false,
    matchOnDescription: false,
    matchOnDetail: false,
    sortByLabel: false,
    keepScrollPosition: false,
    selectedItems: [],
  }),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined as any,
    show() {},
    hide() {},
    dispose() {},
  }),
};

// --- commands ---
export const commands = {
  executeCommand: async (..._args: any[]) => {},
  registerCommand: () => ({ dispose() {} }),
};
