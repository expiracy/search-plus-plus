import { expect, test } from 'vitest';
import { getSearchTabs, getTabOrder } from '../src/searchModes';

function configuration(user: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback: unknown) => workspace[key] ?? user[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: user[key], workspaceValue: workspace[key] }),
  } as any;
}

test('one readable Tabs list controls both visible tabs and their order', () => {
  expect(getSearchTabs(configuration({ tabs: ['Text', 'Files'] }))).toEqual(['text', 'file']);
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
  expect(getSearchTabs(configuration({ tabs: [] }))).toEqual(['everywhere']);
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
