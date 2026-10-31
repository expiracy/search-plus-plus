<p align="center">
  <img src="media/banner.png" alt="search++" width="760">
</p>

<p align="center">
  <b>Search everything in VS Code from one popup.</b><br>
  Press <kbd>Shift</kbd> <kbd>Shift</kbd> to find files, folders, text, symbols, usages, and commands.<br>
  Inspired by Search Everywhere in JetBrains IDEs.
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

<p align="center">
  <img src="media/demo.gif" alt="search++ demo: searching everything, files with a line number, text with previews, symbols, usages, and commands" width="900">
</p>

## Why search++

- **One shortcut for every search.** Files, folders, text, symbols, usages, and
  commands share one popup. Press **Tab** to change mode without losing your query.
- **Everything at a glance.** The Everything tab groups the best matches from each
  source, so you can find a file, a line of text, or a command from one place.
- **Browse results without leaving the popup.** Press **Cmd+Right** on macOS or
  **Ctrl+Right** on Windows/Linux, or click a result's eye button, to preview a
  result in a reusable editor tab. The matched line appears at the top, and the
  popup keeps focus.
- **Find usages in the same popup.** Pick a symbol in Symbols and press
  **Ctrl+Enter** or **Shift+F12** to list its references. Type over the name to
  filter them by text or path, and use **Back** to restore your search.
- **Fast on large workspaces.** File search uses an in-memory index with fzf
  matching, and text search streams results from ripgrep.
- **Respects your ignore files.** `.gitignore`, `.searchignore`, and custom
  exclusion globs keep generated and vendored files out of your results.

## Getting Started

1. Install **search++** from the
   [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=expiracy.search-plus-plus),
   or run `code --install-extension expiracy.search-plus-plus`.
2. Press **Shift+Shift** to open the search popup.
3. Start typing. All six mode icons stay visible; click one or press **Tab** to
   cycle between search modes.

search++ requires VS Code 1.96 or a newer compatible release. See the
[changelog](CHANGELOG.md) for release notes and upgrade changes.

## Six Search Modes

| Mode | What it searches |
|------|------------------|
| **Everything** | Files, folders, text, symbols, and commands in grouped sections |
| **Files** | File names and paths across your workspace |
| **Folders** | Folders containing searchable files |
| **Text** | File contents (powered by ripgrep) |
| **Symbols** | Functions, classes and variables, with a drill-down to semantic usages |
| **Commands** | All VS Code commands (built-in and from extensions) |

<p align="center">
  <img src="media/everywhere.png" alt="Everything mode showing grouped file, text, and symbol results for 'preview'" width="720">
  <br><em>Everything: grouped results from every source</em>
</p>

| ![Files mode](media/files.png) | ![Folders mode](media/folders.png) |
|:---:|:---:|
| **Files**: fuzzy path matching | **Folders**: reveal a folder in the Explorer |
| ![Text mode](media/text.png) | ![Symbols mode](media/symbols.png) |
| **Text**: ripgrep matches with line previews | **Symbols**: from your language servers |
| ![Usages view](media/usages.png) | ![Commands mode](media/commands.png) |
| **Usages drill-down**: semantic references to a symbol | **Commands**: every VS Code command |

## Features

### Find Usages

Open **Symbols**, type a name, and select the matching symbol. **Enter** opens
its declaration. **Ctrl+Enter** (**Control+Return** on macOS) or **Shift+F12**
lists its references in the same popup. From **Everything**, select a symbol
and press **Shift+F12** or click its **Find Usages** button.

<p align="center">
  <img src="media/usages-filter.png" alt="Usages of SearchMode filtered to references whose text or path contains 'providers'" width="720">
  <br><em>Type over the symbol name to filter its references</em>
</p>

The popup shows the selected symbol in its title and search box. This is one
level deeper than choosing a symbol. **Back** restores the original query,
results, highlighted item, and search options without rerunning the search.
**Clear the search box** to start a fresh symbol search. Changing modes leaves
the usages drill-down.

To filter the current references, replace the symbol name directly with text or
a filename. Press **Enter** to jump to that exact reference. When the parent
search was in Symbols, clicking **Symbols** also restores it.

From an editor, use **search++: Find Usages** in the command palette or context
menu to find references to the symbol at the cursor. Without an editor symbol,
the command opens the symbol chooser.

