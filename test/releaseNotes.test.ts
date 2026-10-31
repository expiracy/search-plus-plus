import { expect, test } from 'vitest';
import { extractReleaseNotes } from '../scripts/release-notes.mjs';

test('release notes contain only the chosen version, without future or older changes', () => {
  const changelog = '# Changelog\n\n## Unreleased\n\n- Future change.\n\n## 3.1.0 — 2026-10-31\n\n### Changed\n\n- New search controls.\n\n## 3.0.4 — 2026-10-25\n\n- Older change.\n';
  expect(extractReleaseNotes(changelog, '3.1.0')).toBe('### Changed\n\n- New search controls.\n');
});

test('a missing release section cannot publish another version or Unreleased notes', () => {
  const changelog = '# Changelog\n\n## Unreleased\n\n- Future change.\n\n## 3.1.0 — 2026-10-31\n\n- Other version.\n';
  expect(() => extractReleaseNotes(changelog, '3.1.1')).toThrow('No changelog section for 3.1.1');
});

test('an empty section fails before publishing blank release notes', () => {
  expect(() => extractReleaseNotes('# Changelog\n\n## 3.1.0 — 2026-10-31\n\n## 3.0.4\n\n- Older change.\n', '3.1.0'))
    .toThrow('Changelog section for 3.1.0 is empty');
});
