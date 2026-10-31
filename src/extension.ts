import * as vscode from 'vscode';
import { SearchModal } from './ui/searchModal';
import { IndexManager } from './index/indexManager';
import { SearchHistory } from './history';
import { SearchMode } from './providers/types';
import { createProviders } from './providers/createProviders';
import { migrateSearchSettings } from './settingsMigration';
import { registerSearchTypeValidation } from './settingsGuard';
import { SearchOrderPicker } from './ui/searchOrderPicker';

export async function activate(context: vscode.ExtensionContext) {
  try { await migrateSearchSettings(); }
  catch (error) { console.warn('search++ could not convert older search settings; they remain supported.', error); }
  const indexManager = new IndexManager(context);

  // Build file index asynchronously — don't block activation
  indexManager.buildAll();

  const history = new SearchHistory(context.workspaceState);
  const providers = createProviders(indexManager);
  const modal = new SearchModal(indexManager, history, providers.providers, undefined, context.workspaceState);
  const orderPicker = new SearchOrderPicker();

  context.subscriptions.push(
    registerSearchTypeValidation(),
    indexManager,
    modal,
    providers,
    orderPicker,
    vscode.commands.registerCommand('searchPlusPlus.configure', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:expiracy.search-plus-plus')),
    vscode.commands.registerCommand('searchPlusPlus.arrangeSearchOrder', (scope?: 'user' | 'workspace') => orderPicker.show(scope)),
    vscode.commands.registerCommand('searchPlusPlus.open', () => modal.show()),
    vscode.commands.registerCommand('searchPlusPlus.openFiles', () => modal.show(SearchMode.File)),
    vscode.commands.registerCommand('searchPlusPlus.openText', () => modal.show(SearchMode.Text)),
    vscode.commands.registerCommand('searchPlusPlus.openSymbols', () => modal.show(SearchMode.Symbol)),
    vscode.commands.registerCommand('searchPlusPlus.openCommands', () => modal.show(SearchMode.Command)),
    vscode.commands.registerCommand('searchPlusPlus.preview', () => modal.previewSelectedResult()),
    vscode.commands.registerCommand('searchPlusPlus.findUsages', () => modal.findUsages()),
    vscode.commands.registerCommand('searchPlusPlus.reindex', () => indexManager.reindex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleCaseSensitive', () => modal.toggleCaseSensitive()),
    vscode.commands.registerCommand('searchPlusPlus.toggleRegex', () => modal.toggleRegex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleGitIgnore', () => modal.toggleGitIgnore()),
    vscode.commands.registerCommand('searchPlusPlus.toggleSearchIgnore', () => modal.toggleSearchIgnore()),
    vscode.commands.registerCommand('searchPlusPlus.toggleFuzzySearch', () => modal.toggleFuzzySearch()),
    vscode.commands.registerCommand('searchPlusPlus.toggleMatchWholeWord', () => modal.toggleMatchWholeWord()),
    vscode.commands.registerCommand('searchPlusPlus.autofillPath', () => modal.autofillSelectedPath()),
    vscode.commands.registerCommand('searchPlusPlus.nextTab', () => modal.nextTab()),
    vscode.commands.registerCommand('searchPlusPlus.prevTab', () => modal.prevTab()),
  );
}
   
export function deactivate() {}