References come from VS Code's language providers. Coverage depends on installed
language extensions and their indexing state; some language services start when
you open a source file. Declarations appear when the provider includes them.
Empty reference lists, unmatched filters, and language-provider failures have
separate messages. Git-ignore, search-ignore, and custom exclusions also apply to
references.

### Preview a Result

Press **Cmd+Right** on macOS or **Ctrl+Right** on Windows/Linux on a file, text,
symbol, or usage result to preview its file
while the popup keeps focus. Text matches jump to their line and column, with the
matched line at the top of the editor viewport where scrolling permits. Use the
Up/Down keys to select another result and the preview shortcut to view it in the same
additional editor tab, including when VS Code's preview tabs are disabled.
Existing tabs are reused. Files you edit, pin, or keep open are preserved.
Press **Enter** to open the selected result with its matching line at the top.
Folders, commands, and informational rows have no file preview.

Each previewable result has an **eye button**, including recent history. Hover
over it to see the preview shortcut, or click it to preview that row. Plain
**Right Arrow** moves the cursor through the search textbox normally.

![Previewing a text match: the editor shows the matched line while the popup stays open](media/preview.png)

### Go to Line and Column

On the **Files** or **Everything** tab, append `:line` or `:line:column` to jump to
a specific location. Line and column numbers start at 1:

```
searchModal.ts:42
searchModal.ts:42:5
```

Press **Control+Return** on macOS or **Ctrl+Enter** on Windows/Linux to autofill
the selected file's path, then type the line and
optional column after the inserted colon. The file remains searchable while you
type a column, such as `file.ts:42:`. Only numeric line and column suffixes are
interpreted as navigation.

![Typing modal:222 in Files mode and previewing line 222 of searchModal.ts](media/go-to-line.png)

### Go to File

Click the **Go to File** button on a file, text, symbol, usage, or recent-history
row to open its file in the current editor group. Matches retain their line and
column, including a location typed as `file:line:column`, and show the matching
line at the top of the editor viewport where scrolling permits. Confirmed opens
are added to recent history.

### Search Options

Toggle these while the search popup is open:

| Toggle | macOS | Windows / Linux | Description |
|--------|-------|-----------------|-------------|
| Case Sensitive | **Option+C** | **Alt+C** | Match exact case |
| Regex | **Option+R** | **Alt+R** | Use regular expressions for text search |
| Match Whole Word | **Option+W** | **Alt+W** | Only match complete words |
| Fuzzy Search | **Option+F** | **Alt+F** | Use fuzzy matching for paths, commands, and symbol candidates |
| Exclude Git Ignored | **Option+G** | **Alt+G** | Hide files excluded by `.gitignore` |
| Exclude Search Ignored | **Option+S** | **Alt+S** | Hide files excluded by `.searchignore` |

Regex applies to text search. Fuzzy matching applies to files, folders, commands,
symbols, and usage previews; text search uses literal text or a regular
expression. Match Whole Word uses literal matching for files, folders, commands,
and usage previews, and filters symbol names returned by the language provider.

### Absolute Path Support

On the **Files**, **Folders**, or **Everything** tab, enter a full filesystem path
such as `C:\Users\me\file.ts` or `/home/me/file.ts`. Select the result to open the
file or reveal the folder in the Explorer.

### Configure the Search Popup

Click the popup's cog, or run **search++: Open Settings** from the Command
Palette, to open the normal VS Code Settings page filtered to search++.

Under **Search popup**:

- **Show Everything Tab** controls the combined tab while keeping the individual
  enabled searches available.
- **Everything Tab Sources** has checkboxes for Files, Folders, Text, Symbols, and
  Commands. Unchecking a type hides both its tab and its results inside Everything.
- **Tab Order** arranges tabs and Everything groups together. To rearrange tabs,
  remove groups, then re-add them in the correct order. Unchecked sources are hidden
  from the popup.
- **When Search Opens** chooses a fixed starting tab or **Last used tab**.
- **Shortcut Preset** offers Default, VS Code, and IntelliJ, with an example and
  a link to view and customise the bindings in the native Keyboard Shortcuts editor.

Use the Settings page's **User** or **Workspace** tabs to choose where these
preferences apply. At least one search type stays enabled; unchecking the last
one restores the previous selection. If an opening choice is unavailable, the
first available tab opens. Direct search commands can still open a disabled type
temporarily without changing the checkbox choices.

