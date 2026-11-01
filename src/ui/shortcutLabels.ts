/** Labels match the platform-specific bindings on supported VS Code hosts. */
export function shortcutLabels(platform: NodeJS.Platform = process.platform) {
  const mac = platform === 'darwin';
  const enter = mac ? 'Return' : 'Enter';
  const usages = `${mac ? 'Cmd' : 'Ctrl'}+${enter}`;
  return {
    enter,
    alt: mac ? 'Option' : 'Alt',
    usages,
    usagesHint: `${usages} or Shift+F12`,
    preview: `Right Arrow at query end or ${mac ? 'Cmd' : 'Ctrl'}+Right`,
  };
}
