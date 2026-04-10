import { describe, test, expect, vi } from 'vitest';

vi.mock('vscode', () => import('./__mocks__/vscode'));

const { buildTitle } = await import('../src/ui/searchModal');

describe('buildTitle', () => {
  test('returns base title unchanged when state is ready', () => {
    expect(buildTitle('Everything: 12 files', 'ready')).toBe('Everything: 12 files');
  });

  test('prepends indexing indicator when state is building', () => {
    expect(buildTitle('Everything: 12 files', 'building')).toBe(
      'Indexing... | Everything: 12 files',
    );
  });

  test('returns base unchanged when state is stale', () => {
    expect(buildTitle('Files: 3 files', 'stale')).toBe('Files: 3 files');
  });

  test('returns base unchanged when state is error', () => {
    expect(buildTitle('Everything', 'error')).toBe('Everything');
  });

  test('handles empty base title under building', () => {
    expect(buildTitle('', 'building')).toBe('Indexing... | ');
  });
});
