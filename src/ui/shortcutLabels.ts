/** Labels match the platform-specific bindings contributed in package.json. */
export function shortcutLabels(platform: NodeJS.Platform = process.platform) {
  const mac = platform === 'darwin';
  const enter = mac ? 'Return' : 'Enter';
  return {
    enter,
    alt: mac ? 'Option' : 'Alt',
    usages: `${mac ? 'Cmd' : 'Ctrl'}+${enter}`,
    preview: 'Right Arrow',
  };
}
