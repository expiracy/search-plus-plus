import * as vscode from 'vscode';

function resource(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

function tabKey(tab: vscode.Tab): string {
  const input = tab.input;
  const kind = input instanceof vscode.TabInputText ? 'text'
    : input instanceof vscode.TabInputNotebook ? `notebook:${input.notebookType}`
    : input instanceof vscode.TabInputCustom ? `custom:${input.viewType}` : 'other';
  return JSON.stringify([tab.group.viewColumn, resource(tab)?.toString(), kind]);
}

function findTab(uri: string): vscode.Tab | undefined {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs)
    .find(tab => resource(tab)?.toString() === uri);
}

/** Owns the one replaceable editor tab used to inspect search results. */
export class ResultPreview implements vscode.Disposable {
  // VS Code can replace Tab objects when its editor model refreshes.
  private owned?: { uri: string; key: string; wasPreview: boolean };
  private column?: vscode.ViewColumn;
  private pending = Promise.resolve();
  private version = 0;
  private tabSubscription: vscode.Disposable;

  constructor() {
    this.tabSubscription = vscode.window.tabGroups.onDidChangeTabs(event => {
      if (this.owned && event.closed.some(tab => tabKey(tab) === this.owned?.key)) this.owned = undefined;
    });
  }

  show(uri: vscode.Uri, selection?: vscode.Range): Promise<void> {
    const version = ++this.version;
    const request = this.pending.then(() => {
      if (version === this.version) return this.open(uri, selection, version);
    });
    this.pending = request.catch(() => {});
    return request;
  }

  async finish(accepted?: vscode.Uri): Promise<void> {
    this.cancel();
    await this.pending;
    if (accepted) {
      if (this.currentOwned() && this.owned?.uri !== accepted.toString()) await this.closeOwned();
      this.owned = undefined;
      this.column = undefined;
    }
  }

  cancel(): void { this.version++; }

  private async open(uri: vscode.Uri, selection: vscode.Range | undefined, version: number): Promise<void> {
    if (this.currentOwned() && this.owned?.uri !== uri.toString()) await this.closeOwned();
    if (version !== this.version) return;
    const before = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tabKey));
    const existing = findTab(uri.toString());
    this.column ??= vscode.window.tabGroups.activeTabGroup.viewColumn;
    const group = existing?.group ?? vscode.window.tabGroups.all.find(group => group.viewColumn === this.column)
      ?? vscode.window.tabGroups.activeTabGroup;
    const preview = !!existing?.isPreview || !group.tabs.some(tab => tab.isPreview);
    await vscode.commands.executeCommand('vscode.open', uri, { preview, preserveFocus: true, selection, viewColumn: group.viewColumn });
    const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
      tab.group.viewColumn === group.viewColumn && resource(tab)?.toString() === uri.toString() && !before.has(tabKey(tab)));
    if (tab) this.owned = { uri: uri.toString(), key: tabKey(tab), wasPreview: tab.isPreview };
    if (selection && version === this.version) {
      const editor = vscode.window.visibleTextEditors.find(editor =>
        editor.document.uri.toString() === uri.toString() && editor.viewColumn === group.viewColumn);
      editor?.revealRange(selection, vscode.TextEditorRevealType.InCenter);
    }
  }

  private currentOwned(): vscode.Tab | undefined {
    if (!this.owned) return undefined;
    const key = this.owned.key;
    const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tabKey(tab) === key);
    if (!tab || tab.isDirty || tab.isPinned || (this.owned.wasPreview && !tab.isPreview)) {
      this.owned = undefined;
      return undefined;
    }
    return tab;
  }

  private async closeOwned(): Promise<void> {
    const tab = this.currentOwned();
    if (!tab) return;
    if (!await vscode.window.tabGroups.close(tab, true)) throw new Error('The previous search preview could not be replaced');
    this.owned = undefined;
  }

  dispose(): void { this.cancel(); this.tabSubscription.dispose(); }
}
