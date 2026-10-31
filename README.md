<p align="center">
  <img src="media/banner.png" alt="search++" width="760">
</p>

<p align="center">
  <b>Search everything in VS Code from one popup.</b><br>
  Double Shift. Find it. Open it.<br>
  Files, folders, text, symbols, usages and commands, inspired by JetBrains Search Everywhere.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus"><img src="https://vsmarketplacebadges.dev/version-short/expiracy.search-plus-plus.svg" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus"><img src="https://vsmarketplacebadges.dev/installs-short/expiracy.search-plus-plus.svg" alt="Marketplace installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus&ssr=false#review-details"><img src="https://vsmarketplacebadges.dev/rating-short/expiracy.search-plus-plus.svg" alt="Marketplace rating"></a>
  <a href="https://ko-fi.com/expiracy"><img src="https://img.shields.io/badge/Ko--fi-Support%20search%2B%2B-FF5E5B?logo=ko-fi&logoColor=white" alt="Support search++ on Ko-fi"></a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus">Install</a> ·
  <a href="#six-search-modes">Search modes</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#settings">Settings</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

[![search++ walkthrough: Everything search, code preview, symbol usages, Back navigation and native settings](media/demo.gif)](media/demo.mp4)

[Watch the full walkthrough](media/demo.mp4). Recorded with search++ 3.1.1 on
macOS. Direct mode shortcuts use the optional VS Code preset.

## Get started

1. [Install search++](https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus),
   or run `code --install-extension expiracy.search-plus-plus`.
2. Press **Shift** twice to open the search popup.
3. Type a name or some code. Use **Tab** to change modes without losing your query.
4. Press **Right Arrow** to preview a result, or **Return** on macOS / **Enter** on
   Windows and Linux to open it.

Requires **VS Code 1.96 or later**. The popup follows your VS Code theme and file
icons. No setup or shortcut preset is required.

## Six search modes

Start in **Everything** when you know what you want but not where it lives.
Switch to a specific tab to explore its full results.

| Mode | Find |
|------|------|
| **Everything** | Grouped matches from all enabled sources |
| **Files** | Files by name or path, with fuzzy matching |
| **Folders** | Folders to reveal in the Explorer |
| **Text** | Matching lines inside files, powered by ripgrep |
| **Symbols** | Functions, classes and variables from your language providers |
| **Commands** | VS Code commands, including commands from extensions |

