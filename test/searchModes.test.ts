import { expect, test } from 'vitest';
import { getSearchConfiguration, getSearchTabs, getTabOrder } from '../src/searchModes';

function configuration(user: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
  } as any;
}

test('one readable Tabs list controls both visible tabs and their order', () => {
  expect(getSearchTabs(configuration({ tabs: ['Text', 'Files'] }))).toEqual(['text', 'file']);
});

test('unchecking an enabled search hides its tab', () => {
  expect(getSearchTabs(configuration({ enabledSearches: { Symbols: false } }))).toEqual([
    'everywhere', 'file', 'folder', 'text', 'command',
  ]);
});

test('Everything tab sources controls both the source and its corresponding tab', () => {
  expect(getSearchTabs(configuration({ everythingTabSources: { Symbols: false } }))).toEqual([
    'everywhere', 'file', 'folder', 'text', 'command',
  ]);
});

test('the renamed Tab order takes precedence over the previous Search order', () => {
  expect(getSearchTabs(configuration({ tabOrder: ['Commands', 'Everything', 'Files'], searchOrder: ['Text', 'Files'] })))
    .toEqual(['command', 'everywhere', 'file', 'folder', 'text', 'symbol']);
});

test('the Everything switch hides only the combined tab', () => {
  const config = getSearchConfiguration(configuration({ showEverythingTab: false }));
  expect(config.tabs).toEqual(['file', 'folder', 'text', 'symbol', 'command']);
  expect(config.enabled).toEqual(['file', 'folder', 'text', 'symbol', 'command']);
});

test('shared order retains the saved position of a disabled search', () => {
  const values = { searchOrder: ['Commands', 'Symbols', 'Files', 'Everything', 'Text', 'Folders'], enabledSearches: { Symbols: false } };
  const config = configuration(values);
  expect(getSearchTabs(config)).toEqual(['command', 'file', 'everywhere', 'text', 'folder']);
  values.enabledSearches.Symbols = true;
  expect(getSearchTabs(config)).toEqual(['command', 'symbol', 'file', 'everywhere', 'text', 'folder']);
});

test('the opening dropdown can select the last-used tab', () => {
  expect(getSearchConfiguration(configuration({ whenSearchOpens: 'last' })).opening).toBe('last');
});

test('a fixed opening choice replaces the older remember checkbox', () => {
  expect(getSearchConfiguration(configuration({ rememberLastMode: true, whenSearchOpens: 'file' })).opening).toBe('file');
});

test('platform defaults apply before User and Workspace overrides', () => {
  const defaults: Record<string, unknown> = {
    enabledSearches: { Folders: false }, showEverythingTab: false, searchOrder: ['Text', 'Files'], whenSearchOpens: 'last',
  };
  const config = getSearchConfiguration({
    get: (_key: string, fallback: unknown) => fallback,
    inspect: (key: string) => ({ defaultValue: defaults[key] }),
  } as any);
  expect(config.tabs).toEqual(['text', 'file', 'symbol', 'command']);
  expect(config.opening).toBe('last');
});

test('existing workspace preferences take precedence over a new user Tabs list', () => {
  expect(getSearchTabs(configuration({ tabs: ['Commands', 'Files'] }, {
    tabOrder: ['symbol', 'text'], visibleTabs: ['symbol', 'text'],
  }))).toEqual(['symbol', 'text']);
});

test('a new Tabs list overrides the older settings at the same scope', () => {
  expect(getSearchTabs(configuration({}, {
    tabs: ['Folders', 'Files'], tabOrder: ['command'], visibleTabs: ['command'],
  }))).toEqual(['folder', 'file']);
});

test('invalid Tabs entries are ignored and an empty list keeps search usable', () => {
  expect(getSearchTabs(configuration({ tabs: ['Files', 'Files', null, 'removed-tab', 'Symbols'] }))).toEqual(['file', 'symbol']);
  // Everything is a combined view; an invalid empty selection must retain a real search type.
  expect(getSearchTabs(configuration({ tabs: [] }))).toEqual(['file']);
});

test('legacy Usages tab ordering resolves to the combined Symbols tab without duplicates', () => {
  expect(getTabOrder(['command', 'usages', 'file', 'symbol'])).toEqual([
    'command', 'symbol', 'file', 'everywhere', 'folder', 'text',
  ]);
});

test('visible tabs keep their configured order and skip hidden tabs', () => {
  expect(getTabOrder(['symbol', 'file'], ['file', 'text'])).toEqual(['file', 'text']);
});

test('an invalid or empty visibility list still leaves one usable tab', () => {
  expect(getTabOrder(['file'], [])).toEqual(['file']);
  expect(getTabOrder(['text'], ['removed-tab'])).toEqual(['text']);
});