### Remember Your Search Mode

Choose **Last used tab** in `searchPlusPlus.whenSearchOpens` to reopen the
last-used available tab, including after restarting VS Code. The default is
Everything. Commands such as **Search Files** still open their requested mode. Only the mode is saved;
search text and nested usage lookups are cleared when the popup closes. Returning
from a usages view opens the Symbols chooser.

### Search History

Recently opened files and locations appear when the search input is empty,
except in Symbols, which shows a search hint instead. History is stored per workspace. Use the remove button to delete an entry;
deleted-file entries are pruned in the background when another file is added to
history.

### Notebook Support

Text search includes cell source in Jupyter `.ipynb` notebooks. Selecting a match
opens the notebook. Navigation to the exact matching cell is unsupported.

## Search Coverage

search++ requires VS Code 1.96 or a newer compatible release. Folder search shows
folders containing files included by the current filters; empty directories do
not appear. Symbol and usage results depend on installed language extensions and their
indexing state.

Text search requires a filesystem workspace and a ripgrep executable on the
extension host. Filesystem workspaces can be searched on a remote extension host
when ripgrep is available there. Text search in virtual workspaces is unsupported.

## Keyboard Shortcuts

| macOS | Windows / Linux | Action | Context |
|-------|-----------------|--------|---------|
| **Shift+Shift** | **Shift+Shift** | Open search (Everything tab) | Global |
| **Tab** | **Tab** | Next search mode | Popup open |
| **Cmd+Right** | **Ctrl+Right** | Preview the selected file in one reusable tab | Popup open |
| **Right Arrow** | **Right Arrow** | Move the cursor through the search text | Search input |
| **Enter** | **Enter** | Open the selected result | Popup open |
| **Control+Return** | **Ctrl+Enter** | Show usages of the selected symbol | Symbols tab |
| **Shift+F12** | **Shift+F12** | Find usages of the selected symbol | Popup open |
| **Option+C** | **Alt+C** | Toggle case sensitive | Popup open |
| **Option+R** | **Alt+R** | Toggle regex | Popup open |
| **Option+W** | **Alt+W** | Toggle match whole word | Popup open |
| **Option+F** | **Alt+F** | Toggle fuzzy search | Popup open |
| **Option+G** | **Alt+G** | Toggle exclude git ignored | Popup open |
| **Option+S** | **Alt+S** | Toggle exclude search ignored | Popup open |
| **Control+Return** | **Ctrl+Enter** | Autofill file path | Files or Everything tab |

On macOS, **Option** is **⌥** and **Control** is **⌃**. The popup's shortcut hints
use the platform's modifier names.

Keymap extensions can claim the same shortcuts. If **Shift+F12** performs another
action, add this override to **Preferences: Open Keyboard Shortcuts (JSON)**:

```json
{
  "key": "shift+f12",
  "command": "searchPlusPlus.findUsages",
  "when": "searchPlusPlusModalOpen"
}
```

