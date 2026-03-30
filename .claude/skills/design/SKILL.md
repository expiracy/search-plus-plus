---
name: design
description: Review code for design quality, type safety, API usage, and adherence to best practices. Use when implementing new features, refactoring, or reviewing code for architectural soundness.
argument-hint: [file-or-directory]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent
---

## Design Review & Implementation Guide

Review the specified files or recent changes and fix any violations. If `$ARGUMENTS` names a file or directory, review those. Otherwise, review all staged and unstaged changes via git diff.

### 1. Type Safety

- **Never use `any`**. Find or create the correct type. If a third-party API returns an unknown shape, use `unknown` and narrow with type guards.
- **No type assertions (`as X`)** unless the type system genuinely cannot infer the correct type and you can justify why. Prefer type guards, generics, or overloads.
- **Extend, don't widen**. When behaviour is extended, create a new interface or type that extends the original rather than adding optional fields or union hacks to the base type.
- **Use discriminated unions** for values that can be one of several shapes (e.g. results from different search modes). Discriminate on a literal field, not with `instanceof` checks.
- **Prefer `readonly`** on properties and arrays that should not be mutated after construction.

### 2. VS Code Extension API Usage

- **Use the real API**. Before writing a custom implementation, check if `vscode.*` already provides the functionality. Common misses:
  - `vscode.workspace.fs` instead of Node `fs`
  - `vscode.RelativePattern` for file watching/globbing
  - `vscode.CancellationTokenSource` for cancellable operations
  - `vscode.EventEmitter` for custom events
  - `vscode.Disposable.from()` to combine disposables
  - `workspace.getConfiguration()` for settings, not hardcoded defaults
- **Respect the Disposable contract**. Anything that allocates resources (event listeners, file watchers, processes) must implement `Disposable` and be registered in `context.subscriptions` or disposed in the parent's `dispose()`.
- **Use `SecretStorage`** for credentials, never `globalState` or `workspaceState`.
- **Prefer `when` clauses** in `package.json` over runtime checks for command/menu visibility.
- **Use `vscode.l10n.t()`** for user-facing strings if localisation is a goal.

### 3. Code Reuse & Duplication

- **Search before creating**. Before writing a new helper, utility, or pattern, search the codebase for existing implementations. Grep for similar function names and logic.
- **Extract shared logic**. If two or more providers, handlers, or modules contain similar logic (>5 lines), extract it into a shared utility or base class.
- **Reuse existing types**. Import from `providers/types.ts` or other shared modules rather than redeclaring equivalent shapes.
- **Consistent patterns**. New providers must implement the `SearchProvider` interface. New result types must extend or compose `SearchResult`. Do not create parallel type hierarchies.
- **One source of truth**. Configuration values, default limits, enum mappings, and label strings should each live in exactly one place. Import, don't duplicate.

### 4. Architecture & Separation of Concerns

- **Providers are for data, UI is for presentation**. Providers return `SearchResult[]` and must not reference UI concepts (quick pick items, decorations, button state). The `SearchModal` is responsible for presentation.
- **No circular dependencies**. If module A imports from module B, module B must not import from module A. Shared types go in a third module (e.g. `types.ts`).
- **Keep classes focused**. A class should have one responsibility. If a class manages both indexing and searching, split them. If a provider is also formatting results for display, extract the formatting.
- **Favour composition over inheritance**. Prefer injecting dependencies over deep class hierarchies.

### 5. Robustness

- **Handle workspace edge cases**. No workspace folders open, multi-root workspaces, remote/virtual file systems. Guard at system boundaries, not in every internal function.
- **Cancellation**. Long-running operations (search, indexing) must support cancellation via `CancellationToken` or `Disposable`. Never let a cancelled operation continue consuming resources.
- **No fire-and-forget promises**. Every promise must be awaited, returned, or explicitly voided with a comment explaining why. Unhandled rejections crash the extension host.

### 6. Avoiding Hacks & Workarounds

- **No monkey-patching** VS Code APIs or third-party modules.
- **No `setTimeout`/`setInterval` hacks** for synchronisation. Use proper events, callbacks, or `vscode.EventEmitter`.
- **No string manipulation of URIs**. Use `vscode.Uri` methods (`joinPath`, `with`, `fsPath`) instead.
- **No regex to parse structured data** (JSON, JSONC, package.json). Use a parser.
- **No private API access** via `(vscode as any)._internal` or similar.

### 7. Performance

- **Lazy initialisation**. Expensive resources (indexes, processes) should be created on first use, not at activation. Use the existing deferred-build pattern in `IndexManager`.
- **Debounce user input**. Search queries triggered by typing must be debounced. Use the existing `debounce` utility from `utils.ts`.
- **Stream results incrementally**. Follow the existing `onResults` callback pattern rather than collecting all results before returning.
- **Avoid blocking the extension host**. CPU-intensive work should be offloaded to a worker or chunked with `setImmediate`/`setTimeout(0)`.

### 8. Naming & Consistency

- **Follow existing conventions**. Study the naming patterns in the codebase before adding new names. Providers are `*Provider`, indexes are in `index/`, UI is in `ui/`.
- **Be precise with names**. `getResults` is vague; `searchFilesByGlob` is clear.
- **Boolean variables/parameters**: prefix with `is`, `has`, `should`, `can`, or `exclude`/`include`.
- **Enums over magic strings**. Use `SearchMode` and `ResultSection` enums. Do not introduce new string literal unions for concepts already covered by an enum.

## Output Format

For each issue found, report:

```
[SEVERITY] Category -- file:line
Description of the issue.
Fix: what to change.
```

Severity levels: `[CRITICAL]` `[WARNING]` `[INFO]`

If invoked during implementation (not just review), apply the fixes directly rather than only reporting them.

End with a summary: total issues by severity and overall assessment.
