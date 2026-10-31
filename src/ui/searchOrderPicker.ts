import * as vscode from 'vscode';
import { DEFAULT_TAB_ORDER, getSearchConfiguration, SEARCH_LABELS, SearchMode } from '../searchModes';

export interface SearchOrderItem extends vscode.QuickPickItem {
  mode: SearchMode;
  target: vscode.ConfigurationTarget;
}

export class SearchOrderPicker implements vscode.Disposable {
  private picker?: vscode.QuickPick<SearchOrderItem>;
  private target = vscode.ConfigurationTarget.Global;
  private pending = Promise.resolve();
  private waiting = 0;
  private disposed = false;
  private closeSession?: () => void;
  private readonly workspaceButton = { iconPath: new vscode.ThemeIcon('globe'), tooltip: 'Switch to Workspace settings' };
  private readonly userButton = { iconPath: new vscode.ThemeIcon('globe'), tooltip: 'Switch to User settings' };
  private scopeButton: vscode.QuickInputButton = this.workspaceButton;
  private readonly up = { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: 'Move up' };
  private readonly down = { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: 'Move down' };
  private readonly titleUp = { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: 'Move selected search up' };
  private readonly titleDown = { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: 'Move selected search down' };
  private readonly done = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Done' };

  constructor(private readonly createPicker: () => vscode.QuickPick<SearchOrderItem> = () => vscode.window.createQuickPick<SearchOrderItem>()) {}

  private hasWorkspace(): boolean {
    return !!(vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length);
  }

  async show(scope?: 'user' | 'workspace'): Promise<void> {
    await this.pending;
    if (this.disposed) return;
    if (scope === 'workspace' && !this.hasWorkspace()) {
      void vscode.window.showInformationMessage('Open a workspace to arrange its search order.');
      return;
    }
    this.target = scope === 'workspace' || (scope !== 'user' && this.hasWorkspace()
      && vscode.workspace.getConfiguration('searchPlusPlus').inspect('searchOrder')?.workspaceValue !== undefined)
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    if (this.picker) { this.render(); this.picker.show(); return; }
    const picker = this.createPicker() as vscode.QuickPick<SearchOrderItem> & { sortByLabel: boolean };
    this.picker = picker;
    picker.enabled = true;
    picker.ignoreFocusOut = true;
    picker.matchOnDescription = false;
    picker.matchOnDetail = false;
    picker.sortByLabel = false;
    picker.keepScrollPosition = true;
    const subscriptions: vscode.Disposable[] = [];
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (this.picker === picker) this.picker = undefined;
      subscriptions.forEach(item => item.dispose()); picker.dispose();
      if (this.closeSession === close) this.closeSession = undefined;
    };
    this.closeSession = close;
    subscriptions.push(picker.onDidHide(close), picker.onDidTriggerItemButton(event => {
      const direction = event.button === this.up ? -1 : event.button === this.down ? 1 : 0;
      if (!direction || !picker.enabled || event.item.target !== this.target || !DEFAULT_TAB_ORDER.includes(event.item.mode)) return;
      this.move(picker, event.item.mode, direction, this.target);
    }), picker.onDidTriggerButton(async button => {
      const direction = button === this.titleUp ? -1 : button === this.titleDown ? 1 : 0;
      if (direction) {
        const item = picker.activeItems[0];
        if (picker.enabled && item?.target === this.target) this.move(picker, item.mode, direction, this.target);
      } else if (button === this.done) {
        picker.enabled = false; await this.pending;
        if (this.picker === picker) picker.hide();
      } else if (button === this.scopeButton) {
        await this.pending;
        if (this.picker !== picker) return;
        this.target = this.target === vscode.ConfigurationTarget.Global ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        picker.value = ''; this.render();
      }
    }), vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('searchPlusPlus')) this.render();
    }));
    this.render();
    picker.show();
  }

  private render(active = this.picker?.activeItems[0]?.mode): void {
    const picker = this.picker;
    if (!picker) return;
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const preferences = getSearchConfiguration(config, this.target === vscode.ConfigurationTarget.Global ? 'globalValue' : 'workspaceValue');
    picker.title = `Search order · ${this.target === vscode.ConfigurationTarget.Global ? 'User settings' : 'Workspace settings'}`;
    picker.placeholder = 'Select a search, then use ↑ / ↓ at the top. Changes save automatically.';
    this.scopeButton = this.target === vscode.ConfigurationTarget.Global ? this.workspaceButton : this.userButton;
    picker.buttons = [this.titleUp, this.titleDown, ...(this.hasWorkspace() ? [this.scopeButton] : []), this.done];
    picker.items = preferences.order.map((mode, index) => ({
      mode, target: this.target, label: SEARCH_LABELS[mode],
      description: `${index + 1} of ${preferences.order.length}${preferences.tabs.includes(mode) ? '' : ' · Disabled'}`,
      buttons: [...(index > 0 ? [this.up] : []), ...(index < preferences.order.length - 1 ? [this.down] : [])],
    }));
    picker.activeItems = [picker.items.find(item => item.mode === active) ?? picker.items[0]];
    picker.busy = this.waiting > 0;
  }

  private move(picker: vscode.QuickPick<SearchOrderItem>, mode: SearchMode, direction: number, target: vscode.ConfigurationTarget): void {
    this.waiting++; picker.busy = true;
    this.pending = this.pending.then(async () => {
      if (this.disposed) return;
      const config = vscode.workspace.getConfiguration('searchPlusPlus');
      const order = getSearchConfiguration(config, target === vscode.ConfigurationTarget.Global ? 'globalValue' : 'workspaceValue').order;
      const from = order.indexOf(mode), to = from + direction;
      if (from < 0 || to < 0 || to >= order.length) return;
      const next = [...order]; next.splice(from, 1); next.splice(to, 0, mode);
      await config.update('searchOrder', next.map(item => SEARCH_LABELS[item]), target);
      if (this.picker === picker && this.target === target) this.render(mode);
    }).catch(error => {
      void vscode.window.showErrorMessage(`Could not update search order: ${error instanceof Error ? error.message : String(error)}`);
      if (this.picker === picker && this.target === target) this.render(mode);
    }).finally(() => { this.waiting--; if (this.picker) this.picker.busy = this.waiting > 0; });
  }

  dispose(): void {
    this.disposed = true;
    this.picker?.hide(); this.closeSession?.();
  }
}
