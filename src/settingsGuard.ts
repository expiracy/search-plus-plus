import * as vscode from 'vscode';
import { getSearchConfiguration, SEARCH_LABELS } from './searchModes';

export function registerSearchTypeValidation(): vscode.Disposable {
  const scopes = [
    ['globalValue', vscode.ConfigurationTarget.Global],
    ['workspaceValue', vscode.ConfigurationTarget.Workspace],
  ] as const;
  const clone = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const previous = scopes.map(([scope]) => {
    const config = vscode.workspace.getConfiguration('searchPlusPlus');
    return { raw: clone(config.inspect('everythingTabSources')?.[scope]), enabled: getSearchConfiguration(config, scope).enabled };
  });
  let disposed = false;
  let pending = Promise.resolve();
  const listener = vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('searchPlusPlus.everythingTabSources')) return;
    pending = pending.then(async () => {
      for (const [index, [scope, target]] of scopes.entries()) {
        if (disposed) return;
        const config = vscode.workspace.getConfiguration('searchPlusPlus');
        const raw = config.inspect('everythingTabSources')?.[scope];
        const choices = getSearchConfiguration(config, scope);
        if (choices.hasEnabledSearches) {
          previous[index] = { raw: clone(raw), enabled: choices.enabled };
          continue;
        }
        const changed = JSON.stringify(raw) !== JSON.stringify(previous[index].raw);
        const replacement = changed ? previous[index].raw : {
          ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}),
          [SEARCH_LABELS[previous[index].enabled[0]]]: true,
        };
        await config.update('everythingTabSources', replacement, target);
        void vscode.window.showInformationMessage('Keep at least one source selected so a search tab remains available.');
      }
    }).catch(error => { console.warn('search++ could not restore enabled search types.', error); });
  });
  return { dispose() { disposed = true; listener.dispose(); } };
}
