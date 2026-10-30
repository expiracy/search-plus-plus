import { expect, test } from 'vitest';
import { getTabOrder } from '../src/searchModes';

test('legacy Usages tab ordering resolves to the combined Symbols tab without duplicates', () => {
  expect(getTabOrder(['command', 'usages', 'file', 'symbol'])).toEqual([
    'command', 'symbol', 'file', 'everywhere', 'folder', 'text',
  ]);
});
