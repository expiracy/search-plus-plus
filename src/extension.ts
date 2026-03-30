import * as vscode from 'vscode';
import { SearchModal } from './ui/searchModal';
import { IndexManager } from './index/indexManager';
import { SearchHistory } from './history';
import { SearchMode } from './providers/types';

export function activate(context: vscode.ExtensionContext) {
  const indexManager = new IndexManager(context);

  // Build file index asynchronously — don't block activation
  indexManager.buildAll();

  const history = new SearchHistory(context.workspaceState);
  const modal = new SearchModal(indexManager, history);

  context.subscriptions.push(
    indexManager,
    modal,
    vscode.commands.registerCommand('searchPlusPlus.open', () => modal.show()),
    vscode.commands.registerCommand('searchPlusPlus.openFiles', () => modal.show(SearchMode.File)),
    vscode.commands.registerCommand('searchPlusPlus.openText', () => modal.show(SearchMode.Text)),
    vscode.commands.registerCommand('searchPlusPlus.openSymbols', () => modal.show(SearchMode.Symbol)),
    vscode.commands.registerCommand('searchPlusPlus.openCommands', () => modal.show(SearchMode.Command)),
    vscode.commands.registerCommand('searchPlusPlus.reindex', () => indexManager.reindex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleCaseSensitive', () => modal.toggleCaseSensitive()),
    vscode.commands.registerCommand('searchPlusPlus.toggleRegex', () => modal.toggleRegex()),
    vscode.commands.registerCommand('searchPlusPlus.toggleGitIgnore', () => modal.toggleGitIgnore()),
    vscode.commands.registerCommand('searchPlusPlus.toggleVscodeExclude', () => modal.toggleVscodeExclude()),
    vscode.commands.registerCommand('searchPlusPlus.toggleFuzzySearch', () => modal.toggleFuzzySearch()),
    vscode.commands.registerCommand('searchPlusPlus.toggleMatchWholeWord', () => modal.toggleMatchWholeWord()),
    vscode.commands.registerCommand('searchPlusPlus.autofillPath', () => modal.autofillSelectedPath()),
    vscode.commands.registerCommand('searchPlusPlus.nextTab', () => modal.nextTab()),
    vscode.commands.registerCommand('searchPlusPlus.prevTab', () => modal.prevTab()),
    vscode.commands.registerCommand('searchPlusPlus.nextSection', () => modal.nextSection()),
    vscode.commands.registerCommand('searchPlusPlus.prevSection', () => modal.prevSection()),
  );
}
   
export function deactivate() {}
