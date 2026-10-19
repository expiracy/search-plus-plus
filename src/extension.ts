import * as vscode from 'vscode';
import { SearchView } from './ui/searchView';
import { IndexManager } from './index/indexManager';
import { SearchHistory } from './history';
import { SearchMode } from './providers/types';
import { createProviders } from './providers/createProviders';

export function activate(context: vscode.ExtensionContext) {
  const indexManager = new IndexManager(context);

  // Build file index asynchronously — don't block activation
  indexManager.buildAll();

  const history = new SearchHistory(context.workspaceState);
  const providers = createProviders(indexManager);
  const view = new SearchView(context.extensionUri, indexManager, history, providers.providers);

  context.subscriptions.push(
    indexManager,
    view,
    providers,
    vscode.commands.registerCommand('searchPlusPlus.open', () => view.show()),
    vscode.commands.registerCommand('searchPlusPlus.openFiles', () => view.show(SearchMode.File)),
    vscode.commands.registerCommand('searchPlusPlus.openText', () => view.show(SearchMode.Text)),
    vscode.commands.registerCommand('searchPlusPlus.openSymbols', () => view.show(SearchMode.Symbol)),
    vscode.commands.registerCommand('searchPlusPlus.openCommands', () => view.show(SearchMode.Command)),
    vscode.commands.registerCommand('searchPlusPlus.findUsages', () => view.findUsages()),
    vscode.commands.registerCommand('searchPlusPlus.reindex', () => indexManager.reindex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleCaseSensitive', () => view.toggleCaseSensitive()),
    vscode.commands.registerCommand('searchPlusPlus.toggleRegex', () => view.toggleRegex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleGitIgnore', () => view.toggleGitIgnore()),
    vscode.commands.registerCommand('searchPlusPlus.toggleSearchIgnore', () => view.toggleSearchIgnore()),
    vscode.commands.registerCommand('searchPlusPlus.toggleFuzzySearch', () => view.toggleFuzzySearch()),
    vscode.commands.registerCommand('searchPlusPlus.toggleMatchWholeWord', () => view.toggleMatchWholeWord()),
    vscode.commands.registerCommand('searchPlusPlus.autofillPath', () => view.autofillSelectedPath()),
    vscode.commands.registerCommand('searchPlusPlus.nextTab', () => view.nextTab()),
    vscode.commands.registerCommand('searchPlusPlus.prevTab', () => view.prevTab()),
  );
}
   
export function deactivate() {}
