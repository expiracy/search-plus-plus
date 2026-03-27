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
  findFiles: async () => [] as Uri[],
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
