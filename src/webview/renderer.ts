import { MODES, OPTIONS, type ClientMessage, type ViewState, type ViewResult } from '../ui/protocol';
export function mountSearchView(root: HTMLElement, api: { postMessage(message: ClientMessage): void }): () => void {
  root.innerHTML = `<section class="search-panel" aria-label="search++">
    <header><span class="brand">search<span>++</span></span><span id="usage-target"></span><button id="close" title="Close (Escape)" aria-label="Close search"><span class="codicon codicon-close"></span></button></header>
    <nav id="tabs" aria-label="Search modes" role="tablist"></nav>
    <div class="inputs"><div class="query-row"><span class="codicon codicon-search" aria-hidden="true"></span><input id="query" aria-label="Search query" autocomplete="off" spellcheck="false" placeholder="Search everywhere…"><div id="options" role="group" aria-label="Search options"></div></div>
    <div class="scope-row"><label for="scope">in:</label><input id="scope" aria-label="In files and folders" autocomplete="off" spellcheck="false" placeholder="Files / folders to include (e.g. src/**, **/*.ts)"><button id="scope-regex" title="Use path regex" aria-label="Use path regex" aria-pressed="false"><span class="codicon codicon-regex"></span></button></div>
    <p id="scope-hint">Glob patterns · comma-separated · leave blank for the workspace</p></div>
    <div id="status" role="status" aria-live="polite"></div><div id="error" role="alert" hidden></div>
    <div id="results" role="listbox" aria-label="Search results"></div>
    <footer><span><kbd>↑↓</kbd> navigate <kbd>Enter</kbd> open <kbd>Tab</kbd> fields</span><span><kbd>Shift Tab</kbd> next mode <kbd>Ctrl Tab</kbd> previous</span></footer>
  </section>`;
  const query = root.querySelector<HTMLInputElement>('#query')!;
  const scope = root.querySelector<HTMLInputElement>('#scope')!;
  function button(icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.title = label; button.setAttribute('aria-label', label);
    const glyph = document.createElement('span'); glyph.className = `codicon codicon-${icon}`; glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph); button.addEventListener('click', action);
    button.addEventListener('mousedown', event => event.preventDefault());
    return button;
  }
  for (const mode of MODES) {
    const tab = button(mode.icon, mode.label, () => api.postMessage({ type: 'mode', mode: mode.id }));
    tab.append(document.createTextNode(mode.label)); tab.dataset.mode = mode.id;
    tab.setAttribute('role', 'tab'); root.querySelector('#tabs')!.append(tab);
  }
  for (const option of OPTIONS) {
    const toggle = button(option.icon, option.label, () => api.postMessage({ type: 'toggle', option: option.key }));
    toggle.dataset.option = option.key; root.querySelector('#options')!.append(toggle);
  }
  root.querySelector('#scope-regex')!.addEventListener('mousedown', event => event.preventDefault());
  root.querySelector('#scope-regex')!.addEventListener('click', () => api.postMessage({ type: 'toggle', option: 'scopeRegex' }));
  root.querySelector('#close')!.addEventListener('click', () => api.postMessage({ type: 'close' }));
  const list = root.querySelector<HTMLElement>('#results')!;
  let inputVersion = 0;
  let results: ViewResult[] = [];
  let selectedId: string | undefined;
  function select(id: string | undefined, scroll = false) {
    selectedId = id;
    for (const row of list.querySelectorAll<HTMLElement>('[role=option]')) {
      const active = row.dataset.id === id;
      row.setAttribute('aria-selected', String(active));
      if (active) {
        query.setAttribute('aria-activedescendant', row.id);
        scope.setAttribute('aria-activedescendant', row.id);
        if (scroll) row.scrollIntoView?.({ block: 'nearest' });
      }
    }
    if (id) api.postMessage({ type: 'select', id });
    else { query.removeAttribute('aria-activedescendant'); scope.removeAttribute('aria-activedescendant'); }
  }
  function render(state: ViewState) {
    if ((state.inputVersion ?? 0) < inputVersion) return;
    if (query.value !== state.query) query.value = state.query;
    if (scope.value !== state.scope) scope.value = state.scope;
    query.placeholder = state.mode === 'usages' ? 'Filter usages by text or path…' : `Search ${MODES.find(mode => mode.id === state.mode)?.label.toLowerCase() ?? 'everywhere'}…`;
    root.querySelector('#usage-target')!.textContent = state.mode === 'usages' && state.usageName ? `Usages of ${state.usageName}` : '';
    root.querySelector('#scope-regex')!.setAttribute('aria-pressed', String(state.scopeRegex));
    root.querySelector('#scope-hint')!.textContent = state.mode === 'command' ? 'Commands are global; the path filter applies to file-backed results.' : state.scopeRegex ? 'Path regex · matched against workspace-relative paths using / separators' : 'Glob patterns · comma-separated · leave blank for the workspace';
    scope.placeholder = state.scopeRegex ? 'Path regex (e.g. ^src/.*\\.tsx?$)' : 'Files / folders to include (e.g. src/**, **/*.ts)';
    for (const tab of root.querySelectorAll<HTMLElement>('[data-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-option]')) toggle.setAttribute('aria-pressed', String(state.options[toggle.dataset.option as keyof typeof state.options] ?? false));
    root.querySelector('#status')!.textContent = state.status;
    const error = root.querySelector<HTMLElement>('#error')!;
    error.textContent = state.error ?? ''; error.hidden = !state.error;
    list.setAttribute('aria-busy', String(state.busy));
    results = state.results;
    list.replaceChildren();
    let section: string | undefined;
    for (const [index, result] of results.entries()) {
      if (result.section && result.section !== section) {
        section = result.section;
        const heading = document.createElement('h2'); heading.textContent = section; list.append(heading);
      }
      const row = document.createElement('div'); row.className = 'result'; row.id = `result-${index}`;
      row.dataset.id = result.id; row.setAttribute('role', 'option');
      const icon = document.createElement('span'); icon.className = `codicon codicon-${result.icon}`; icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div'); text.className = 'result-text';
      const label = document.createElement('span'); label.className = 'result-label'; label.textContent = result.label;
      const description = document.createElement('span'); description.className = 'result-description'; description.textContent = result.description;
      text.append(label, description);
      if (result.detail) { const detail = document.createElement('div'); detail.className = 'result-detail'; detail.textContent = result.detail; text.append(detail); }
      row.append(icon, text);
      const actions = document.createElement('div'); actions.className = 'result-actions';
      if (result.canFindUsages) {
        const usages = button('references', 'Find Usages (Shift+F12)', () => api.postMessage({ type: 'usages', id: result.id }));
        usages.dataset.action = 'usages'; actions.append(usages);
      }
      if (result.canOpen) actions.append(button('split-horizontal', 'Open to the side (Alt+Enter)', () => api.postMessage({ type: 'open', id: result.id, beside: true })));
      if (result.recent) actions.append(button('close', 'Remove from recent files', () => api.postMessage({ type: 'removeRecent', id: result.id })));
      actions.addEventListener('click', event => event.stopPropagation());
      row.append(actions); list.append(row);
      row.addEventListener('click', () => { if (result.canOpen) api.postMessage({ type: 'open', id: result.id }); });
    }
    select(results.some(result => result.id === selectedId) ? selectedId : results.find(result => result.canOpen)?.id);
  }
  const onMessage = (event: MessageEvent) => { if (event.data?.type === 'state') render(event.data); };
  window.addEventListener('message', onMessage);
  const onInput = () => { inputVersion++; api.postMessage({ type: 'input', query: query.value, scope: scope.value, inputVersion }); };
  query.addEventListener('input', onInput); scope.addEventListener('input', onInput);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); api.postMessage({ type: 'close' }); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const available = results.filter(result => result.canOpen);
      const index = available.findIndex(result => result.id === selectedId);
      if (available.length) select(available[(index + (event.key === 'ArrowDown' ? 1 : available.length - 1)) % available.length].id, true);
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && selectedId && (event.target === query || event.target === scope)) {
      event.preventDefault(); api.postMessage(event.altKey ? { type: 'open', id: selectedId, beside: true } : { type: 'open', id: selectedId });
    }
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      (document.activeElement === query ? scope : query).focus();
    }
  };
  root.addEventListener('keydown', onKey);
  const onFocus = () => api.postMessage({ type: 'focus', focused: true });
  const onBlur = () => api.postMessage({ type: 'focus', focused: false });
  window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
  query.focus();
  api.postMessage({ type: 'ready' });
  return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); window.removeEventListener('message', onMessage); root.removeEventListener('keydown', onKey); query.removeEventListener('input', onInput); scope.removeEventListener('input', onInput); };
}
