import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';

export class GitIgnoreManager implements vscode.Disposable {
  private ig: Ignore = ignore();
  private directoryExcludes: string[] = [];
  private watchers: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  async load(): Promise<void> {
    this.ig = ignore();
    this.directoryExcludes = ['**/node_modules/**', '**/.git/**'];

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    // Find all .gitignore files in workspace
    const gitignoreUris = await vscode.workspace.findFiles(
      '**/.gitignore',
      '**/node_modules/**',
      1000,
    );

    for (const uri of gitignoreUris) {
      try {
        const content = new TextDecoder().decode(
          await vscode.workspace.fs.readFile(uri),
        );
        // Prefix patterns with the relative directory of the .gitignore file
        const parentUri = vscode.Uri.joinPath(uri, '..');
        const dir = vscode.workspace.asRelativePath(parentUri).replace(/\\/g, '/');
        const lines = content.split(/\r?\n/).filter(
          (line) => line.trim() && !line.startsWith('#'),
        );

        // Root .gitignore: asRelativePath returns the folder name (not '.')
        // when the path is the workspace root, so compare URIs directly
        const isRoot = folders.some(f =>
          f.uri.path.replace(/\\/g, '/').toLowerCase() ===
          parentUri.path.replace(/\\/g, '/').toLowerCase(),
        );

        if (isRoot) {
          this.ig.add(lines);
        } else {
          // Prefix patterns with the directory they apply to
          this.ig.add(lines.map((line) => {
            if (line.startsWith('/')) return `${dir}${line}`;
            if (line.startsWith('!')) return `!${dir}/${line.slice(1)}`;
            return `${dir}/${line}`;
          }));
        }

        // Extract simple directory patterns for the exclude glob
        for (const line of lines) {
          if (line.startsWith('!') || line.includes('[')) continue;
          if (line.endsWith('/')) {
            const dirName = line.slice(0, -1);
            if (/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(dirName)) {
              if (isRoot) {
                this.directoryExcludes.push(`**/${dirName}/**`);
              } else {
                this.directoryExcludes.push(`**/${dir}/${dirName}/**`);
              }
            }
          }
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
      return this.ig.ignores(relativePath.replace(/\\/g, '/'));
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
    // This returns directory-level excludes for initial filtering.
    const unique = [...new Set(this.directoryExcludes)];
    return `{${unique.join(',')}}`;
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
