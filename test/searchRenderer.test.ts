// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { mountSearchView } from '../src/webview/renderer';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

test('two visible inputs send the query and file/folder scope together', () => {
  const root = document.createElement('main'); document.body.append(root);
  const postMessage = vi.fn();
  dispose = mountSearchView(root, { postMessage });
  const query = root.querySelector<HTMLInputElement>('#query')!;
  const scope = root.querySelector<HTMLInputElement>('#scope')!;
  expect(query).toBeTruthy(); expect(scope).toBeTruthy();
  query.value = 'greet'; scope.value = 'src/**';
  scope.dispatchEvent(new Event('input', { bubbles: true }));
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'input', query: 'greet', scope: 'src/**', inputVersion: 1 });
});

test('Tab switches between fields while Shift+Tab and Ctrl+Tab are left to mode keybindings', () => {
  const root = document.createElement('main'); document.body.append(root);
  dispose = mountSearchView(root, { postMessage: vi.fn() });
  const query = root.querySelector<HTMLInputElement>('#query')!;
  const scope = root.querySelector<HTMLInputElement>('#scope')!;
  const press = (field: HTMLElement, modifiers = {}) => { const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...modifiers }); field.dispatchEvent(event); return event; };
  expect(press(query).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(scope);
  expect(press(scope).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(query);
  expect(press(query, { shiftKey: true }).defaultPrevented).toBe(false);
  expect(press(query, { ctrlKey: true }).defaultPrevented).toBe(false);
});

test('provider text is rendered safely and keyboard navigation opens a result ID', () => {
  const root = document.createElement('main'); document.body.append(root);
  const postMessage = vi.fn(); dispose = mountSearchView(root, { postMessage });
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', mode: 'symbol', query: 'greet', scope: '', scopeRegex: false, options: {}, status: '2 results', busy: false, results: [
    { id: 'a', label: '<img src=x onerror=alert(1)>', description: 'a.ts', icon: 'symbol-function', canOpen: true, canFindUsages: true },
    { id: 'b', label: 'greet', description: 'b.ts', icon: 'symbol-function', canOpen: true, canFindUsages: true },
  ] } }));
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('#results')?.textContent).toContain('<img src=x onerror=alert(1)>');
  root.querySelector('#query')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  root.querySelector('#query')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'open', id: 'b' });
});

test('mode, option, and path-regex controls send distinct actions; symbols offer Find Usages', () => {
  const root = document.createElement('main'); document.body.append(root);
  const postMessage = vi.fn(); dispose = mountSearchView(root, { postMessage });
  root.querySelector<HTMLButtonElement>('[data-mode=symbol]')!.click();
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'mode', mode: 'symbol' });
  root.querySelector<HTMLButtonElement>('[data-option=useRegex]')!.click();
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'toggle', option: 'useRegex' });
  root.querySelector<HTMLButtonElement>('#scope-regex')!.click();
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'toggle', option: 'scopeRegex' });
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', mode: 'symbol', query: '', scope: '', scopeRegex: true, options: { useRegex: false }, results: [{ id: 'a', label: 'greet', description: 'a.ts', icon: 'symbol-function', canOpen: true, canFindUsages: true }], busy: false, status: '1 result' } }));
  root.querySelector<HTMLButtonElement>('[data-action=usages]')!.click();
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'usages', id: 'a' });
  expect(root.querySelector('#scope-regex')?.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('[data-option=useRegex]')?.getAttribute('aria-pressed')).toBe('false');
});

test('older host messages cannot overwrite typing or show stale results', () => {
  const root = document.createElement('main'); document.body.append(root);
  dispose = mountSearchView(root, { postMessage: vi.fn() });
  const query = root.querySelector<HTMLInputElement>('#query')!;
  query.value = 'g'; query.dispatchEvent(new Event('input'));
  query.value = 'greet'; query.dispatchEvent(new Event('input'));
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', inputVersion: 1, mode: 'file', query: 'g', scope: '', scopeRegex: false, options: {}, results: [{ id: 'a', label: 'old result', description: 'old.ts', icon: 'file', canOpen: true }], status: '1 result', busy: false } }));
  expect(query.value).toBe('greet');
  expect(root.querySelector('#results')?.textContent).not.toContain('old result');
});
