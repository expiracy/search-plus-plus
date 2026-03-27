---
name: testing
description: Write tests for search++ extension code. Use when the user asks to add, update, or write tests for new or existing functionality.
argument-hint: [file-or-description]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

## Testing Guide for search++

Write tests for the specified functionality. If `$ARGUMENTS` names a file, test that file. If it describes a feature, find the relevant source and test it. If omitted, look at recent git changes and test those.

### Test Runner & Commands

- **Framework**: `bun:test`
- **Run all**: `bun test`
- **Run one file**: `bun test test/<name>.test.ts`
- **Run matching**: `bun test --filter "<pattern>"`

### Project Structure

```
test/
  __mocks__/
    vscode.ts              # Shared vscode module mock — always import this
  fixtures/
    mock-project/           # Fixture project with known file structure & .gitignore
      .gitignore            # Patterns: node_modules/, *.log, build/
      src/                  # Source files with searchable content
      build/                # Gitignored directory
      data.log              # Gitignored file
  *.test.ts                 # Test files (one per source module)
```

### The vscode Mock

Every source file imports `vscode` which only exists inside VS Code's runtime. Tests must mock it **before** importing any source module.

**Pattern — every test file must start like this:**

```typescript
import { describe, test, expect, mock } from 'bun:test';

// Mock vscode BEFORE any source imports
mock.module('vscode', () => import('./__mocks__/vscode'));

// Dynamic import AFTER mock registration
const { SomeClass } = await import('../src/path/to/module');
```

The shared mock at `test/__mocks__/vscode.ts` provides stubs for: `Uri`, `ThemeIcon`, `ThemeColor`, `EventEmitter`, `Position`, `Selection`, `Range`, `workspace`, `window`, `commands`, and all enums. It returns safe defaults (empty arrays, no-op functions).

**Overriding mock behavior for a specific test file:**

When a test needs custom vscode behavior (e.g., `workspace.workspaceFolders` pointing at fixtures, or `findFiles` returning specific URIs), override inside the `mock.module` callback:

```typescript
const FIXTURE_ROOT = path.resolve(import.meta.dir, 'fixtures/mock-project').replace(/\\/g, '/');

mock.module('vscode', () => {
  const base = require('./__mocks__/vscode');

  base.workspace.workspaceFolders = [
    { uri: base.Uri.file(FIXTURE_ROOT), name: 'mock-project', index: 0 },
  ];

  base.workspace.asRelativePath = (pathOrUri: any): string => {
    const p = typeof pathOrUri === 'string' ? pathOrUri : (pathOrUri.fsPath ?? pathOrUri.path);
    const normalized = p.replace(/\\/g, '/');
    const prefix = FIXTURE_ROOT + '/';
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  };

  // Override findFiles, fs.readFile, getConfiguration etc. as needed
  return base;
});
```

### Test Tiers

**Tier 1 — Pure functions (no mock needed):**
Functions with zero vscode dependency. Import directly, test with plain assertions.
- Example: `src/utils.ts` (debounce)
- Example: `src/ui/searchModal.ts` (parseLineCol — exported)

For debounce/timer tests, use real timers with short delays:
```typescript
const fn = debounce(() => { called = true; }, 20);
fn();
await Bun.sleep(40);
expect(called).toBe(true);
```

**Tier 2 — Mocked unit tests:**
Classes that use vscode APIs but can be tested with the shared mock + overrides.
- `GitIgnoreManager` — override `findFiles` and `fs.readFile` to return `.gitignore` content
- `extractFolders` — needs `Uri.joinPath` and `ThemeIcon` (covered by shared mock)
- `SearchHistory` — provide a mock Memento:
  ```typescript
  class MockMemento {
    private store = new Map<string, any>();
    get<T>(key: string, defaultValue: T): T {
      return this.store.has(key) ? this.store.get(key) : defaultValue;
    }
    update(key: string, value: any) { this.store.set(key, value); return Promise.resolve(); }
  }
  ```

**Tier 3 — Integration tests with real I/O:**
These use real dependencies (ripgrep binary, fzf library) against fixture files.

- `TextSearch` — spawns actual ripgrep against `test/fixtures/mock-project/`. Accepts `rgPath` as a constructor param: `new TextSearch(require('@vscode/ripgrep').rgPath)`. Wrap the callback-based API in a promise:
  ```typescript
  function searchAsync(ts, query, options): Promise<TextMatch[]> {
    return new Promise((resolve) => {
      let lastResults = [];
      const disposable = ts.search(query, options, (results) => { lastResults = results; });
      setTimeout(() => { disposable.dispose(); resolve(lastResults); }, 2000);
    });
  }
  ```

- `FileIndex` — uses real fzf library. Mock `workspace.findFiles` to return fixture file URIs, then call `index.build()` and test `index.find()`. Use a stub GitIgnoreManager:
  ```typescript
  const mockGitIgnore = {
    isIgnored: (p: string) => p.startsWith('node_modules/') || p.startsWith('build/') || p.endsWith('.log'),
    getExcludeGlob: () => '{**/node_modules/**,**/.git/**}',
    onDidChange: () => ({ dispose() {} }),
    dispose() {},
  } as any;
  ```

### Adding Fixture Files

When testing new functionality, add fixture files to `test/fixtures/mock-project/`. Keep them small with predictable, known content so assertions are deterministic. Update the `ALL_FILES` array in `test/fileIndex.test.ts` if new files are added.

### Conventions

- **One test file per source module**: `test/<module>.test.ts`
- **Use `describe` blocks** named after the class or function under test
- **Test names**: describe the behavior, not the implementation — `"finds TODO in src/utils.ts"` not `"calls rg with correct args"`
- **Assert membership, not exact order** for search results (fuzzy matching order can vary): `results.find(r => r.item.relativePath === 'src/index.ts')`
- **Normalize paths**: always use forward slashes in test assertions. Use `.replace(/\\/g, '/')` when constructing fixture paths
- **Clean up**: call `.dispose()` on classes that implement Disposable in `afterEach`

### Checklist Before Finishing

1. Run `bun test` — all tests pass
2. Run `bun run build` — no source regressions
3. New test file follows the mock-first import pattern
4. Fixture files added if testing against file content
5. No hardcoded absolute paths in assertions — derive from `import.meta.dir`
