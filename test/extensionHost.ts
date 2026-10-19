import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import { GitIgnoreManager } from '../src/gitignore';
import { FileIndex } from '../src/index/fileIndex';
import { TextSearch, type TextMatch } from '../src/index/textSearch';
import { FileProvider } from '../src/providers/fileProvider';
import { UsagesProvider } from '../src/providers/usagesProvider';
import { SearchModal } from '../src/ui/searchModal';
import { ResultPreview } from '../src/ui/resultPreview';
import { SymbolProvider } from '../src/providers/symbolProvider';
import { FolderProvider } from '../src/providers/folderProvider';
import { SearchMode, type SearchOptions, type SearchResult, type SearchProvider } from '../src/providers/types';

const options: SearchOptions = {
  fuzzySearch: false, caseSensitive: false, useRegex: false, matchWholeWord: false,
  excludeGitIgnored: true, excludeSearchIgnored: true,
};

function collect<T>(start: (publish: (results: T[]) => void, fail: (error: unknown) => void) => vscode.Disposable): Promise<T[]> {
  let request: vscode.Disposable | undefined;
  return new Promise<T[]>((resolve, reject) => {
    const timer = setTimeout(() => { request?.dispose(); reject(new Error('Search timed out')); }, 10000);
    const finish = (results: T[]) => { clearTimeout(timer); resolve(results); };
    request = start(finish, error => { clearTimeout(timer); reject(error); });
  }).finally(() => request?.dispose());
}

export async function run(): Promise<void> {
  const rules = new GitIgnoreManager();
  const index = new FileIndex(rules);
  const text = new TextSearch(undefined, rules);
  try {
    const extension = vscode.extensions.getExtension('expiracy.search-plus-plus');
    assert.ok(extension, 'development extension is registered');
    await extension.activate();
    await rules.load();
    await index.build();
    const files = new FileProvider(index);
    const folders = new FolderProvider(index);
    const fuzzy = await collect<SearchResult>((publish, fail) => files.search('idx', { ...options, fuzzySearch: true }, publish, fail));
    assert.ok(fuzzy.some(result => result.description === 'src/index.ts'));
    assert.equal((await collect<SearchResult>((publish, fail) => files.search('output', options, publish, fail))).length, 0);
    assert.ok((await collect<SearchResult>((publish, fail) => files.search('output', { ...options, excludeGitIgnored: false }, publish, fail))).some(result => result.description === 'build/output.js'));
    assert.equal((await collect<SearchResult>((publish, fail) => files.search('guide.pdf', options, publish, fail))).length, 0);
    assert.ok((await collect<SearchResult>((publish, fail) => files.search('guide.pdf', { ...options, excludeSearchIgnored: false }, publish, fail))).length > 0);
    assert.ok((await collect<SearchResult>((publish, fail) => folders.search('scmp', { ...options, fuzzySearch: true }, publish, fail))).some(result => result.description === 'src/components'));
    const matches = await collect<TextMatch>((publish, fail) => text.search('HELLO WORLD', { ...options, maxResults: 200 }, publish, fail));
    assert.ok(matches.some(result => result.relativePath === 'src/index.ts' && result.lineNumber === 1));
    const ignored = await collect<TextMatch>((publish, fail) => text.search('built', { ...options, maxResults: 200 }, publish, fail));
    assert.ok(ignored.every(result => !result.relativePath.startsWith('build/')));
    const root = vscode.workspace.workspaceFolders![0].uri;
    const target = vscode.Uri.joinPath(root, 'semantic.fixture');
    await vscode.workspace.fs.writeFile(target, Buffer.from('greet();\n'));
    await vscode.workspace.openTextDocument(target);
    const reference = new vscode.Location(vscode.Uri.joinPath(root, 'src/index.ts'), new vscode.Range(1, 2, 1, 7));
    const registration = vscode.languages.registerReferenceProvider({ scheme: 'file', pattern: '**/semantic.fixture' }, {
      provideReferences(document, position) {
        assert.equal(document.uri.toString(), target.toString());
        assert.equal(position.character, 1);
        return [reference, reference];
      },
    });
    try {
      const usages = await collect<SearchResult>((publish, fail) => new UsagesProvider(rules).search('', {
        ...options, usageTarget: { uri: target, position: new vscode.Position(0, 1), name: 'greet' },
      }, publish, fail));
      assert.equal(usages.length, 1);
      assert.equal(usages[0].uri?.toString(), reference.uri.toString());
      assert.equal(usages[0].lineNumber, 1);
      assert.equal(usages[0].column, 2);
    } finally { registration.dispose(); }
    await verifyTypeScriptUsages(root, rules);
    await verifyUsageNavigation(root);
    await verifyResultPreview(root);
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('searchPlusPlus.open'));
    assert.ok(commands.includes('searchPlusPlus.preview'));
    for (const command of ['searchPlusPlus.openFiles', 'searchPlusPlus.openText', 'searchPlusPlus.openSymbols', 'searchPlusPlus.openCommands']) {
      const activeEditor = vscode.window.tabGroups.activeTabGroup.activeTab;
      await vscode.commands.executeCommand(command);
      assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab, activeEditor, 'native search does not open an editor tab');
      await vscode.commands.executeCommand('searchPlusPlus.nextTab');
      await vscode.commands.executeCommand('searchPlusPlus.prevTab');
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    }
    await vscode.commands.executeCommand('searchPlusPlus.reindex');
    console.log(`search++ extension-host smoke passed on VS Code ${vscode.version}`);
    if (process.env.SEARCH_PLUS_PLUS_HOST_REPORT) {
      await writeFile(process.env.SEARCH_PLUS_PLUS_HOST_REPORT, JSON.stringify({ version: vscode.version, checks: 'activation, file and folder search, exclusions, ripgrep, semantic references, real TypeScript symbol-to-reference lookup, popup drilldown and clear navigation, mode commands, reusable preview tab and centered matches with both preview settings, reindex' }));
    }
  } finally { text.dispose(); index.dispose(); rules.dispose(); }
}

