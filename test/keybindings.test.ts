import { expect, test } from 'vitest';
import manifest from '../package.json';
test('plain Tab cycles popup modes without Shift+Tab or Ctrl+Tab bindings', () => {
  const bindings = manifest.contributes.keybindings;
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.nextTab')?.key).toBe('tab');
  expect(bindings.filter(binding => ['searchPlusPlus.nextTab', 'searchPlusPlus.prevTab'].includes(binding.command)).map(binding => binding.key)).toEqual(['tab']);
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.findUsages')).toMatchObject({ key: 'shift+f12', when: 'searchPlusPlusModalOpen' });
});

test('Right Arrow previews a result only while the search popup is open', () => {
  expect(manifest.contributes.keybindings.find(binding => binding.command === 'searchPlusPlus.preview')).toMatchObject({ key: 'right', when: 'searchPlusPlusModalOpen' });
  expect(manifest.contributes.commands.some(command => command.command === 'searchPlusPlus.preview')).toBe(true);
});
