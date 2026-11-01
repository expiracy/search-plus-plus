import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const modifier = process.platform === 'darwin' ? 4 : 2;
let temporary, child, socket, browserSocket;
let hostVersion = process.env.VSCODE_VERSION ?? '';
const pending = new Map();
let nextId = 0;

async function waitFor(read, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch { /* Wait for startup or a UI update. */ }
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function key(key, code, virtualKey, modifiers = 0) {
  const keys = [[1, 'Alt', 'AltLeft', 18], [2, 'Control', 'ControlLeft', 17], [4, 'Meta', 'MetaLeft', 91], [8, 'Shift', 'ShiftLeft', 16]];
  let pressed = 0;
  for (const [mask, name, modifierCode, modifierKey] of keys) {
    if (!(modifiers & mask)) continue;
    pressed |= mask;
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: modifierCode, windowsVirtualKeyCode: modifierKey, modifiers: pressed });
  }
  const event = { key, code, windowsVirtualKeyCode: virtualKey, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  for (const [mask, name, modifierCode, modifierKey] of keys.reverse()) {
    if (!(modifiers & mask)) continue;
    pressed &= ~mask;
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: modifierCode, windowsVirtualKeyCode: modifierKey, modifiers: pressed });
  }
}

async function replaceQuery(value) {
  await key('a', 'KeyA', 65, modifier);
  if (value) await send('Input.insertText', { text: value });
  else await key('Backspace', 'Backspace', 8);
}

async function click(label) {
  const position = await evaluate(`(() => {
    const element = [...document.querySelectorAll('.quick-input-widget [aria-label]')]
      .find(element => (element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.getAttribute('aria-label')?.startsWith(${JSON.stringify(label + ':')})) && element.getBoundingClientRect().width > 0);
    if (!element) throw new Error('Missing visible control: ' + ${JSON.stringify(label)});
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !element.contains(hit)) throw new Error('Control is clipped or covered: ' + ${JSON.stringify(label)});
    return { x, y };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...position });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...position });
  await pause(300);
}

async function expectText(text) {
  return waitFor(async () => { const state = await popup(); return state.visible && state.text?.includes(text) && state; }, text);
}

async function expectFocused(description) {
  const state = await popup();
  assert.equal(state.focused, true, `${description}: ${JSON.stringify(state)}`);
}

async function closeSettings() {
  await key('w', 'KeyW', 87, modifier);
  await waitFor(async () => evaluate(`!!document.activeElement?.closest('.monaco-editor') && !document.activeElement.closest('.settings-editor')`), 'Settings to close and return focus to the code editor');
}

async function controlState(selector) {
  return evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    if (!element) return undefined;
    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, checked: element.getAttribute('aria-checked') };
  })()`);
}

async function clickSelector(selector) {
  const { x, y } = await waitFor(() => controlState(selector), `an interactive ${selector}`);
  const position = { x, y };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...position });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...position });
  await pause(300);
}

async function popup() {
  return evaluate(`(() => {
    const widget = [...document.querySelectorAll('.quick-input-widget')].find(element => element.getBoundingClientRect().height > 0);
    const input = [...(widget?.querySelectorAll('input') ?? [])].find(element => element.getBoundingClientRect().width > 0);
    return { visible: !!widget?.getBoundingClientRect().height, value: input?.value,
      selectionStart: input?.selectionStart, selectionEnd: input?.selectionEnd,
      focused: input === document.activeElement, text: widget?.innerText,
      title: widget?.querySelector('.quick-input-title')?.textContent,
      active: document.activeElement?.getAttribute('aria-label'),
      activeTag: document.activeElement?.tagName, activeRole: document.activeElement?.getAttribute('role'),
      activeClass: document.activeElement?.className, inputDisabled: input?.disabled };
  })()`);
}

