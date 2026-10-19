import type { IndexManager } from '../index/indexManager';
import { SearchMode, type SearchProvider } from './types';
import { FileProvider } from './fileProvider';
import { TextProvider } from './textProvider';
import { FolderProvider } from './folderProvider';
import { SymbolProvider } from './symbolProvider';
import { CommandProvider } from './commandProvider';
import { EverywhereProvider } from './everywhereProvider';

/** Construct providers at activation; the UI only needs their search contract. */
export function createProviders(index: IndexManager) {
  const files = new FileProvider(index.fileIndex);
  const folders = new FolderProvider(index.fileIndex);
  const text = new TextProvider(index.textSearch);
  const symbols = new SymbolProvider(index.gitIgnore);
  const commands = new CommandProvider();
  const everywhere = new EverywhereProvider(files, folders, text, symbols, commands);
  return {
    providers: new Map<SearchMode, SearchProvider>([
      [SearchMode.File, files], [SearchMode.Folder, folders], [SearchMode.Text, text],
      [SearchMode.Symbol, symbols], [SearchMode.Command, commands], [SearchMode.Everywhere, everywhere],
    ]),
    dispose: () => commands.dispose(),
  };
}
