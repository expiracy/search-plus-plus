import { expect, test } from 'vitest';
import manifest from '../package.json';
test('mode bindings use Shift+Tab forward and Ctrl+Tab backward without consuming plain Tab', () => {
  const bindings = manifest.contributes.keybindings;
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.nextTab')?.key).toBe('shift+tab');
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.prevTab')?.key).toBe('ctrl+tab');
  expect(bindings.some(binding => binding.key === 'tab')).toBe(false);
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.findUsages')).toMatchObject({ key: 'shift+f12', when: 'searchPlusPlusModalOpen' });
});