The Everything tab shows a limited set of matches per group. Select a group's
more-results row to open its full tab. You choose which sources appear and their
order in [Settings](#settings).

### Preview code without losing your place

Select a file, text match, symbol or usage and press **Right Arrow**, or click its
**eye button**. The file opens in a reusable preview tab while the popup keeps
focus. Text matches jump to the matching line and column.

Use the arrow keys to choose another result and preview again. **Return** on
macOS / **Enter** on Windows and Linux opens the result and closes search.
Files you edit, pin or keep open are preserved. Folders and commands have no code
preview.

### From a symbol to its usages, and back

1. Find a symbol in **Symbols** or **Everything**.
2. Press **Cmd+Return** on macOS / **Ctrl+Enter** on Windows and Linux, or click
   **Find Usages**. **Shift+F12** also works inside the popup.
3. Replace the symbol name in the search box to filter references by code or path.
4. Preview or open a reference, or select **Back** to restore the previous query,
   results, selection and search options.

**Return** on macOS / **Enter** on Windows and Linux opens a symbol's declaration.
Clearing the usages search box starts a fresh symbol search. Changing tabs leaves
the usages view.

You can also run **search++: Find Usages** from the editor context menu or command
palette. **Shift+F12 in code editors keeps VS Code's built-in Find All References.**

### Jump to a line or column

In **Files** or **Everything**, append a location to a filename:

```text
checkout.ts:42
checkout.ts:42:5
```

Line and column numbers start at 1. Preview or open the result to go there.
With an empty search box, recently opened files and locations appear again;
history is stored per workspace. Symbols shows a search hint instead.

## Keyboard shortcuts

These shortcuts work with the default configuration. Hover over row buttons and
search options to see the shortcut for your operating system.

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Open search | **Shift, Shift** | **Shift, Shift** |
| Next enabled tab | **Tab** | **Tab** |
| Preview selected result | **Right Arrow** | **Right Arrow** |
| Preview, alternative | **Cmd+Right** | **Ctrl+Right** |
| Open selected result | **Return** | **Enter** |
| Show selected symbol's usages | **Cmd+Return** | **Ctrl+Enter** |
| Show usages, inside the popup | **Shift+F12** | **Shift+F12** |
| Case sensitive | **Option+C** | **Alt+C** |
| Regex | **Option+R** | **Alt+R** |
| Whole word | **Option+W** | **Alt+W** |
| Fuzzy matching | **Option+F** | **Alt+F** |
| Exclude git-ignored files | **Option+G** | **Alt+G** |
| Exclude search-ignored files | **Option+S** | **Alt+S** |

Regex applies to text search. Fuzzy matching applies to paths, commands, symbol
candidates and usage previews; text search uses literal text or a regex. Search
options remain selected when changing modes.

### Optional shortcut presets

In **Search popup → Shortcut Preset**, choose **VS Code** or **IntelliJ** to open
individual modes directly. These presets redirect the keys below to search++.
**Default** leaves those opening shortcuts alone. Your explicit custom
keybindings take precedence.

| Mode | VS Code: macOS / Windows & Linux | IntelliJ: macOS / Windows & Linux |
|------|----------------------------------|----------------------------------|
| Files | Cmd+P / Ctrl+P | Cmd+Shift+O / Ctrl+Shift+N |
| Symbols | Cmd+T / Ctrl+T | Cmd+O / Ctrl+N |
| Text | Cmd+Shift+F / Ctrl+Shift+F | Cmd+Shift+F / Ctrl+Shift+F |
| Commands | Cmd+Shift+P / Ctrl+Shift+P | Cmd+Shift+A / Ctrl+Shift+A |

For example, the VS Code preset makes **Cmd+P** on macOS / **Ctrl+P** on Windows
and Linux open the Files tab. **F1** still opens the native Command Palette.
The Symbols shortcut searches the workspace, rather than just the current file.
Double Shift and the shortcuts inside the popup work with every preset.

Select **View and customise applied shortcuts** below the preset to open VS Code's
Keyboard Shortcuts editor filtered to search++. Other keymap extensions may claim
the same keys; see [Custom keybindings](#custom-keybindings) for an override.

## Settings

Click the **cog at the far right of the search row** to open the normal VS Code
Settings page, filtered to search++. There are two groups:

| Group | What you configure |
|-------|--------------------|
| **Search popup** | Tabs and Everything sources, their order, the opening tab and shortcut presets |
| **Search results** | Result limits, search delay, ignore files and excluded paths |

**Everything Tab Sources** controls both the individual source tabs and the
groups inside Everything. Untick a source to hide both, and keep at least one
source enabled. **Show Everything Tab** controls the combined tab itself.

**Tab Order** controls the tabs and Everything groups together. To rearrange tabs,
remove groups, then re-add them in the correct order. Use the source checkboxes
to show or hide types.

**When Search Opens → Last used tab** remembers your last available tab in this
workspace, including after restarting VS Code. Search text and usage lookups are
cleared when the popup closes. Direct search commands still open their named tab.

<details>
<summary>All settings and defaults</summary>

All keys use the `searchPlusPlus.` prefix. Workspace settings override User
settings. Previous setting names migrate automatically in their original scope.

| Key | Default | Purpose |
|-----|---------|---------|
| `showEverythingTab` | `true` | Show the combined Everything tab |
| `everythingTabSources` | All enabled | Show source tabs and their Everything groups |
| `tabOrder` | Everything, Files, Folders, Text, Symbols, Commands | Order tabs and Everything groups |
| `whenSearchOpens` | `"everywhere"` | Opening tab; use `"last"` to remember it |
| `shortcutPreset` | `"none"` | Default, `"vscode"` or `"intellij"` opening shortcuts |
| `resultsPerSearchType` | `200` | Maximum results returned per source |
| `resultsPerEverythingGroup` | `20` | Maximum matches shown per Everything group (1–200) |
| `searchDelay` | `300` | Typing delay in milliseconds for Text, Symbols and Commands tabs; Everything delays Symbols and Commands |
| `gitIgnoreRules` | `true` | Hide `.gitignore` matches by default |
| `searchIgnoreRules` | `true` | Hide `.searchignore` matches by default |
| `excludedPaths` | `[]` | Glob patterns always excluded, even with ignore-file filters off |

</details>

### Keep unwanted files out of results

search++ respects `.gitignore` and `.searchignore`. Add a `.searchignore` file
when you want to hide files from search without changing what Git tracks:

```gitignore
# Generated output and large data files
docs/generated/
data/**
*.min.js
```

Nested ignore files are supported, with patterns scoped to their directory.
Changes reload automatically. The popup's ignore toggles temporarily include or
exclude these files. **Excluded Paths** always applies, and Git's internal
metadata stays excluded even when both ignore toggles are off.

## Commands and custom keybindings

Run **search++: Open Search**, **Search Files**, **Search Text**, **Search Symbols**
or **Search Commands** from the Command Palette. **Find Usages**, **Open Settings**
and **Reindex Workspace** are also available there. With the VS Code shortcut
preset enabled, use **F1** to open the native palette.

### Custom keybindings

Search for `search++` in **Preferences: Open Keyboard Shortcuts** to change an
individual binding. User rules take precedence over extension presets and
keymaps. For example, to keep Shift+F12 assigned to search++ only inside its popup:

```json
{
  "key": "shift+f12",
  "command": "searchPlusPlus.findUsages",
  "when": "searchPlusPlusModalOpen && inQuickOpen"
}
```

<details>
<summary>Context keys for custom rules</summary>

| Context key | True when |
|-------------|-----------|
| `searchPlusPlusModalOpen` | The search popup is open |
| `searchPlusPlusFileTab` | Files or Everything is active |
| `searchPlusPlusEverythingTab` | Everything is active |
| `searchPlusPlusSymbolTab` | Symbols is active |
| `searchPlusPlusSymbolSelected` | A symbol result is selected in Symbols or Everything |

The commands **Next Tab**, **Previous Tab**, **Preview Selected Result**,
**Autofill File Path** and the search-option toggles can also be bound in the
Keyboard Shortcuts editor. See VS Code's
[keybinding rules](https://code.visualstudio.com/docs/configure/keybindings#_keyboard-rules)
for rule syntax and precedence.

</details>

## Search coverage

- **Files and folders:** an in-memory index with fzf matching, updated by a file
  watcher. Folder search includes folders with searchable files; empty folders
  do not appear. Click the index status in the status bar to reindex manually.
- **Text:** ripgrep searches file contents. This requires a filesystem workspace
  and ripgrep on the extension host, including for remote workspaces. Virtual
  workspace text search is unsupported.
- **Symbols and usages:** results come from installed language providers and
  depend on their indexing state. Open a source file if its language service has
  not started. Ignore rules and exclusions also apply to references.
- **Notebooks:** text search includes Jupyter cell source. Opening a result opens
  the notebook; jumping to the exact matching cell is unsupported.

## Help and development

[Report a bug or request a feature](https://github.com/expiracy/search-plus-plus/issues) ·
[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
[Architecture](ARCHITECTURE.md) · [Support search++](https://ko-fi.com/expiracy)
