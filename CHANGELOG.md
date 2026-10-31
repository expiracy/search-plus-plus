# Changelog

## Unreleased

### Changed

- The popup's cog opens the normal VS Code Settings page directly, filtered to
  search++. The **search++: Open Settings** command opens the same page.
- **Tabs** is one native list of readable tab names. Drag rows to reorder them,
  remove a row to hide a tab, and use **Add Item** to show one again. The new
  `searchPlusPlus.tabs` setting controls order and visibility together; existing
  `tabOrder` and `visibleTabs` settings remain supported for compatibility.
- `searchPlusPlus.defaultMode` chooses the opening tab. Opening-tab and shortcut
  dropdowns use readable labels. Defaults remain Everything and all six tabs.
  At least one tab stays available. Direct search commands can open hidden tabs
  temporarily; remembered hidden tabs fall back to a visible tab.
- Ignore rules and excluded paths now live under **Search results**, alongside
  result groups, limits, and search delay. The two settings categories are
  **Search window** (including the shortcut preset) and **Search results**.
  Existing setting keys remain compatible.
- **Symbols and Usages share one flow.** The separate Usages tab is removed.
  In Symbols, **Enter** opens the selected declaration; **Ctrl+Enter**
  (**Control+Return** on macOS) or **Shift+F12** shows its semantic usages in
  the same popup. The Find Usages row action and editor command remain available.
- The native **Back** button in a usages view restores the previous search
  query, cached results, highlighted item, and search options. This also works
  when entering usages from Everything. Clearing the usages input starts a
  fresh symbol search instead.
- **Right Arrow now moves the text cursor normally.** Preview has moved from
  plain Right Arrow to **Cmd+Right** on macOS and **Ctrl+Right** on Windows/Linux.
  Preview keeps the popup focused and reuses the preview editor tab; **Enter**
  still opens a result and closes the popup.
- Previewable results, including recent history, have an **eye button**. Its
  hover tooltip shows the platform's preview shortcut, and clicking it previews
  that row without closing search. Folders, commands, and informational rows do
  not offer preview.
- Tab order and keyboard cycling now have six modes. Existing `usages` entries
  in custom tab orders map to Symbols without adding a duplicate tab. Closing a
  usages view with Remember Last Mode enabled reopens Symbols next time; legacy
  remembered Usages values also open Symbols.

### Performance

- File search in very large workspaces responds faster as you type. Ignore
  rules are evaluated once per index snapshot instead of on every keystroke,
  and longer queries search only the previous query's matches. In a
  200,000-file workspace a keystroke takes about 0.5–1 s instead of 1.5–2.6 s,
  and much less once a query narrows the results.
- Folder search reuses the folder list until the index changes, so each
  keystroke takes milliseconds instead of several seconds in large workspaces.
- Indexing a large workspace is several times faster: ignore decisions are
  cached per directory, and custom exclusions are skipped when none are
  configured.
- Deleting many files at once no longer stalls the editor. Removing 1,000
  files from a 250,000-file index takes about 0.25 s instead of 44 s.
- Text search finds notebooks through the file index instead of scanning the
  workspace again for every query.

## 3.0.4 — 2026-10-25

### Changed

- A refreshed search++ logo and banner with more depth and an amber `++` that
  stays visible at small icon sizes.
- The README and website link to Ko-fi for anyone who wants to support
  search++.

## 3.0.3 — 2026-10-24

### Fixed

- Opening or previewing a search result places its matching line at the top of
  the editor viewport where scrolling permits.

## 3.0.2 — 2026-10-22

### Fixed

- The Marketplace listing and extension now use the new search++ logo.
- Shortcut hints show Option on macOS and Alt on Windows/Linux. The Marketplace
  documentation lists each platform's shortcuts separately.

## 3.0.1 — 2026-10-21

### Documentation

- A new Marketplace page with a search++ logo, a demo GIF, and current
  screenshots of every search mode, usages, previews, and go to line.
- Development, validation, and release instructions moved to `CONTRIBUTING.md`.

### Packaging

- The extension package no longer bundles README images; the Marketplace page
  loads them from GitHub. The package shrinks from about 6 MB to 40 KB.

## 3.0.0 — 2026-10-20

### Upgrade changes

- **Tab** cycles forward through search modes. The default **Shift+Tab** binding
  has been removed; the Previous Tab command remains available for custom bindings.
- Result rows now have a **Go to File** action that opens the matching location in
  the current editor group, replacing the split-editor action.
- **Right Arrow** previews the selected result while keeping the search popup
  focused.

### Added

- A **Usages** mode for semantic references from VS Code's language providers.
  Search for a symbol and press Enter to see its references. Clear the input to
  choose another symbol, or replace the symbol name with text or a filename to
  filter its references.
- Find Usages actions on symbol results, a popup **Shift+F12** shortcut, and an
  editor context-menu command for the symbol at the cursor.
- Reusable file previews that jump to the matching line and column and center the
  line where scrolling permits. Successive previews use one additional editor tab,
  including when VS Code's preview tabs are disabled. Existing, edited, pinned,
  and explicitly kept tabs are preserved.

### Improved

- All seven mode icons stay visible throughout searches and usages navigation.
- File indexing, cancellation, and exclusion handling are more reliable during
  workspace changes and rapid queries. Eligible results are filtered before
  applying result limits.
- Path autofill uses the file's actual path. Line and column parsing preserves
  partially typed locations and rejects nonnumeric suffixes.
- Stale results and queued previews cannot act on a superseded search.
- Recent-history cleanup preserves newer opens and removals, and Go to File
  records confirmed locations in history.
- Missing absolute paths report zero file results. Unmatched usages filters have
  recovery instructions distinct from language-service failures.
- Documentation covers current search behavior, language-service startup,
  shortcut conflicts, architecture, and Marketplace releases.

### Compatibility and validation

- Supports VS Code **1.96.0 and newer**. Older supported versions use title-bar
  controls where inline toggle buttons are unavailable.
- Text search includes notebook cell source; opening a match opens the notebook
  without navigating to a specific cell.
- CI checks Linux, macOS, and Windows, runs native extension-host tests on the
  minimum supported and current stable VS Code releases, and publishes the
  validated VSIX artifact.