The rule applies while the popup is open. See VS Code's
[keyboard shortcut rules](https://code.visualstudio.com/docs/configure/keybindings#_keyboard-rules)
for how user overrides take precedence.

### Direct Search Shortcuts

Choose `searchPlusPlus.shortcutPreset` to open individual modes directly. It
defaults to **Default** (`none`). Selecting VS Code or IntelliJ redirects the
keys below from their usual commands to search++. For example, the VS Code preset
opens the Files tab with Cmd+P on macOS or Ctrl+P on Windows/Linux.

| Mode | VS Code preset (macOS / Windows & Linux) | IntelliJ preset (macOS / Windows & Linux) |
|------|-----------------------------------------|------------------------------------------|
| Files | Cmd+P / Ctrl+P | Cmd+Shift+O / Ctrl+Shift+N |
| Symbols | Cmd+T / Ctrl+T | Cmd+O / Ctrl+N |
| Text | Cmd+Shift+F / Ctrl+Shift+F | Cmd+Shift+F / Ctrl+Shift+F |
| Commands | Cmd+Shift+P / Ctrl+Shift+P | Cmd+Shift+A / Ctrl+Shift+A |

With the VS Code preset, **F1** still opens the native Command Palette. The
Symbols shortcut searches workspace symbols, rather than symbols only in the
current file. **Double Shift** and shortcuts used inside the popup are independent
of the preset. Switching back to **Default** disables the preset
bindings and preserves your custom keybindings.

Use **View and customise applied shortcuts** below the preset to open VS Code's
native Keyboard Shortcuts editor filtered to this extension. You can also open
**Preferences: Open Keyboard Shortcuts** and search for `search++`.

Other keymap extensions can claim the same keys, including Shift+Shift. Explicit
user bindings take precedence. For example, an IntelliJ keymap user can bind
**Search Files** to Cmd+Shift+O on macOS or Ctrl+Shift+N on Windows/Linux using
`searchPlusPlus.openFiles` in their own `keybindings.json`. See VS Code's
[keybinding rules](https://code.visualstudio.com/docs/configure/keybindings#_keyboard-rules).

## Commands

These commands are available from the command palette: **Cmd+Shift+P** on macOS
or **Ctrl+Shift+P** on Windows/Linux.

**Search**

| Command | Description |
|---------|-------------|
| `search++: Open Search` | Open the search popup (Everything tab) |
| `search++: Search Files` | Open directly to the Files tab |
| `search++: Search Text` | Open directly to the Text tab |
| `search++: Search Symbols` | Open directly to the Symbols tab |
| `search++: Search Commands` | Open directly to the Commands tab |
| `search++: Find Usages` | Find references to a selected symbol or the symbol at the editor cursor |
| `search++: Reindex Workspace` | Rebuild the file index |

**Toggles and Navigation**

These are also callable from the command palette and can be used in custom keybindings:

| Command | Description |
|---------|-------------|
| `search++: Toggle Case Sensitive` | Toggle case-sensitive matching |
| `search++: Toggle Regex` | Toggle regular expression matching |
| `search++: Toggle Only Git Trackable` | Toggle git-ignored file exclusion |
| `search++: Toggle Exclude Search Ignored` | Toggle `.searchignore` file exclusion |
| `search++: Toggle Fuzzy Search` | Toggle fuzzy matching |
| `search++: Toggle Match Whole Word` | Toggle whole-word matching |
| `search++: Next Tab` | Switch to the next tab |
| `search++: Previous Tab` | Switch to the previous tab |
| `search++: Preview Selected Result` | Preview the active result while keeping search focused |
| `search++: Autofill File Path` | Autofill the selected file's path |
| `search++: Open Settings` | Open the normal VS Code Settings page filtered to search++ |

## Settings

Click the cog at the far right of the popup's search row to open the normal
VS Code Settings page directly, filtered to search++. All settings are under
the `searchPlusPlus` namespace.
The Settings editor has two groups. Everything is part of the search popup;
ignore rules and excluded paths stay together under Search results:

| Group | Settings |
|-------|----------|
| **Search popup** | Show Everything Tab, Everything Tab Sources, Tab Order, When Search Opens, and Shortcut Preset |
| **Search results** | Results per Search Type, Results per Everything Group, Search Delay, Git Ignore Rules, Search Ignore Rules, and Excluded Paths |

| Setting | Default | Description |
|---------|---------|-------------|
| `searchPlusPlus.showEverythingTab` | `true` | Show the combined Everything tab |
| `searchPlusPlus.everythingTabSources` | All checked | Sources included in Everything and shown as individual tabs |
| `searchPlusPlus.tabOrder` | Everything, Files, Folders, Text, Symbols, Commands | Tab order, also used for Everything groups; remove groups and re-add them in the correct order |
| `searchPlusPlus.whenSearchOpens` | `"everywhere"` | Opening tab, or `"last"` to restore the last-used available tab |
| `searchPlusPlus.shortcutPreset` | `"none"` (Default) | Optional `vscode` or `intellij` opening shortcuts; the setting gives an example and links to individual bindings |
| `searchPlusPlus.resultsPerSearchType` | `200` | Maximum results returned per source: Files, Folders, Text, Symbols, or Commands |
| `searchPlusPlus.resultsPerEverythingGroup` | `20` | Maximum results displayed per Everything group (1-200) |
| `searchPlusPlus.searchDelay` | `300` | Typing delay in milliseconds for Text, Symbols, and Commands tabs and delayed Everything groups |
| `searchPlusPlus.gitIgnoreRules` | `true` | Hide files matched by `.gitignore` by default |
| `searchPlusPlus.searchIgnoreRules` | `true` | Hide files matched by `.searchignore` by default |
| `searchPlusPlus.excludedPaths` | `[]` | Glob patterns always excluded, including when ignore-file filters are off |

### Tabs and Result Groups

**Everything Tab Sources** controls the same types in tabs and Everything. **Tab
Order** controls mode buttons, keyboard Tab navigation, and Everything groups
together. To rearrange tabs, remove groups, then re-add them in the correct order.
Use the checkboxes to show or hide types.
Missing order entries are appended automatically. Changes apply immediately.

Earlier tab, source, order, and opening preferences carry over automatically in
their original User or Workspace scope. At the same scope, a type previously
disabled in either the tab or source controls stays disabled; tab order takes
precedence when the old orders disagree. Explicit choices in the new shared
controls take precedence. Invalid empty selections retain one usable search type.
Legacy `usages` entries map to Symbols without adding a duplicate tab. Workspace
preferences still override User settings. VS Code controls the native Command
Palette order independently.

Previous `enabledSearches`, `searchOrder`, `maxResults`, `everywhere.resultLimit`,
`debounceMs`, `excludeGitIgnored`, `excludeSearchIgnored`, and `excludePaths` values
carry over to their clearer names automatically. Ignore-rule changes apply
immediately without restarting the extension.

### `.searchignore`

Create a `.searchignore` file in your workspace to exclude files and folders from search results without modifying `.gitignore`. The file uses identical syntax to `.gitignore`.

```
# Hide generated docs from search
docs/
*.pdf

# Hide large data files
data/**
*.csv
```

Nested `.searchignore` files are supported. Patterns are scoped to the directory
containing the file, just like `.gitignore`. Changes reload the rules and rebuild
the index automatically; a manual reindex is unnecessary.

Toggle this filter on or off with **Option+S** on macOS or **Alt+S** on
Windows/Linux while the search popup is open.

### How Exclusions Layer

Exclusions are applied additively from three sources:

1. **Git ignored** -- `.gitignore` rules (**Option+G** on macOS, **Alt+G** on Windows/Linux)
2. **Search ignored** -- `.searchignore` rules (**Option+S** on macOS, **Alt+S** on Windows/Linux)
3. **Custom patterns** -- `searchPlusPlus.excludedPaths` (always applied)

Rules apply within each workspace root. Git's internal metadata is excluded from
workspace indexing and text searches, including when both toggles are off.

## Status Bar

The status bar shows the current state of the file index. Click it at any time to trigger a manual reindex.

| State | Icon | Meaning |
|-------|------|---------|
| Building | Spinner | A workspace snapshot is being built; the previous snapshot remains usable during rebuilds |
| Ready | Search | Index is ready; tooltip shows the file count |
| Stale | Warning | Bulk or directory changes detected; an automatic rescan is scheduled |
| Error | Error | Index build failed |

## Custom Keybindings

The extension sets context keys you can use in custom `keybindings.json` `when` clauses:

| Context Key | When it is `true` |
|-------------|-------------------|
| `searchPlusPlusModalOpen` | The search popup is open |
| `searchPlusPlusFileTab` | The Files tab or Everything tab is active |
| `searchPlusPlusEverythingTab` | The Everything tab is active |

Example:

```json
{
  "key": "ctrl+shift+f",
  "command": "searchPlusPlus.openText",
  "when": "!searchPlusPlusModalOpen"
}
```

## How It Works

- **File and folder search** uses an in-memory index built on activation, kept up to date by a file system watcher. Fuzzy matching is powered by [fzf](https://github.com/junegunn/fzf).
- **Text search** spawns [ripgrep](https://github.com/BurntSushi/ripgrep) with streaming JSON output for fast content search.
- **Symbol search** delegates to VS Code's workspace symbol providers, so results depend on your installed language extensions.
- **Usages** resolve semantic references for a selected symbol through VS Code’s language providers.
- **Command search** indexes all registered VS Code commands (built-in and from extensions).

See the [architecture documentation](ARCHITECTURE.md) for component responsibilities,
request flow, indexing, and backend behavior.

## Contributing

Bug reports and pull requests are welcome on
[GitHub](https://github.com/expiracy/search-plus-plus). See the
[contributing guide](CONTRIBUTING.md) for local development, validation, and
Marketplace releases.
