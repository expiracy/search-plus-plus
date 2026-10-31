import { expect, test } from 'vitest';
import { getTabOrder } from '../src/searchModes';

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
