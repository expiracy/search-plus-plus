import { expect, test, vi } from 'vitest';
vi.mock('vscode', () => import('./__mocks__/vscode'));
const vscode = await import('./__mocks__/vscode');
const { compilePathFilter } = await import('../src/pathFilter');
const roots = [{ name: 'app', uri: vscode.Uri.file('/workspace/app'), index: 0 }];

test('a folder include matches its descendants without matching similar folder names', () => {
  const matches = compilePathFilter('src', false, roots as any)!;
  expect(matches(vscode.Uri.file('/workspace/app/src/index.ts') as any)).toBe(true);
  expect(matches(vscode.Uri.file('/workspace/app/lib/src/index.ts') as any)).toBe(true);
  expect(matches(vscode.Uri.file('/workspace/app/src-other/index.ts') as any)).toBe(false);
});

test('regex matches normalized workspace paths and stays stable across repeated calls', () => {
  const matches = compilePathFilter('^src/.*\\.tsx?$', true, roots as any)!;
  const uri = vscode.Uri.file('/workspace/app/src/index.ts') as any;
  expect(matches(uri)).toBe(true);
  expect(matches(uri)).toBe(true);
  expect(matches(vscode.Uri.file('/workspace/app/lib/src/index.ts') as any)).toBe(false);
  expect(matches(vscode.Uri.file('/workspace/app/src/index.js') as any)).toBe(false);
});

test('comma-separated includes preserve commas inside brace alternatives', () => {
  const matches = compilePathFilter('src/**, **/*.{ts,tsx}', false, roots as any)!;
  expect(matches(vscode.Uri.file('/workspace/app/docs/file.tsx') as any)).toBe(true);
  expect(matches(vscode.Uri.file('/workspace/app/src/file.js') as any)).toBe(true);
  expect(matches(vscode.Uri.file('/workspace/app/docs/file.js') as any)).toBe(false);
});

test('./ anchors a folder at the workspace root and multi-root names can qualify it', () => {
  const multiple = [...roots, { name: 'server', uri: vscode.Uri.file('/workspace/server'), index: 1 }];
  const anchored = compilePathFilter('./src', false, multiple as any)!;
  expect(anchored(vscode.Uri.file('/workspace/app/src/file.ts') as any)).toBe(true);
  expect(anchored(vscode.Uri.file('/workspace/app/lib/src/file.ts') as any)).toBe(false);
  const qualified = compilePathFilter('./server/src', false, multiple as any)!;
  expect(qualified(vscode.Uri.file('/workspace/server/src/file.ts') as any)).toBe(true);
  expect(qualified(vscode.Uri.file('/workspace/app/src/file.ts') as any)).toBe(false);
});

test('invalid regex is reported; blank scope is unrestricted and roots have boundaries', () => {
  expect(() => compilePathFilter('[', true, roots as any)).toThrow();
  expect(compilePathFilter('  ', false, roots as any)).toBeUndefined();
  expect(compilePathFilter('**', false, roots as any)!(vscode.Uri.file('/workspace/application/src/index.ts') as any)).toBe(false);
});

test('a qualified workspace include cannot match a same-named directory in another root', () => {
  const multiple = [...roots, { name: 'server', uri: vscode.Uri.file('/workspace/server'), index: 1 }];
  const matches = compilePathFilter('./server/src', false, multiple as any)!;
  expect(matches(vscode.Uri.file('/workspace/app/server/src/file.ts') as any)).toBe(false);
  expect(matches(vscode.Uri.file('/workspace/server/src/file.ts') as any)).toBe(true);
});
