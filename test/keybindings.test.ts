import { expect, test } from 'vitest';
import manifest from '../package.json';
test('plain Tab cycles popup modes without Shift+Tab or Ctrl+Tab bindings', () => {
  const bindings = manifest.contributes.keybindings;
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.nextTab')?.key).toBe('tab');
  expect(bindings.filter(binding => ['searchPlusPlus.nextTab', 'searchPlusPlus.prevTab'].includes(binding.command)).map(binding => binding.key)).toEqual(['tab']);
  expect(bindings.find(binding => binding.command === 'searchPlusPlus.findUsages')).toMatchObject({ key: 'shift+f12', when: 'searchPlusPlusModalOpen' });
});

test('Cmd/Ctrl+Right previews results while plain Right remains available for editing', () => {
  expect(manifest.contributes.keybindings.find(binding => binding.command === 'searchPlusPlus.preview')).toMatchObject({ key: 'ctrl+right', mac: 'cmd+right', when: 'searchPlusPlusModalOpen' });
  expect(manifest.contributes.keybindings.some(binding => binding.key === 'right')).toBe(false);
  expect(manifest.contributes.commands.some(command => command.command === 'searchPlusPlus.preview')).toBe(true);
});

test('Ctrl+Enter finds usages in Symbols without taking the file path autofill shortcut', () => {
  expect(manifest.contributes.keybindings).toContainEqual({
    command: 'searchPlusPlus.findUsages', key: 'ctrl+enter',
    when: 'searchPlusPlusModalOpen && searchPlusPlusSymbolTab',
  });
  expect(manifest.contributes.keybindings.find(binding => binding.command === 'searchPlusPlus.autofillPath'))
    .toMatchObject({ key: 'ctrl+enter', when: 'searchPlusPlusModalOpen && searchPlusPlusFileTab' });
});


test('the optional VS Code preset maps direct searches on each platform', () => {
  const properties = Object.assign({}, ...manifest.contributes.configuration.map(group => group.properties));
  expect(properties['searchPlusPlus.shortcutPreset']).toMatchObject({ default: 'none' });
  const bindings = manifest.contributes.keybindings.filter(binding => binding.when === "config.searchPlusPlus.shortcutPreset == 'vscode'");
  expect(bindings.map(({ command, key, mac }) => ({ command, key, mac }))).toEqual([
    { command: 'searchPlusPlus.openFiles', key: 'ctrl+p', mac: 'cmd+p' },
    { command: 'searchPlusPlus.openSymbols', key: 'ctrl+t', mac: 'cmd+t' },
    { command: 'searchPlusPlus.openText', key: 'ctrl+shift+f', mac: 'cmd+shift+f' },
    { command: 'searchPlusPlus.openCommands', key: 'ctrl+shift+p', mac: 'cmd+shift+p' },
  ]);
});


test('the IntelliJ preset offers the keymap search shortcuts without changing the default', () => {
  const bindings = manifest.contributes.keybindings.filter(binding => binding.when === "config.searchPlusPlus.shortcutPreset == 'intellij'");
  expect(bindings.map(({ command, key, mac }) => ({ command, key, mac }))).toEqual([
    { command: 'searchPlusPlus.openFiles', key: 'ctrl+shift+n', mac: 'cmd+shift+o' },
    { command: 'searchPlusPlus.openSymbols', key: 'ctrl+n', mac: 'cmd+o' },
    { command: 'searchPlusPlus.openText', key: 'ctrl+shift+f', mac: 'cmd+shift+f' },
    { command: 'searchPlusPlus.openCommands', key: 'ctrl+shift+a', mac: 'cmd+shift+a' },
  ]);
});
