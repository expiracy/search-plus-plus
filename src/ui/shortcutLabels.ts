import * as vscode from 'vscode';

/** Older native pickers intercept modified Enter before extension keybindings. */
export function shortcutLabels(platform: NodeJS.Platform = process.platform, version = vscode.version) {
  const mac = platform === 'darwin';
  const enter = mac ? 'Return' : 'Enter';
  const [major, minor] = (version ?? '').split('.').map(Number);
  const legacy = major === 1 && minor < 109;
  const usages = legacy ? 'Shift+F12' : `${mac ? 'Cmd' : 'Ctrl'}+${enter}`;
  return {
    enter,
    alt: mac ? 'Option' : 'Alt',
    usages,
    usagesHint: legacy ? usages : `${usages} or Shift+F12`,
    preview: 'Right Arrow',
  };
}