async function verifyTypeScriptUsages(root: vscode.Uri, rules: GitIgnoreManager): Promise<void> {
  const definition = vscode.Uri.joinPath(root, 'usage-definition.ts');
  const consumer = vscode.Uri.joinPath(root, 'usage-consumer.ts');
  const symbolName = 'searchPlusPlusUsageFixture';
  await vscode.workspace.fs.writeFile(definition, Buffer.from(`export function ${symbolName}(value: number) { return value; }\n`));
  await vscode.workspace.fs.writeFile(consumer, Buffer.from([
    `import { ${symbolName} } from './usage-definition';`,
    `export const actualUsage = ${symbolName}(42);`,
    'function unrelated() {',
    `  const ${symbolName} = (value: number) => value;`,
    `  return ${symbolName}(1);`,
    '}',
  ].join('\n')));
  await vscode.extensions.getExtension('vscode.typescript-language-features')?.activate();
  await vscode.workspace.openTextDocument(consumer);
  await vscode.workspace.openTextDocument(definition);
  await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', definition);
  const symbols = await collect<SearchResult>((publish, fail) => new SymbolProvider(rules).search(symbolName, options, publish, fail));
  const symbol = symbols.find(result => result.uri?.toString() === definition.toString());
  assert.ok(symbol, 'real TypeScript workspace search finds the declaration');
  const usageTarget = { uri: symbol.uri!, position: new vscode.Position(symbol.lineNumber!, symbol.column!), name: symbolName };
  const results = await collect<SearchResult>((publish, fail) => new UsagesProvider(rules).search('', { ...options, usageTarget }, publish, fail));
  assert.ok(results.some(result => result.uri?.toString() === consumer.toString() && result.lineNumber === 1), 'workspace symbol resolves its real cross-file call');
  assert.ok(results.every(result => result.uri?.toString() !== consumer.toString() || (result.lineNumber !== 3 && result.lineNumber !== 4)), 'unrelated same-name symbols are not treated as usages');
  assert.ok(results.every(result => result.alwaysShow), 'native filtering preserves reference results');
}

async function verifyResultPreview(root: vscode.Uri): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench.editor');
  const previous = config.inspect<boolean>('enablePreview')?.workspaceValue;
  const baselineUri = vscode.Uri.joinPath(root, 'src/index.ts');
  const longFile = vscode.Uri.joinPath(root, 'preview-lines.ts');
  await vscode.workspace.fs.writeFile(longFile, Buffer.from(Array.from({ length: 400 }, (_, line) => `// Preview line ${line}`).join('\n')));
  await vscode.window.showTextDocument(baselineUri, { preview: false });
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
  try {
    for (const enabled of [false, true]) {
      await config.update('enablePreview', enabled, vscode.ConfigurationTarget.Workspace);
      const key = (tab: vscode.Tab) => `${tab.group.viewColumn}:${tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : tab.label}`;
      const baseline = new Set(tabs().map(key));
      const preview = new ResultPreview();
      const picker = vscode.window.createQuickPick();
      picker.items = [{ label: 'Preview fixture' }];
      let hidden = false;
      const hideListener = picker.onDidHide(() => { hidden = true; });
      picker.show();
      try {
        const first = vscode.Uri.joinPath(root, 'src/utils.ts');
        const second = vscode.Uri.joinPath(root, 'usage-consumer.ts');
        const position = new vscode.Position(1, 3);
        await preview.show(first, new vscode.Selection(position, position));
        assert.equal(tabs().length, baseline.size + 1, 'first preview adds one tab');
        assert.ok(vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === first.toString() && editor.selection.active.isEqual(position)), 'preview reveals the match position');
        await preview.show(second);
        assert.equal(tabs().length, baseline.size + 1, 'subsequent previews reuse one extra tab');
        assert.ok([...baseline].every(id => tabs().some(tab => key(tab) === id)), 'existing user tabs are preserved');
        await Promise.all([preview.show(first), preview.show(second), preview.show(first)]);
        assert.equal(tabs().length, baseline.size + 1, 'rapid previews still use one extra tab');
        await verifyCenteredLine(preview, longFile, 200);
        const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === longFile.toString())!;
        const nearTop = editor.visibleRanges[0].start.line + 2;
        assert.ok(Math.abs(nearTop - 200) > 2, 'second target is already visible but away from the center');
        await verifyCenteredLine(preview, longFile, nearTop);
        assert.equal(tabs().length, baseline.size + 1, 'centering also reuses the preview tab');
        await preview.show(baselineUri);
        assert.equal(tabs().length, baseline.size, 'existing files reuse their current tabs');
        assert.equal(hidden, false, 'the search popup keeps focus during preview');
        assert.equal(vscode.workspace.getConfiguration('workbench.editor').get('enablePreview'), enabled, 'preview does not change editor settings');
      } finally {
        preview.dispose(); hideListener.dispose(); picker.dispose();
        await vscode.window.tabGroups.close(tabs().filter(tab => !baseline.has(key(tab))), true);
      }
    }
  } finally { await config.update('enablePreview', previous, vscode.ConfigurationTarget.Workspace); }
}

