# Changelog

## Unreleased

### Changed

- **Cmd+Return** on macOS or **Ctrl+Enter** on Windows/Linux shows the selected
  symbol's usages in Symbols or Everything. Shift+Enter no longer opens usages.
- **Right Arrow** previews the selected result while keeping search open.
  Cmd+Right on macOS and Ctrl+Right on Windows/Linux remain alternatives.
- Popup hover hints, symbol instructions and empty-state help use the current
  platform's key names, including Cmd/Option/Return on macOS and Ctrl/Alt/Enter
  on Windows/Linux. Static descriptions list both platforms where relevant.

## 3.1.0 — 2026-10-31

### Added

- Configure the search popup from its settings cog. Settings open directly in
  VS Code and are grouped into **Search popup** and **Search results**.
- Choose which search types appear as tabs and inside Everything, arrange their
  order, and show or hide the combined Everything tab. To rearrange tabs, remove
  groups from Tab Order and re-add them in the order you want.
- Choose an opening tab or **Last used tab**, remembered per workspace across
  restarts. Hidden opening tabs fall back to an available tab, and at least one
  search source stays enabled.
- Optional **VS Code** and **IntelliJ** shortcut presets open search++ modes
  directly. **Default** keeps the standard shortcuts. A link opens VS Code's
  Keyboard Shortcuts editor to view and customise search++ bindings.

### Changed

- **Symbols and Usages now share one flow.** Enter opens a symbol's declaration;
  Shift+Enter shows its usages in the same popup, including symbols selected in
  Everything. The action's hover hint shows Shift+Enter and the Shift+F12
  alternative. Shift+F12 is scoped to the popup, so code editors keep VS Code's
  built-in Find All References action. The separate Usages tab is removed.
- **Back** restores the previous query, results, highlighted item and filters
  after a usages lookup, including lookups started from Everything. Clearing
  the usages input returns to symbol search.
- **Right Arrow moves the text cursor.** **Ctrl+Enter** (Control+Return on macOS)
  previews results throughout the popup, including Files and Symbols. It no
  longer autofills file paths or opens usages. Cmd+Right on macOS and Ctrl+Right
  on Windows/Linux remain preview alternatives. An eye button shows
  the shortcut and previews the selected file while keeping search open.
  **Enter** opens the result and closes the popup.
- File rows show the filename once with a muted parent folder and VS Code's
  themed file icons where supported. Recent files and absolute paths use the
  same layout; saved recent locations retain their line numbers. Files shows
  a compact result count.
- Result limits, typing delay, ignore rules and excluded paths have clearer
  setting names and descriptions. Ignore-rule changes apply immediately.
  Existing preferences carry over automatically at their User/Workspace scope.
- Tabs and Everything share source selection and ordering. Existing settings
  that disabled a source keep it disabled during migration. Old Usages entries
  in tab orders and remembered modes map to Symbols.

### Fixed

- Preserve correct file matches when narrowing Unicode queries, including
  case-insensitive queries and combining characters.

### Performance

- Faster file search in large workspaces through cached ignore checks and
  incremental matching as the query narrows.
- Reuse folder lists between searches, cache ignore decisions during indexing,
  and batch file deletions to reduce pauses in large workspaces.
- Text search finds notebooks through the shared file index instead of scanning
  the workspace again for every query.

### Known issues

- On macOS, clicking a tab can leave focus on its button. Cmd+A may then close
  search and select the editor's contents instead of the query. Click the search
  input before selecting or replacing query text.

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
