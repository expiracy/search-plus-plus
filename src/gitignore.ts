import * as vscode from 'vscode';
import ignore, { Ignore } from 'ignore';

export class GitIgnoreManager implements vscode.Disposable {
  private ig: Ignore = ignore();
  private customIg: Ignore = ignore();
  private searchIg: Ignore = ignore();
  private searchIgnorePatterns: string[] = [];
  private cachedCustomExcludes: string[] = [];
  private directoryExcludes: string[] = [];
  private watchers: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  async load(): Promise<void> {
    this.ig = ignore();
    this.customIg = ignore();
    this.searchIg = ignore();
    this.searchIgnorePatterns = [];
    this.directoryExcludes = ['**/node_modules/**', '**/.git/**'];

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    await this.loadIgnoreFiles('**/.gitignore', this.ig, folders);
    this.searchIgnorePatterns = await this.loadIgnoreFiles('**/.searchignore', this.searchIg, folders);

    // Custom exclude patterns from searchPlusPlus.excludePaths
    this.cachedCustomExcludes = vscode.workspace
      .getConfiguration('searchPlusPlus')
      .get<string[]>('excludePaths', []);
    for (const pattern of this.cachedCustomExcludes) {
      this.customIg.add(pattern);
      if (pattern.includes('/**') || pattern.endsWith('/')) {
        this.directoryExcludes.push(pattern);
      }
    }

    this.setupWatchers();
  }

  /** Load ignore files matching a glob, add patterns to the given Ignore instance, and return collected patterns. */
  private async loadIgnoreFiles(
    glob: string,
    ig: Ignore,
    folders: readonly vscode.WorkspaceFolder[],
  ): Promise<string[]> {
    const collected: string[] = [];
    const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 1000);

    for (const uri of uris) {
      try {
        const content = new TextDecoder().decode(
          await vscode.workspace.fs.readFile(uri),
        );
        const parentUri = vscode.Uri.joinPath(uri, '..');
        const dir = vscode.workspace.asRelativePath(parentUri).replace(/\\/g, '/');
        const lines = content.split(/\r?\n/).filter(
          (line) => line.trim() && !line.startsWith('#'),
        );

        const isRoot = folders.some(f =>
          f.uri.path.replace(/\\/g, '/').toLowerCase() ===
          parentUri.path.replace(/\\/g, '/').toLowerCase(),
        );

        if (isRoot) {
          ig.add(lines);
          collected.push(...lines);
        } else {
          const prefixed = lines.map((line) => {
            if (line.startsWith('/')) return `${dir}${line}`;
            if (line.startsWith('!')) return `!${dir}/${line.slice(1)}`;
            return `${dir}/${line}`;
          });
          ig.add(prefixed);
          collected.push(...prefixed);
        }

        // Track directory-level patterns for exclude glob
        for (const line of lines) {
          const pattern = isRoot ? line : `${dir}/${line}`;
          if (pattern.includes('/**') || pattern.endsWith('/')) {
            this.directoryExcludes.push(pattern);
          }
        }
      } catch {
        // File may have been deleted between findFiles and readFile
      }
    }

    return collected;
  }

  private setupWatchers(): void {
    this.disposeWatchers();

    // Watch for .gitignore file changes
    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
    gitWatcher.onDidChange(() => this.reload());
    gitWatcher.onDidCreate(() => this.reload());
    gitWatcher.onDidDelete(() => this.reload());
    this.watchers.push(gitWatcher);

    // Watch for .searchignore file changes
    const searchWatcher = vscode.workspace.createFileSystemWatcher('**/.searchignore');
    searchWatcher.onDidChange(() => this.reload());
    searchWatcher.onDidCreate(() => this.reload());
    searchWatcher.onDidDelete(() => this.reload());
    this.watchers.push(searchWatcher);

    // Watch for config changes
    this.watchers.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('searchPlusPlus.excludePaths')
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

  isGitIgnored(relativePath: string): boolean {
    return this.testIgnore(this.ig, relativePath);
  }

  isCustomExcluded(relativePath: string): boolean {
    return this.testIgnore(this.customIg, relativePath);
  }

  isSearchIgnored(relativePath: string): boolean {
    return this.testIgnore(this.searchIg, relativePath);
  }

  shouldExclude(relativePath: string, options: { excludeGitIgnored: boolean; excludeSearchIgnored: boolean }): boolean {
    if (this.isCustomExcluded(relativePath)) return true;
    if (options.excludeSearchIgnored && this.isSearchIgnored(relativePath)) return true;
    if (options.excludeGitIgnored && this.isGitIgnored(relativePath)) return true;
    return false;
  }

  getCustomExcludePatterns(): string[] {
    return [...this.cachedCustomExcludes];
  }

  private testIgnore(ig: Ignore, relativePath: string): boolean {
    try {
      return ig.ignores(relativePath.replace(/\\/g, '/'));
    } catch {
      return false;
    }
  }

  getSearchIgnorePatterns(): string[] {
    return [...this.searchIgnorePatterns];
  }

  getExcludeGlob(): string | undefined {
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