async function verifyCenteredLine(preview: ResultPreview, uri: vscode.Uri, line: number): Promise<void> {
  let check!: () => void;
  let timer: ReturnType<typeof setTimeout>;
  const centered = new Promise<void>((resolve, reject) => {
    check = () => {
      const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
      const range = editor?.visibleRanges[0];
      if (range && Math.abs((range.start.line + range.end.line) / 2 - line) <= 2) resolve();
    };
    timer = setTimeout(() => {
      const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
      const range = editor?.visibleRanges[0];
      reject(new Error(`Preview line ${line} was not centered; visible lines: ${range?.start.line}-${range?.end.line}`));
    }, 5000);
  });
  const listener = vscode.window.onDidChangeTextEditorVisibleRanges(check);
  const position = new vscode.Position(line, 3);
  try { await Promise.all([centered, preview.show(uri, new vscode.Selection(position, position)).then(check)]); }
  finally { clearTimeout(timer!); listener.dispose(); }
}

function nextEvent<T>(event: vscode.Event<T>, matches: (value: T) => boolean): Promise<T> {
  let subscription: vscode.Disposable;
  let timer: ReturnType<typeof setTimeout>;
  return new Promise<T>((resolve, reject) => {
    subscription = event(value => { if (matches(value)) resolve(value); });
    timer = setTimeout(() => reject(new Error('Expected popup state transition did not occur')), 5000);
  }).finally(() => { clearTimeout(timer); subscription.dispose(); });
}

async function verifyUsageNavigation(root: vscode.Uri): Promise<void> {
  type Request = { mode: SearchMode; query: string; options: SearchOptions; publish: (items: SearchResult[]) => void; disposed: boolean };
  const requests = new vscode.EventEmitter<Request>();
  const picker = vscode.window.createQuickPick<SearchResult>();
  const makeProvider = (mode: SearchMode): SearchProvider => ({
    mode,
    search(query, options, publish) {
      const request: Request = { mode, query, options, publish, disposed: false };
      publish(mode === SearchMode.Symbol ? [{
        label: `$(symbol-function) ${query === 'gre' ? 'greet' : query}`, mode: SearchMode.Symbol,
        uri: vscode.Uri.joinPath(root, 'src/index.ts'), lineNumber: 0, column: 16,
      }] : [{ label: 'greet();', mode: SearchMode.Usages, uri: vscode.Uri.joinPath(root, 'src/utils.ts'), lineNumber: 1, column: 2 }]);
      requests.fire(request);
      return { dispose: () => { request.disposed = true; } };
    },
  });
  const modal = new SearchModal({ state: 'ready', onDidChangeState: () => ({ dispose() {} }) } as any,
    { getRecentItems: () => [] } as any, new Map([SearchMode.Symbol, SearchMode.Usages].map(mode => [mode, makeProvider(mode)])), () => picker);
  try {
    modal.show(SearchMode.Usages);
    const symbols = nextEvent(requests.event, request => request.mode === SearchMode.Symbol && request.query === 'gre');
    picker.value = 'gre'; await symbols;
    picker.activeItems = [picker.items[0]];
    const usages = nextEvent(requests.event, request => request.mode === SearchMode.Usages);
    modal.findUsages();
    const selected = await usages;
    assert.equal(picker.value, 'greet', 'nested usage lookup keeps its symbol visible in the input');
    assert.equal(selected.query, '', 'selected symbol name is context rather than a reference filter');
    const cleared = nextEvent(picker.onDidChangeValue, value => value === '');
    picker.value = ''; await cleared;
    assert.equal(selected.disposed, true, 'clearing cancels the reference lookup');
    selected.publish([{ label: 'obsolete reference', mode: SearchMode.Usages }]);
    assert.ok(!picker.title?.includes('Usages of greet'), 'clearing leaves the nested symbol context');
    assert.ok(picker.items.some(item => item.label.includes('Search for a symbol')));
    const fresh = nextEvent(requests.event, request => request.mode === SearchMode.Symbol && request.query === 'other');
    picker.value = 'other';
    assert.equal((await fresh).options.usageTarget, undefined, 'new queries search symbols without the old usage target');
  } finally { modal.dispose(); picker.dispose(); requests.dispose(); }
}
