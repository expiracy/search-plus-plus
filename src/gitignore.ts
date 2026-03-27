import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';

export class GitIgnoreManager implements vscode.Disposable {
  private ig: Ignore = ignore();
  private watchers: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  async load(): Promise<void> {
    this.ig = ignore();

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    // Find all .gitignore files in workspace
    const gitignoreUris = await vscode.workspace.findFiles(
      '**/.gitignore',
      '**/node_modules/**',
      50,
    );

    for (const uri of gitignoreUris) {
      try {
        const content = new TextDecoder().decode(
          await vscode.workspace.fs.readFile(uri),
        );
        // Prefix patterns with the relative directory of the .gitignore file
        const dir = vscode.workspace.asRelativePath(
          vscode.Uri.joinPath(uri, '..'),
        );
        const lines = content.split(/\r?\n/).filter(
          (line) => line.trim() && !line.startsWith('#'),
        );

        if (dir === '.') {
          this.ig.add(lines);
        } else {
          // Prefix patterns with the directory they apply to
          this.ig.add(lines.map((line) => {
            if (line.startsWith('/')) return `${dir}${line}`;
            if (line.startsWith('!')) return `!${dir}/${line.slice(1)}`;
            return `${dir}/${line}`;
          }));
        }
      } catch {
        // File may have been deleted between findFiles and readFile
      }
    }

    // Also respect files.exclude and search.exclude settings
    const filesExclude = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude', {});
    const searchExclude = vscode.workspace.getConfiguration('search').get<Record<string, boolean>>('exclude', {});
    for (const [pattern, enabled] of Object.entries({ ...filesExclude, ...searchExclude })) {
      if (enabled) {
        this.ig.add(pattern);
      }
    }

    this.setupWatchers();
  }

  private setupWatchers(): void {
    this.disposeWatchers();

    // Watch for .gitignore file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
    watcher.onDidChange(() => this.reload());
    watcher.onDidCreate(() => this.reload());
    watcher.onDidDelete(() => this.reload());
    this.watchers.push(watcher);

    // Watch for config changes
    this.watchers.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('files.exclude') ||
          e.affectsConfiguration('search.exclude')
        ) {
          this.reload();
        }
      }),
    );
  }

  private async reload(): Promise<void> {
    await this.load();
    this._onDidChange.fire();
  }

  isIgnored(relativePath: string): boolean {
    try {
      return this.ig.ignores(relativePath);
    } catch {
      return false;
    }
  }

  /**
   * Build a glob exclude pattern string from gitignore patterns
   * for use with vscode.workspace.findFiles.
   */
  getExcludeGlob(): string | undefined {
    // We can't perfectly convert all gitignore patterns to a single glob,
    // so we use post-filtering via isIgnored() as the primary mechanism.
    // This returns common excludes for initial filtering.
    return '{**/node_modules/**,**/.git/**}';
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
  }

  dispose(): void {
    this.disposeWatchers();
    this._onDidChange.dispose();
  }
}
