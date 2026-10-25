# Changelog

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
