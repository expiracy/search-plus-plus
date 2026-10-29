import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { welcomeContent } from './welcomeContent';
import { DEFAULT_TAB_ORDER, getTabOrder } from '../searchModes';
import { DEFAULT_SECTIONS } from '../providers/types';
import { getEnabledSections } from '../utils';

const DEFAULTS: Record<string, unknown> = {
  tabOrder: DEFAULT_TAB_ORDER,
  'everywhere.sections': DEFAULT_SECTIONS,
  shortcutPreset: 'none', rememberLastMode: false, showWelcomeOnStartup: false,
};

function validValue(key: string, value: unknown): boolean {
  if (key === 'shortcutPreset') return ['none', 'vscode', 'intellij'].includes(value as string);
  if (key === 'rememberLastMode' || key === 'showWelcomeOnStartup') return typeof value === 'boolean';
  const allowed = key === 'tabOrder' ? DEFAULT_TAB_ORDER : key === 'everywhere.sections' ? DEFAULT_SECTIONS : undefined;
  return !!allowed && Array.isArray(value) && new Set(value).size === value.length
    && value.every(item => (allowed as readonly unknown[]).includes(item))
    && (key !== 'tabOrder' || value.length === DEFAULT_TAB_ORDER.length);
}

export class WelcomePage implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private scope: 'user' | 'workspace' = 'user';
  private pending: Promise<void> = Promise.resolve();
  private configurationListener: vscode.Disposable;
  constructor(private globalState: vscode.Memento) {
    this.configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('searchPlusPlus')) this.sendState();
    });
  }

  async showOnStartup(): Promise<void> {
    const shown = this.globalState.get<boolean>('searchPlusPlus.welcomeShown', false);
    if (!shown || vscode.workspace.getConfiguration('searchPlusPlus').get<boolean>('showWelcomeOnStartup', false)) {
      this.show();
      if (!shown) await this.globalState.update('searchPlusPlus.welcomeShown', true);
    }
  }

  show(): void {
    if (this.panel) { this.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel('searchPlusPlus.welcome', 'search++: Welcome & Settings', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    this.panel = panel;
    const received = panel.webview.onDidReceiveMessage((message: unknown) => {
      this.pending = this.pending.then(() => this.handleMessage(message)).catch(error => {
        void this.panel?.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    });
    const disposed = panel.onDidDispose(() => { this.panel = undefined; received.dispose(); disposed.dispose(); });
    panel.webview.html = welcomeContent(randomBytes(16).toString('hex'));
  }

  private sendState(message = ''): void {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    const values: Record<string, unknown> = {};
    const overrides: string[] = [];
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const inspected = config.inspect<unknown>(key);
      values[key] = (this.scope === 'workspace' ? inspected?.workspaceValue : undefined)
        ?? inspected?.globalValue ?? inspected?.defaultValue ?? config.get(key, fallback);
      if (this.scope === 'user' && inspected?.workspaceValue !== undefined) overrides.push(key);
    }
    values.tabOrder = getTabOrder(values.tabOrder);
    values['everywhere.sections'] = getEnabledSections(values['everywhere.sections']);
    if (!validValue('shortcutPreset', values.shortcutPreset)) values.shortcutPreset = 'none';
    values.rememberLastMode = values.rememberLastMode === true;
    values.showWelcomeOnStartup = values.showWelcomeOnStartup === true;
    void this.panel?.webview.postMessage({ type: 'state', values, scope: this.scope, hasWorkspace: !!vscode.workspace.workspaceFolders?.length, overrides, message });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') throw new Error('Unknown welcome-page request.');
    const request = message as Record<string, unknown>;
    if (request.type === 'ready') { this.sendState(); return; }
    if (request.type === 'action') {
      if (request.action === 'shortcuts') await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'search++');
      else if (request.action === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:expiracy.search-plus-plus');
      else if (request.action === 'search') await vscode.commands.executeCommand('searchPlusPlus.open');
      else throw new Error('Unknown welcome-page action.');
      return;
    }
    if (request.type === 'scope' && (request.scope === 'user' || request.scope === 'workspace')) {
      if (request.scope === 'workspace' && !vscode.workspace.workspaceFolders?.length) throw new Error('Open a workspace before saving workspace settings.');
      this.scope = request.scope;
      this.sendState();
      return;
    }
    const resetting = request.type === 'reset';
    if ((resetting || request.type === 'update') && typeof request.key === 'string' && Object.hasOwn(DEFAULTS, request.key) && (resetting || validValue(request.key, request.value))) {
      if (this.scope === 'workspace' && !vscode.workspace.workspaceFolders?.length) throw new Error('Open a workspace before saving workspace settings.');
      const target = this.scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration('searchPlusPlus').update(request.key, resetting ? undefined : request.value, target);
      this.sendState(this.scope === 'workspace' ? 'Saved to this workspace.' : 'Saved to your user defaults.');
      return;
    }
    throw new Error('This setting or value is not supported.');
  }

  dispose(): void { this.panel?.dispose(); this.configurationListener.dispose(); }
}
