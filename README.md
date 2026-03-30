# search++

A fast, unified search for VS Code inspired by JetBrains IDEs. Press **Shift+Shift** to search across files, folders, text, symbols, and commands -- all in one place.

## Getting Started

1. Install search++ from the VS Code Marketplace.
2. Press **Shift+Shift** to open the search modal.
3. Start typing to search. Use **Tab** / **Shift+Tab** to cycle between tabs.

| Tab | What it searches |
|-----|-----------------|
| **Everywhere** | All of the below, combined into grouped sections |
| **Files** | Filenames across your workspace |
| **Folders** | Folder paths in your workspace |
| **Text** | File contents (powered by ripgrep) |
| **Symbols** | Functions, classes, variables via VS Code's language providers |
| **Commands** | All VS Code commands (built-in and from extensions) |

## Features

### Search Options

Toggle these while the search modal is open:

| Toggle | Shortcut | Description |
|--------|----------|-------------|
| Case Sensitive | **Alt+C** | Match exact case |
| Regex | **Alt+R** | Use regular expressions |
| Match Whole Word | **Alt+W** | Only match complete words |
| Fuzzy Search | **Alt+F** | Fuzzy matching (powered by fzf) |
| Exclude Git Ignored | **Alt+G** | Hide files excluded by `.gitignore` |
| Exclude Search Ignored | **Alt+S** | Hide files excluded by `.searchignore` |
### Go to Line and Column

On the **Files** tab, append `:line` or `:line:column` to jump to a specific location:

```
searchModal.ts:42
searchModal.ts:42:5
```

Press the **Right Arrow** key to autofill the selected file's path, then type `:line:col`.

### Absolute Path Support

Type a full file path (e.g. `C:\Users\me\file.ts` or `/home/me/file.ts`) to open it directly from the results.

### Search History

Recently opened files appear when the search input is empty. Stale entries (deleted files) are automatically pruned. Individual history items can be removed via the remove button.

### Notebook Support

Text search includes Jupyter `.ipynb` notebook cells.

### Open to Side

Click the split-editor button on any file or text result to open it in a side editor group.

## Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Shift+Shift** | Open search (Everywhere tab) | Global |
| **Tab** / **Shift+Tab** | Next / previous tab | Modal open |
| **Alt+C** | Toggle case sensitive | Modal open |
| **Alt+R** | Toggle regex | Modal open |
| **Alt+W** | Toggle match whole word | Modal open |
| **Alt+F** | Toggle fuzzy search | Modal open |
| **Alt+G** | Toggle exclude git ignored | Modal open |
| **Alt+S** | Toggle exclude search ignored | Modal open |
| **Right Arrow** | Autofill file path | Files tab |

## Commands

These commands are available from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

**Search**

| Command | Description |
|---------|-------------|
| `search++: Open Search` | Open the search modal (Everywhere tab) |
| `search++: Search Files` | Open directly to the Files tab |
| `search++: Search Text` | Open directly to the Text tab |
| `search++: Search Symbols` | Open directly to the Symbols tab |
| `search++: Search Commands` | Open directly to the Commands tab |
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
| `search++: Autofill File Path` | Autofill the selected file's path |

## Settings

All settings are under the `searchPlusPlus` namespace.

| Setting | Default | Description |
|---------|---------|-------------|
| `searchPlusPlus.excludeGitIgnored` | `true` | Exclude git-ignored files by default |
| `searchPlusPlus.excludeSearchIgnored` | `true` | Exclude files matching `.searchignore` patterns by default |
| `searchPlusPlus.excludePaths` | `[]` | Glob patterns to always exclude (e.g. `**/dist/**`, `**/*.min.js`) |
| `searchPlusPlus.maxResults` | `200` | Maximum results per search mode |
| `searchPlusPlus.debounceMs` | `100` | Delay in ms before triggering search |
| `searchPlusPlus.everywhere.sections` | `["files", "folders", "text", "symbols", "commands"]` | Sections shown on the Everywhere tab; array order controls display order |
| `searchPlusPlus.everywhere.resultLimit` | `20` | Maximum results per section on the Everywhere tab (1-200) |

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

Nested `.searchignore` files are supported -- patterns are scoped to the directory containing the file, just like `.gitignore`. Changes to `.searchignore` files are detected automatically; no reindex is required.

Toggle this filter on or off with **Alt+S** while the search modal is open.

### How Exclusions Layer

Exclusions are applied additively from three sources:

1. **Git ignored** -- `.gitignore` rules (toggled with **Alt+G**)
2. **Search ignored** -- `.searchignore` rules (toggled with **Alt+S**)
3. **Custom patterns** -- `searchPlusPlus.excludePaths` (always applied)

## Status Bar

The status bar shows the current state of the file index. Click it at any time to trigger a manual reindex.

| State | Icon | Meaning |
|-------|------|---------|
| Building | Spinner | Workspace is being indexed |
| Ready | Search | Index is ready; tooltip shows the file count |
| Stale | Warning | Bulk file changes detected; index may be outdated |
| Error | Error | Index build failed |

## Custom Keybindings

The extension sets context keys you can use in custom `keybindings.json` `when` clauses:

| Context Key | When it is `true` |
|-------------|-------------------|
| `searchPlusPlusModalOpen` | The search modal is open |
| `searchPlusPlusFileTab` | The Files tab or Everywhere tab is active |
| `searchPlusPlusEverythingTab` | The Everywhere tab is active |

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
- **Command search** indexes all registered VS Code commands (built-in and from extensions).
