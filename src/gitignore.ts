import * as vscode from 'vscode';
import ignore, { type Ignore } from 'ignore';

interface ScopedRules {
  root: string;
  directory: string;
  matcher: Ignore;
  patterns: string[];
}

type ExclusionOptions = { excludeGitIgnored: boolean; excludeSearchIgnored: boolean };

export class GitIgnoreManager implements vscode.Disposable {
  private gitRules: ScopedRules[] = [];
  private searchRules: ScopedRules[] = [];
  // Directory decisions per published rule set; replaced rule sets drop their cache.
  private readonly directoryCache = new WeakMap<ScopedRules[], Map<string, boolean>>();
  private customIg: Ignore = ignore();
  private cachedCustomExcludes: string[] = [];
  private watchers: vscode.Disposable[] = [];
  private loadPromise?: Promise<void>;
  private disposed = false;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadSnapshot().finally(() => { this.loadPromise = undefined; });
    }
    return this.loadPromise;
  }

  private async loadSnapshot(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const [gitRules, searchRules] = await Promise.all([
      this.loadIgnoreFiles('**/.gitignore', folders),
      this.loadIgnoreFiles('**/.searchignore', folders),
    ]);
    const custom = vscode.workspace.getConfiguration('searchPlusPlus').get<string[]>('excludePaths', []);
    if (this.disposed) return;

    // Publish a complete policy; searches never see half-loaded rules.
    this.gitRules = gitRules;
    this.searchRules = searchRules;
    this.cachedCustomExcludes = [...custom];
    this.customIg = ignore().add(custom);
    if (!this.watchers.length) this.setupWatchers();
  }

  private async loadIgnoreFiles(glob: string, folders: readonly vscode.WorkspaceFolder[]): Promise<ScopedRules[]> {
    if (!folders.length) return [];
    const uris = await vscode.workspace.findFiles(glob, this.getExcludeGlob());
    const rules: ScopedRules[] = [];
    for (const uri of uris) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) continue;
      try {
        const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        const rootPath = folder.uri.path.replace(/\/$/, '');
        const parentPath = vscode.Uri.joinPath(uri, '..').path;
        const directory = parentPath === rootPath ? '' : parentPath.slice(rootPath.length + 1);
        rules.push({
          root: folder.uri.toString(), directory,
          matcher: ignore().add(content),
          patterns: content.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')),
        });
      } catch {
        // An ignore file can disappear during discovery.
      }
    }
    return rules.sort((a, b) => a.directory.length - b.directory.length || a.directory.localeCompare(b.directory));
  }

  private setupWatchers(): void {
    for (const glob of ['**/.gitignore', '**/.searchignore']) {
      const watcher = vscode.workspace.createFileSystemWatcher(glob);
      watcher.onDidChange(() => this.reload());
      watcher.onDidCreate(() => this.reload());
      watcher.onDidDelete(() => this.reload());
      this.watchers.push(watcher);
    }
    this.watchers.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('searchPlusPlus.excludePaths')) void this.reload();
    }));
  }

  private async reload(): Promise<void> {
    try {
      await this.load();
      if (!this.disposed) this._onDidChange.fire();
    } catch (error) {
      console.error('[search++] Failed to reload ignore rules:', error);
    }
  }

  isGitIgnored(relativePath: string, uri?: vscode.Uri): boolean {
    return this.testScoped(this.gitRules, relativePath, uri);
  }

  isSearchIgnored(relativePath: string, uri?: vscode.Uri): boolean {
    return this.testScoped(this.searchRules, relativePath, uri);
  }

  isCustomExcluded(relativePath: string, uri?: vscode.Uri): boolean {
    const p = this.resolvePath(relativePath, uri).path;
    if (/(^|\/)\.git(?:\/|$)/.test(p)) return true;
    if (!this.cachedCustomExcludes.length) return false;
    try { return this.customIg.ignores(p); } catch { return false; }
  }

  shouldExclude(relativePath: string, options: ExclusionOptions, uri?: vscode.Uri): boolean {
    return this.isCustomExcluded(relativePath, uri)
      || (options.excludeGitIgnored && this.isGitIgnored(relativePath, uri))
      || (options.excludeSearchIgnored && this.isSearchIgnored(relativePath, uri));
  }

  private resolvePath(relativePath: string, uri?: vscode.Uri): { root?: string; path: string } {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    return {
      root: folder?.uri.toString(),
      path: uri && folder
        ? uri.path.slice(folder.uri.path.replace(/\/$/, '').length + 1)
        : relativePath.replace(/\\/g, '/'),
    };
  }

  private testScoped(rules: ScopedRules[], relativePath: string, uri?: vscode.Uri): boolean {
    if (!rules.length) return false;
    const resolved = this.resolvePath(relativePath, uri);
    const scoped = rules.filter(rule => rule.root === resolved.root);
    if (!scoped.length) return false;
    const slash = resolved.path.lastIndexOf('/');
    if (slash > 0 && this.isDirectoryIgnored(rules, scoped, resolved.root, resolved.path.slice(0, slash))) return true;
    return this.testAtPath(scoped, resolved.path);
  }

  /** A rule inside an ignored directory cannot re-include that directory's files. */
  private isDirectoryIgnored(rules: ScopedRules[], scoped: ScopedRules[], root: string | undefined, directory: string): boolean {
    let cache = this.directoryCache.get(rules);
    if (!cache) {
      cache = new Map();
      this.directoryCache.set(rules, cache);
    }
    const key = `${root ?? ''}\n${directory}`;
    let ignored = cache.get(key);
    if (ignored === undefined) {
      const slash = directory.lastIndexOf('/');
      ignored = (slash > 0 && this.isDirectoryIgnored(rules, scoped, root, directory.slice(0, slash)))
        || this.testAtPath(scoped, directory + '/');
      cache.set(key, ignored);
    }
    return ignored;
  }

  private testAtPath(rules: ScopedRules[], path: string): boolean {
    let ignored = false;
    for (const rule of rules) {
      const prefix = rule.directory ? rule.directory + '/' : '';
      if (!path.startsWith(prefix) || path.length === prefix.length) continue;
      try {
        const result = rule.matcher.test(path.slice(prefix.length));
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      } catch { /* Absolute or empty paths are not workspace candidates. */ }
    }
    return ignored;
  }

  getCustomExcludePatterns(): string[] { return [...this.cachedCustomExcludes]; }

  getSearchIgnorePatterns(): string[] {
    return this.searchRules.flatMap(rule => rule.patterns.map(pattern =>
      rule.directory ? `${rule.directory}/${pattern}` : pattern,
    ));
  }

  getExcludeGlob(): string {
    // Toggle-controlled rules must not remove candidates during discovery.
    return '**/.git/**';
  }

  dispose(): void {
    this.disposed = true;
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    this._onDidChange.dispose();
  }
}
