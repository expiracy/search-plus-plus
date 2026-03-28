# search++

A fast, unified search for VS Code inspired by JetBrains IDEs. Press **Shift+Shift** to search across files, folders, text, symbols, and commands, all in one place.

## Features

### Six Search Tabs

Cycle between tabs with **Tab** / **Shift+Tab**, or click the tab buttons in the title bar.

| Tab | What it searches |
|-----|-----------------|
| **Everywhere** | All of the below, combined into one view with grouped sections |
| **Files** | Filenames across your workspace |
| **Folders** | Folder paths extracted from your workspace |
| **Text** | File contents using ripgrep |
| **Symbols** | Functions, classes, variables, etc. via VS Code's language providers |
| **Commands** | All VS Code commands (built-in and from extensions) |

### Search Options

Toggle these while the search modal is open:

| Toggle | Shortcut | Description |
|--------|----------|-------------|
| Case Sensitive | **Alt+C** | Match exact case |
| Regex | **Alt+R** | Use regular expressions |
| Match Whole Word | **Alt+W** | Only match complete words |
| Fuzzy Search | **Alt+F** | Fuzzy matching (powered by fzf) |
| Exclude Git Ignored | **Alt+G** | Hide files excluded by `.gitignore` |

### Go to Line and Column

On the **Files** tab, append `:line` or `:line:column` to jump to a specific location:

```
searchModal.ts:42
searchModal.ts:42:5
```

Press the **Right Arrow** key to autofill the selected file's path, then type `:line:col`.

### Absolute Path Support

Type a full file path (e.g. `C:\Users\me\file.ts` or `/home/me/file.ts`) to stat it directly and open it from the result.

### Search History

Recently opened files appear when the search input is empty. Stale entries (deleted files) are automatically removed.

### Notebook Support

Text search includes Jupyter `.ipynb` notebook cells.

### Open to Side

Click the split-editor button on any file or text result to open it in a side panel.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Shift+Shift** | Open search (Everywhere tab) |
| **Tab** / **Shift+Tab** | Next / previous tab |
| **Alt+C** | Toggle case sensitive |
| **Alt+R** | Toggle regex |
| **Alt+W** | Toggle match whole word |
| **Alt+F** | Toggle fuzzy search |
| **Alt+G** | Toggle exclude git ignored |
| **Right Arrow** | Autofill file path (Files tab) |

You can also open a specific tab directly from the command palette:

- `search++: Search Files`
- `search++: Search Text`
- `search++: Search Symbols`
- `search++: Search Commands`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `searchPlusPlus.excludeGitIgnored` | `true` | Exclude git-ignored files by default |
| `searchPlusPlus.debounceMs` | `200` | Delay in ms before triggering search |
| `searchPlusPlus.maxResults` | `200` | Maximum results per search mode |
| `searchPlusPlus.excludePaths` | `[]` | Glob patterns to always exclude (e.g. `**/dist/**`, `**/*.min.js`) |

Exclusions are layered: VS Code's `files.exclude` and `search.exclude` settings, all `.gitignore` files in your workspace, and your custom `searchPlusPlus.excludePaths` patterns are all applied together.

## How It Works

- **File and folder search** uses an in-memory index built on startup, with a file watcher that keeps it up to date. Fuzzy matching is powered by the [fzf](https://github.com/junegunn/fzf) library.
- **Text search** spawns [ripgrep](https://github.com/BurntSushi/ripgrep) for fast content search with streaming JSON results.
- **Symbol search** delegates to VS Code's built-in workspace symbol providers, so results depend on your installed language extensions.
- **Command search** indexes all registered VS Code commands.

The status bar item shows the index state. Click it to trigger a manual reindex if needed.