async function launch() {
  if (process.env.SEARCHPP_UI_PORT) return Number(process.env.SEARCHPP_UI_PORT);
  temporary = await mkdtemp(path.join(tmpdir(), 'searchpp-ui-'));
  const workspace = path.join(temporary, 'workspace');
  await cp(path.join(repository, 'test/fixtures/mock-project'), workspace, { recursive: true });
  await writeFile(path.join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' }, include: ['src/**/*.ts'] }));
  await writeFile(path.join(workspace, 'src/audit-consumer.ts'), "import { greet } from './index';\nexport const message = greet();\n");
  await writeFile(path.join(workspace, 'src/audit-search.txt'), 'AUDIT_NEEDLE\naudit_needle\nAUDIT_NEEDLE_suffix\nprice 42\nprice 100\n');
  for (const name of ['ignored-git', 'ignored-search', 'excluded-always']) {
    await mkdir(path.join(workspace, name), { recursive: true });
    await writeFile(path.join(workspace, name, `audit-hidden-${name}.txt`), 'AUDIT_FILTER_MARKER\n');
  }
  const gitignore = await readFile(path.join(workspace, '.gitignore'), 'utf8').catch(() => '');
  await writeFile(path.join(workspace, '.gitignore'), gitignore + '\nignored-git/\n');
  const searchignore = await readFile(path.join(workspace, '.searchignore'), 'utf8').catch(() => '');
  await writeFile(path.join(workspace, '.searchignore'), searchignore + '\nignored-search/\n');
  const user = path.join(temporary, 'user-data/User');
  await mkdir(user, { recursive: true });
  await writeFile(path.join(user, 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'window.zoomLevel': 0,
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden', 'editor.minimap.enabled': false,
    'searchPlusPlus.shortcutPreset': 'vscode', 'searchPlusPlus.searchDelay': 20,
    'searchPlusPlus.excludedPaths': ['**/excluded-always/**'],
  }));
  const extensions = path.join(temporary, 'extensions');
  const helper = path.join(extensions, 'local.popup-test-0.0.1');
  await mkdir(helper, { recursive: true });
  await writeFile(path.join(helper, 'package.json'), JSON.stringify({ name: 'popup-test', publisher: 'local', version: '0.0.1', engines: { vscode: '^1.96.0' }, main: 'extension.js', activationEvents: ['onStartupFinished'],
    contributes: { commands: [{ command: 'searchppAudit.confirmCommand', title: 'UI Audit Command' }] },
  }));
  await writeFile(path.join(helper, 'extension.js'), `const vscode = require('vscode'); const fs = require('fs');
    exports.activate = async () => {
      vscode.commands.registerCommand('searchppAudit.confirmCommand', () => fs.writeFileSync(${JSON.stringify(path.join(temporary, 'command-ran.json'))}, 'true'));
      const reportConfiguration = () => fs.writeFileSync(${JSON.stringify(path.join(temporary, 'configuration.json'))}, JSON.stringify({ rememberLastSearch: vscode.workspace.getConfiguration('searchPlusPlus').get('rememberLastSearch') }));
      vscode.workspace.onDidChangeConfiguration(reportConfiguration); reportConfiguration();
      await vscode.window.showTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'src/utils.ts'));
      await vscode.extensions.getExtension('expiracy.search-plus-plus').activate();
      if (${JSON.stringify(process.env.SEARCHPP_UI_TRACE === '1')}) await vscode.commands.executeCommand('workbench.action.toggleKeybindingsLog');
      await vscode.extensions.getExtension('vscode.typescript-language-features').activate();
      for (let attempt = 0; attempt < 40; attempt++) {
        const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'greet');
        if (symbols?.some(symbol => symbol.name.includes('greet'))) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      fs.writeFileSync(${JSON.stringify(path.join(temporary, 'ready.json'))}, JSON.stringify({ version: vscode.version }));
    };`);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  let executable = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executable && process.env.VSCODE_VERSION) {
    const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');
    executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION);
  }
  executable ??= process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : 'code';
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [workspace, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--new-window', '--wait', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-gpu',
    `--user-data-dir=${path.join(temporary, 'user-data')}`, `--extensions-dir=${extensions}`,
    `--extensionDevelopmentPath=${repository}`, `--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  child.on('error', error => { console.error(error.message); });
  child.stderr.on('data', () => {});
  const ready = await waitFor(async () => JSON.parse(await readFile(path.join(temporary, 'ready.json'), 'utf8')), 'the isolated extension host', 45000);
  hostVersion = ready.version;
  return port;
}

try {
  const port = await launch();
  const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
    .find(target => target.type === 'page' && target.url.includes('workbench')), 'the VS Code renderer');
  browserSocket = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (process.env.SEARCHPP_UI_TRACE === '1' && result.method === 'Runtime.consoleAPICalled') {
      const message = result.params.args.map(arg => arg.value ?? '').join(' ');
      if (message.includes('Keybinding')) console.log(message);
    }
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id); clearTimeout(request.timer);
    result.error ? request.reject(new Error(JSON.stringify(result.error))) : request.resolve(result.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  if (process.env.SEARCHPP_UI_TRACE === '1') await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.bringToFront');
  await key('Escape', 'Escape', 27);
  await key('p', 'KeyP', 80, modifier);
  await waitFor(async () => (await popup()).visible, 'the Files popup');
  await replaceQuery('utils');
  await waitFor(async () => (await popup()).text?.includes('utils.ts'), 'file results');
  await click('Text');
  let state = await popup();
  assert.equal(state.focused, true, `clicking a tab must focus the search input: ${JSON.stringify(state)}`);
  await replaceQuery('hello world');
  await waitFor(async () => (await popup()).text?.includes('hello world'), 'typing after a tab click');
  assert.equal((await popup()).value, 'hello world');
  console.log('PASS: tab clicks keep focus and typing inside search');

  await replaceQuery('AUDIT_NEEDLE'); await expectText('Text: 3 matches');
  const alt = process.platform === 'darwin' ? 'Option' : 'Alt';
  await click(`Case Sensitive (${alt}+C)`); await expectText('Text: 2 matches');
  await expectFocused('case-sensitive toggle keeps input focus');
  await click(`Match Whole Word (${alt}+W)`); await expectText('Text: 1 matches');
  await expectFocused('whole-word toggle keeps input focus');
  await click(`Case Sensitive (${alt}+C)`); await expectText('Text: 2 matches');
  await click(`Match Whole Word (${alt}+W)`); await expectText('Text: 3 matches');
  await click(`Regex (${alt}+R)`); await replaceQuery('price \\d+'); await expectText('Text: 2 matches');
  await replaceQuery('['); await expectText('Search failed');
  await replaceQuery('price \\d+'); await expectText('Text: 2 matches');
  await click(`Regex (${alt}+R)`);
  console.log('PASS: case, whole-word, regex, invalid-regex recovery and toggle focus');

  await click('Files'); await replaceQuery('utl'); await expectText('No results found');
  await click(`Fuzzy Search (${alt}+F)`); await expectText('utils.ts');
  await expectFocused('fuzzy toggle keeps input focus');
  await click(`Fuzzy Search (${alt}+F)`); await expectText('No results found');
  await replaceQuery('audit-hidden'); await expectText('No results found');
  await click(`Exclude Git Ignored (${alt}+G)`); await expectText('audit-hidden-ignored-git.txt');
  await click(`Exclude Search Ignored (${alt}+S)`); await expectText('audit-hidden-ignored-search.txt');
  assert.ok(!(await popup()).text.includes('audit-hidden-excluded-always.txt'));
  await click(`Exclude Git Ignored (${alt}+G)`); await click(`Exclude Search Ignored (${alt}+S)`); await expectText('No results found');
  console.log('PASS: fuzzy matching, both ignore toggles and permanent exclusions');

  await replaceQuery('utils.ts:2:3'); await expectText('utils.ts');
  const queryLength = 'utils.ts:2:3'.length;
  const editorWasAtTarget = await evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`);
  assert.equal(editorWasAtTarget, false, 'the preview target differs from the initial editor position');
  for (let step = 0; step < 3; step++) await key('ArrowLeft', 'ArrowLeft', 37);
  await waitFor(async () => (await popup()).selectionStart === queryLength - 3, 'Left Arrow to move inside the query');
  await key('ArrowRight', 'ArrowRight', 39);
  await waitFor(async () => (await popup()).selectionStart === queryLength - 2, 'Right Arrow to move inside the query without preview');
  assert.equal(await evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`), false);
  await key('ArrowRight', 'ArrowRight', 39); await key('ArrowRight', 'ArrowRight', 39);
  await waitFor(async () => (await popup()).selectionStart === queryLength, 'the caret to reach the end');
  assert.equal(await evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`), false);
  await key('ArrowRight', 'ArrowRight', 39); await pause(300);
  await expectFocused('Right Arrow preview keeps input focus');
  await waitFor(async () => evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`), 'Right Arrow at the end to preview');
  await replaceQuery('utils.ts:1:1'); await expectText('utils.ts');
  await key('a', 'KeyA', 65, modifier);
  await waitFor(async () => { const state = await popup(); return state.selectionStart === 0 && state.selectionEnd === queryLength; }, 'Select All in the query');
  await key('ArrowRight', 'ArrowRight', 39);
  await waitFor(async () => { const state = await popup(); return state.selectionStart === queryLength && state.selectionEnd === queryLength; }, 'Right Arrow to collapse the selection');
  assert.ok(await evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`), 'collapsing selected text does not preview');
  await key('ArrowRight', 'ArrowRight', 39);
  await waitFor(async () => evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 1, Col 1')`), 'a second Right Arrow to preview');
  await replaceQuery('utils.ts:1:2'); await expectText('utils.ts');
  for (let step = 0; step < 3; step++) await key('ArrowLeft', 'ArrowLeft', 37);
  await key('ArrowRight', 'ArrowRight', 39, modifier);
  await waitFor(async () => evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 1, Col 2')`), 'Cmd/Ctrl+Right to preview from inside the query');
  await replaceQuery('utils.ts:2:3'); await expectText('utils.ts');
  await click(`Preview (Right Arrow at query end or ${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Right)`); await expectFocused('eye preview keeps input focus');
  await key('Enter', 'Enter', 13);
  await waitFor(async () => !(await popup()).visible, 'Enter to close search');
  assert.ok(await evaluate(String.raw`document.body.innerText.replace(/\s+/g, ' ').includes('Ln 2, Col 3')`), 'Enter opens the requested line and column');
  await key('p', 'KeyP', 80, modifier); await expectText('Recent');
  assert.equal((await popup()).value, '', 'remember-last-search defaults off');
  console.log('PASS: Right Arrow, eye preview, Enter, line/column and recent history');

  await click('Folders'); await replaceQuery('components'); await expectText('components');
  await expectFocused('Folders keeps input focus');
  await click('Symbols'); await replaceQuery('greet');
  await waitFor(async () => { const state = await popup(); return state.text?.includes('src/index.ts') && state.text.includes('greet') && state; }, 'TypeScript symbol search');
  await key('F12', 'F12', 123, 8); await expectText('Usages of greet');
  await replaceQuery('audit-consumer'); await expectText('audit-consumer.ts');
  await key('ArrowRight', 'ArrowRight', 39); await expectFocused('usage preview keeps input focus');
  await clickSelector('.quick-input-widget .codicon-quick-input-back');
  await expectText('Symbols'); await expectFocused('Back restores typing focus');
  assert.equal((await popup()).value, 'greet');
  if (Number(hostVersion.split('.')[1]) < 109) await key('F12', 'F12', 123, 8);
  else await key('Enter', 'Enter', 13, modifier);
  await expectText('Usages of greet');
  await replaceQuery(''); await expectText('Search for a symbol');
  console.log('PASS: folders, real TypeScript symbols, usages, filtering, Back, Shift+F12 and clearing');

  await click('Everything'); await replaceQuery('greet'); await expectText('Symbols');
  for (let step = 0; step < 20; step++) {
    if (await evaluate(`!!document.querySelector('.quick-input-widget .monaco-list-row.focused .codicon-symbol-function')`)) break;
    await key('ArrowDown', 'ArrowDown', 40); await pause(100);
  }
  assert.ok(await evaluate(`!!document.querySelector('.quick-input-widget .monaco-list-row.focused .codicon-symbol-function')`), 'a symbol is selected in Everything');
  if (Number(hostVersion.split('.')[1]) >= 109) {
    await key('Enter', 'Enter', 13, modifier); await expectText('Usages of greet');
    await clickSelector('.quick-input-widget .codicon-quick-input-back');
    await waitFor(async () => (await popup()).title?.startsWith('Everything'), 'Back to restore Everything');
    console.log('PASS: Cmd/Ctrl+Enter finds usages from Everything symbols');
  } else {
    await click('Find Usages (Shift+F12)'); await expectText('Usages of greet');
    await clickSelector('.quick-input-widget .codicon-quick-input-back');
    await waitFor(async () => (await popup()).title?.startsWith('Everything'), 'Back to restore Everything');
    console.log('PASS: legacy Everything symbol action finds usages');
  }

  await click('Commands'); await replaceQuery('search++'); await expectText('search++: Reindex Workspace');
  await expectFocused('Commands keeps input focus');
  if (temporary) {
    await replaceQuery('UI Audit Command'); await expectText('UI Audit Command');
    await key('Enter', 'Enter', 13);
    await waitFor(async () => (await readFile(path.join(temporary, 'command-ran.json'), 'utf8')) === 'true', 'the selected command to execute');
    await waitFor(async () => !(await popup()).visible, 'the command picker to close');
    await key('p', 'KeyP', 80, modifier); await waitFor(async () => (await popup()).visible, 'search after executing a command');
  }
  await click('Everything'); await replaceQuery('utils'); await expectText('Files');
  assert.equal((await popup()).value, 'utils');
  await key('Tab', 'Tab', 9);
  await waitFor(async () => (await popup()).title?.startsWith('Files'), 'Tab to select the Files mode');
  assert.equal((await popup()).value, 'utils', 'Tab keeps the query');
  await click('Open search++ Settings');
  await waitFor(async () => !(await popup()).visible, 'the settings cog to close search');
  await waitFor(async () => evaluate(`!![...document.querySelectorAll('.settings-editor')].find(e => e.getBoundingClientRect().width > 0)`), 'native Settings');
  console.log('PASS: commands, Everything, Tab query retention and native settings cog');

  await key('f', 'KeyF', 70, modifier);
  await replaceQuery('@id:searchPlusPlus.rememberLastSearch');
  await waitFor(async () => evaluate(String.raw`/\b1 Settings? Found\b/i.test(document.body.innerText.replace(/\s+/g, ' '))`), 'the exact setting filter to finish');
  const settingSelector = '[role="checkbox"][aria-label="searchPlusPlus.rememberLastSearch"]';
  await waitFor(() => controlState(settingSelector), 'Remember Last Search checkbox');
  await clickSelector(settingSelector);
  if (temporary) await waitFor(async () => JSON.parse(await readFile(path.join(temporary, 'configuration.json'), 'utf8')).rememberLastSearch === true, 'the setting to reach the extension host');
  await waitFor(async () => (await controlState(settingSelector))?.checked === 'true', 'the enabled checkbox to render');
  await closeSettings();
  await key('p', 'KeyP', 80, modifier); await waitFor(async () => (await popup()).visible, 'Files after changing settings');
  await replaceQuery('audit-search'); await expectText('audit-search.txt');
  await key('Enter', 'Enter', 13); await waitFor(async () => !(await popup()).visible, 'accepted search to close');
  await key('p', 'KeyP', 80, modifier); await expectText('audit-search.txt');
  assert.equal((await popup()).value, 'audit-search', 'the native settings checkbox enables remembered search');
  await click('Open search++ Settings');
  await waitFor(async () => !(await popup()).visible, 'settings to open again');
  await key('f', 'KeyF', 70, modifier);
  await replaceQuery('@id:searchPlusPlus.rememberLastSearch');
  await waitFor(async () => evaluate(String.raw`/\b1 Settings? Found\b/i.test(document.body.innerText.replace(/\s+/g, ' '))`), 'the exact setting filter again');
  await waitFor(() => controlState(settingSelector), 'the remembered-search checkbox again');
  await clickSelector(settingSelector);
  if (temporary) await waitFor(async () => JSON.parse(await readFile(path.join(temporary, 'configuration.json'), 'utf8')).rememberLastSearch === false, 'the disabled setting to reach the extension host');
  await waitFor(async () => (await controlState(settingSelector))?.checked === 'false', 'the disabled checkbox to render');
  await closeSettings();
  await key('p', 'KeyP', 80, modifier); await waitFor(async () => (await popup()).visible, 'a fresh Files search');
  assert.equal((await popup()).value, '');
  console.log('PASS: native Settings checkbox, Enter/reopen persistence and disabling persistence');
  await click('Remove from History');
  await waitFor(async () => !(await popup()).text?.includes('audit-search.txt'), 'the removed recent item to disappear');
  await expectFocused('removing recent history keeps typing in search');
  console.log('PASS: recent-item removal');
  console.log(`search++ popup UI passed on VS Code ${hostVersion || 'attached host'}`);
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) console.error('Last popup state:', JSON.stringify(await popup()));
  if (socket?.readyState === WebSocket.OPEN) {
    const directory = path.join(repository, '.vscode-test');
    await mkdir(directory, { recursive: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(directory, `ui-failure-${hostVersion.replace(/[^\w.-]/g, '_') || 'host'}.png`);
    await writeFile(file, Buffer.from(screenshot.data, 'base64'));
    console.error('UI failure screenshot:', file);
  }
  if (socket?.readyState === WebSocket.OPEN && process.env.SEARCHPP_UI_TRACE === '1') console.error(await evaluate('document.body.innerText.slice(-7000)'));
  throw error;
} finally {
  if (child && browserSocket) {
    const browser = new WebSocket(browserSocket);
    await new Promise(resolve => browser.addEventListener('open', resolve, { once: true }));
    browser.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await pause(500); browser.close();
  }
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([new Promise(resolve => child.once('close', resolve)), pause(2000)]);
  }
  if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
