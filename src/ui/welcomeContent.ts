import { DEFAULT_TAB_ORDER } from '../searchModes';
import { DEFAULT_SECTIONS } from '../providers/types';

export function welcomeContent(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>search++: Welcome &amp; Settings</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background,#181818);color:var(--vscode-editor-foreground,#ddd);font:14px/1.6 var(--vscode-font-family,system-ui)}
main{max-width:1040px;margin:0 auto;padding:40px 32px 56px}button,input,select{font:inherit}button,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--vscode-focusBorder,#59a6ff);outline-offset:3px}
.brand{font-size:16px;font-weight:700;letter-spacing:-.6px;color:var(--vscode-textLink-foreground,#75bfff)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;opacity:.7;margin:24px 0 8px}h1{font-size:36px;line-height:1.15;letter-spacing:-1px;margin:0 0 16px}h2{font-size:18px;line-height:1.35;margin:0 0 8px}p{margin:0 0 16px}.muted{color:var(--vscode-descriptionForeground,#aaa)}.intro{max-width:620px;font-size:16px}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:24px 0 32px}
button{border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--vscode-button-secondaryBackground,#343434);color:var(--vscode-button-secondaryForeground,#eee);padding:7px 12px}button:hover{background:var(--vscode-button-secondaryHoverBackground,#444)}button.primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}button.primary:hover{background:var(--vscode-button-hoverBackground,#1177bb)}button:disabled{opacity:.35;cursor:default}
kbd{font:12px var(--vscode-editor-font-family,monospace);border:1px solid var(--vscode-widget-border,#555);border-radius:3px;padding:2px 5px;background:var(--vscode-textCodeBlock-background,#252525)}.scope-bar{border-block:1px solid var(--vscode-widget-border,#404040);display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:14px 0;margin-bottom:24px}.scope-bar label{font-weight:600}.scope-bar .muted{margin-left:auto;font-size:12px}
select{padding:6px 10px;border:1px solid var(--vscode-dropdown-border,#555);border-radius:3px;background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{border:1px solid var(--vscode-widget-border,#404040);border-radius:8px;padding:24px;background:var(--vscode-sideBar-background,#202020)}.wide{grid-column:1/-1}.card p{font-size:13px}.card-head{display:flex;align-items:start;justify-content:space-between;gap:12px}.reset{font-size:12px;padding:3px 8px;white-space:nowrap}
ol{list-style:none;padding:0;margin:20px 0 0}.order-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--vscode-widget-border,#353535)}.position{width:18px;font-size:11px;color:var(--vscode-descriptionForeground,#aaa)}.order-label{flex:1;font-weight:500}.move{padding:2px 8px;min-width:30px;font-size:16px}.check{display:flex;align-items:start;gap:10px;margin:18px 0 4px;cursor:pointer}.check input{margin-top:5px;accent-color:var(--vscode-checkbox-background,#0e639c)}.check small{display:block;font-size:12px;color:var(--vscode-descriptionForeground,#aaa)}.shortcut-options{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:18px 0 14px}.notice{font-size:12px;color:var(--vscode-descriptionForeground,#aaa);margin-bottom:18px}.footer{margin-top:26px;display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}.status{min-height:24px;margin-top:20px;font-size:13px}.error{color:var(--vscode-errorForeground,#f48771)}
@media(max-width:700px){main{padding:24px 18px}.grid{grid-template-columns:1fr}h1{font-size:30px}.card{padding:18px}.scope-bar .muted{margin-left:0}.card-head{flex-wrap:wrap}}
</style></head><body><main>
<div class="brand">search++</div><div class="eyebrow">Welcome / Your search, your way</div>
<h1>A shortcut to everything.<br>A setup that feels like you.</h1>
<p class="intro muted">Find files, symbols, text, usages, and commands in one popup. Start with <kbd>Shift</kbd> <kbd>Shift</kbd>, then make the search your own.</p>
<div class="actions"><button class="primary" data-action="search">Try search++</button><button data-action="shortcuts">Edit keyboard shortcuts</button><span class="muted">Use Tab to move between search modes.</span></div>
<div class="scope-bar"><label for="scope">Save changes to</label><select id="scope"><option value="user">User defaults</option><option value="workspace">This workspace</option></select><span class="muted">Changes save automatically.</span></div>
<div id="overrides" class="notice" role="note"></div>
<div class="grid">
<section class="card"><div class="card-head"><h2>Arrange your search modes</h2><button class="reset" data-reset="tabOrder">Reset order</button></div><p class="muted">Move your most-used modes closer to the start. The buttons and Tab navigation follow the same order.</p><ol id="tabs" aria-label="Search mode order"></ol></section>
<section class="card"><div class="card-head"><h2>Choose what Everything shows</h2><button class="reset" data-reset="everywhere.sections">Reset groups</button></div><p class="muted">Choose the result groups you want, then put the most useful ones first. This is separate from the mode order.</p><ol id="groups" aria-label="Everything result groups"></ol></section>
<section class="card wide"><h2>Keep your keyboard habits</h2><p class="muted">Open a specific search mode directly, or keep your current shortcuts. Individual user keybindings take precedence over presets.</p><div class="shortcut-options"><label for="preset">Shortcut preset</label><select id="preset"><option value="none">Keep existing shortcuts</option><option value="vscode">VS Code shortcuts</option><option value="intellij">IntelliJ shortcuts</option></select><button data-action="shortcuts">Edit individual shortcuts</button></div><p id="preset-hint" class="notice"></p></section>
<section class="card wide"><h2>Pick up where you left off</h2><label class="check"><input id="remember" type="checkbox"><span>Remember my last search mode<small>Open the last mode used in this workspace, even after restarting VS Code. Direct mode shortcuts still take priority. Search text and usage lookups start fresh.</small></span></label></section>
</div>
<div class="footer"><label class="check"><input id="startup" type="checkbox"><span>Show this page on startup</span></label><button data-action="settings">All search++ settings</button></div>
<div id="status" class="status" role="status" aria-live="polite"></div>
</main><script nonce="${nonce}">
(() => {
  const vscode = acquireVsCodeApi();
  const modes = ${JSON.stringify(DEFAULT_TAB_ORDER)};
  const groups = ${JSON.stringify(DEFAULT_SECTIONS)};
  const labels = {everywhere:'Everything',file:'Files',folder:'Folders',text:'Text',symbol:'Symbols',usages:'Usages',command:'Commands',files:'Files',folders:'Folders',symbols:'Symbols',commands:'Commands'};
  const settingLabels = {tabOrder:'mode order','everywhere.sections':'Everything groups',shortcutPreset:'shortcut preset',rememberLastMode:'remember last mode',showWelcomeOnStartup:'show on startup'};
  const mac = /Mac/i.test(navigator.platform), modifier = mac ? 'Cmd' : 'Ctrl';
  let values = {}, awaiting = true;
  const send = message => { document.getElementById('status').textContent = 'Saving…'; vscode.postMessage(message); };
  const save = (key, value) => send({type:'update',key,value});
  function orderList(id, key, order, enabled) {
    const root = document.getElementById(id);
    root.replaceChildren();
    order.forEach((mode, index) => {
      const row = document.createElement('li'); row.className = 'order-row';
      const number = document.createElement('span'); number.className = 'position'; number.textContent = String(index + 1); row.append(number);
      const label = document.createElement(enabled ? 'label' : 'span'); label.className = 'order-label';
      if (enabled) {
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = enabled.includes(mode); check.dataset.focus = key + mode + 'check';
        check.addEventListener('change', () => save(key, order.filter(item => item === mode ? check.checked : enabled.includes(item))));
        label.append(check, ' ' + labels[mode]);
      } else label.textContent = labels[mode];
      row.append(label);
      [-1,1].forEach(delta => {
        const button = document.createElement('button'); button.className = 'move'; button.type = 'button'; button.textContent = delta < 0 ? '↑' : '↓';
        button.setAttribute('aria-label','Move ' + labels[mode] + (delta < 0 ? ' up' : ' down')); button.dataset.focus = key + mode + delta;
        const selected = enabled || order, position = selected.indexOf(mode);
        button.disabled = position < 0 || position + delta < 0 || position + delta >= selected.length;
        button.addEventListener('click', () => { const changed = [...selected]; [changed[position], changed[position + delta]] = [changed[position + delta], changed[position]]; save(key, changed); });
        row.append(button);
      }); root.append(row);
    });
  }
  function render(state) {
    const focus = document.activeElement && document.activeElement.dataset.focus;
    values = state.values; awaiting = false;
    const scope = document.getElementById('scope'); scope.value = state.scope; scope.options[1].disabled = !state.hasWorkspace;
    orderList('tabs', 'tabOrder', values.tabOrder || modes);
    const enabled = values['everywhere.sections'] || groups;
    orderList('groups', 'everywhere.sections', [...enabled, ...groups.filter(group => !enabled.includes(group))], enabled);
    document.getElementById('preset').value = values.shortcutPreset;
    document.getElementById('remember').checked = values.rememberLastMode;
    document.getElementById('startup').checked = values.showWelcomeOnStartup;
    document.getElementById('preset-hint').textContent = values.shortcutPreset === 'vscode' ? 'Files: ' + modifier + '+P · Symbols: ' + modifier + '+T · Text: ' + modifier + '+Shift+F · Commands: ' + modifier + '+Shift+P. F1 still opens the native Command Palette.' : values.shortcutPreset === 'intellij' ? (mac ? 'Files: Cmd+Shift+O · Symbols: Cmd+O · Text: Cmd+Shift+F · Commands: Cmd+Shift+A.' : 'Files: Ctrl+Shift+N · Symbols: Ctrl+N · Text: Ctrl+Shift+F · Commands: Ctrl+Shift+A.') + ' Other keymap extensions may need explicit user overrides in the shortcut editor.' : 'Shift+Shift opens search++. Use the shortcut editor to assign keys to any search++ command.';
    document.getElementById('overrides').textContent = state.overrides.length ? 'This workspace overrides some user defaults: ' + state.overrides.map(key => settingLabels[key]).join(', ') + '. Your user defaults still apply elsewhere.' : '';
    if (focus) { const restored = document.querySelector('[data-focus="' + CSS.escape(focus) + '"]'); if (restored && !restored.disabled) restored.focus(); }
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'state') { render(message); document.getElementById('status').classList.remove('error'); document.getElementById('status').textContent = message.message || ''; }
    if (message.type === 'error') { document.getElementById('status').classList.add('error'); document.getElementById('status').textContent = message.message; }
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => vscode.postMessage({type:'action',action:button.dataset.action})));
  document.querySelectorAll('[data-reset]').forEach(button => button.addEventListener('click', () => { if (!awaiting) send({type:'reset',key:button.dataset.reset}); }));
  document.getElementById('scope').addEventListener('change', event => vscode.postMessage({type:'scope',scope:event.target.value}));
  document.getElementById('preset').addEventListener('change', event => { if (!awaiting) save('shortcutPreset',event.target.value); });
  document.getElementById('remember').addEventListener('change', event => { if (!awaiting) save('rememberLastMode',event.target.checked); });
  document.getElementById('startup').addEventListener('change', event => { if (!awaiting) save('showWelcomeOnStartup',event.target.checked); });
  vscode.postMessage({type:'ready'});
})();
</script></body></html>`;
}
