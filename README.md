# search++

A unified search for VS Code inspired by JetBrains IDEs. Press **Shift+Shift** to
search workspace files, folders, text, symbols, usages, and commands in one popup.

![Everything tab](media/everywhere.png)

## Getting Started

1. Install search++ from the VS Code Marketplace.
2. Press **Shift+Shift** to open the search modal.
3. Start typing to search. All seven mode icons stay visible; click one or use
   **Tab** to cycle between search modes.

| Tab | What it searches |
|-----|-----------------|
| **Everything** | Files, folders, text, symbols, and commands in grouped sections |
| **Files** | File names and paths across your workspace |
| **Folders** | Folders containing searchable files |
| **Text** | File contents (powered by ripgrep) |
| **Symbols** | Functions, classes, variables via VS Code's language providers |
| **Usages** | Find a symbol, then list its semantic references |
| **Commands** | All VS Code commands (built-in and from extensions) |

| ![Files](media/files.png) | ![Folders](media/folders.png) | ![Text](media/text.png) |
|:---:|:---:|:---:|
| Files | Folders | Text |

| ![Symbols](media/symbols.png) | ![Commands](media/commands.png) |
|:---:|:---:|
| Symbols | Commands |

## Features

### Search Options

Toggle these while the search modal is open:

| Toggle | Shortcut | Description |
|--------|----------|-------------|
| Case Sensitive | **Alt+C** | Match exact case |
| Regex | **Alt+R** | Use regular expressions for text search |
| Match Whole Word | **Alt+W** | Only match complete words |
| Fuzzy Search | **Alt+F** | Use fuzzy matching for paths, commands, and symbol candidates |
| Exclude Git Ignored | **Alt+G** | Hide files excluded by `.gitignore` |
| Exclude Search Ignored | **Alt+S** | Hide files excluded by `.searchignore` |

Regex applies to text search. Fuzzy matching applies to files, folders, commands,
symbols, and usage previews; text search uses literal text or a regular
expression. Match Whole Word uses literal matching for files, folders, commands,
and usage previews, and filters symbol names returned by the language provider.

### Find Usages

Open **Usages**, type a symbol name, select the matching symbol, and press
**Enter** to list its references. You can also select a symbol in **Symbols** or
**Everything**, then press **Shift+F12** or click its **Find Usages** button.

The popup shows the selected symbol in its title. Type text or a filename to
filter its reference previews and paths. Select a result to jump to that exact
reference. Click the **Usages** mode icon again to choose another symbol;
returning to **Symbols** restores the original symbol query.

From an editor, use **search++: Find Usages** in the command palette or context
menu to find references to the symbol at the cursor. Without an editor symbol,
the command opens the symbol chooser.

References come from VS Code's language providers. Coverage depends on installed
language extensions and their indexing state; declarations appear when the
provider includes them. Empty reference lists and language-provider failures are
shown separately. Git-ignore, search-ignore, and custom exclusions also apply to
references.

### Go to Line and Column

On the **Files** or **Everything** tab, append `:line` or `:line:column` to jump to
a specific location. Line and column numbers start at 1:

```
searchModal.ts:42
searchModal.ts:42:5
```

Press **Ctrl+Enter** to autofill the selected file's path, then type the line and
optional column after the inserted colon.

### Absolute Path Support

On the **Files**, **Folders**, or **Everything** tab, enter a full filesystem path
such as `C:\Users\me\file.ts` or `/home/me/file.ts`. Select the result to open the
file or reveal the folder in the Explorer.

### Search History

Recently opened files and locations appear when the search input is empty,
except in Usages mode. History is stored per workspace. Use the remove button to delete an entry;
deleted-file entries are pruned in the background when another file is added to
history.

### Notebook Support

Text search includes cell source in Jupyter `.ipynb` notebooks. Selecting a match
opens the notebook. Navigation to the exact matching cell is unsupported.

### Preview a Result

Press **Right Arrow** on a file, text, symbol, or usage result to preview its file
while the popup keeps focus. Text matches jump to their line and column. Use the
arrow keys to select another result and **Right Arrow** to preview it in the same
additional editor tab, including when VS Code's preview tabs are disabled.
Existing tabs are reused. Files you edit, pin, or keep open are preserved.
Press **Enter** to open the selected result normally. Folders, commands, and
informational rows have no file preview.

### Open to Side

Click the split-editor button on any file or text result to open it in a side editor group.

## Search Coverage

search++ requires VS Code 1.96 or a newer compatible release. Folder search shows
folders containing files included by the current filters; empty directories do
not appear. Symbol and usage results depend on installed language extensions and their
indexing state.

Text search requires a filesystem workspace and a ripgrep executable on the
extension host. Filesystem workspaces can be searched on a remote extension host
when ripgrep is available there. Text search in virtual workspaces is unsupported.

## Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Shift+Shift** | Open search (Everything tab) | Global |
| **Tab** | Next search mode | Modal open |
| **Right Arrow** | Preview the selected file in one reusable tab | Modal open |
| **Shift+F12** | Find usages of the selected symbol | Modal open |
| **Alt+C** | Toggle case sensitive | Modal open |
| **Alt+R** | Toggle regex | Modal open |
| **Alt+W** | Toggle match whole word | Modal open |
| **Alt+F** | Toggle fuzzy search | Modal open |
| **Alt+G** | Toggle exclude git ignored | Modal open |
| **Alt+S** | Toggle exclude search ignored | Modal open |
| **Ctrl+Enter** | Autofill file path | Files or Everything tab |

## Commands

These commands are available from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

**Search**

| Command | Description |
|---------|-------------|
| `search++: Open Search` | Open the search modal (Everything tab) |
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

## Settings

All settings are under the `searchPlusPlus` namespace.

| Setting | Default | Description |
|---------|---------|-------------|
| `searchPlusPlus.excludeGitIgnored` | `true` | Exclude git-ignored files by default |
| `searchPlusPlus.excludeSearchIgnored` | `true` | Exclude files matching `.searchignore` patterns by default |
| `searchPlusPlus.excludePaths` | `[]` | Glob patterns to always exclude (e.g. `**/dist/**`, `**/*.min.js`) |
| `searchPlusPlus.maxResults` | `200` | Maximum results per search mode |
| `searchPlusPlus.debounceMs` | `300` | Delay in ms before debounced text, symbol, usage, and command searches |
| `searchPlusPlus.everywhere.sections` | `["files", "folders", "text", "symbols", "commands"]` | Sections shown on the Everything tab; array order controls display order |
| `searchPlusPlus.everywhere.resultLimit` | `20` | Maximum results per section on the Everything tab (1-200) |

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

Toggle this filter on or off with **Alt+S** while the search modal is open.

### How Exclusions Layer

Exclusions are applied additively from three sources:

1. **Git ignored** -- `.gitignore` rules (toggled with **Alt+G**)
2. **Search ignored** -- `.searchignore` rules (toggled with **Alt+S**)
3. **Custom patterns** -- `searchPlusPlus.excludePaths` (always applied)

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
| `searchPlusPlusModalOpen` | The search modal is open |
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

## Development and Validation

Use Node.js 22 (`nvm use`), run `npm ci`, then `npm run check` to type-check, lint,
test, and build the extension. Tests in `test/` include real ripgrep fixtures and
deterministic checks for indexing and request cancellation.

Run `npm run test:host` for a smoke test in an isolated VS Code window. On macOS it
uses `/Applications/Visual Studio Code.app`; elsewhere it uses `code` on PATH. Set
`VSCODE_EXECUTABLE_PATH` to test another installation. The runner copies its fixture
workspace into a temporary directory and checks activation, search providers,
exclusions, real TypeScript symbol-to-reference navigation, popup commands, and
reindexing.

Set `VSCODE_VERSION=1.96.0` or `VSCODE_VERSION=stable` to download and test a specific
VS Code release through the official extension test runner. Linux CI runs these
tests under `xvfb-run`.

See the [architecture documentation](ARCHITECTURE.md) for component responsibilities,
request flow, indexing, and backend behavior.

## Packaging and Marketplace Releases

This project ships as a VS Code extension. `private: true` prevents accidental npm
registry publication; npm manages the development tools and scripts.

`npm run package` builds `search-plus-plus.vsix` using the locked `@vscode/vsce`
version. The package includes the production bundle, third-party notices, manifest, documentation, icon,
and screenshots. Development files and dependency trees are excluded. The command
uses `--skip-license` because this repository currently has no license file.

Every branch push and pull request runs checks on Linux, macOS, and Windows, plus
extension-host smoke tests against VS Code 1.96.0 and current stable. Once those
checks pass, CI builds and retains the VSIX as the `search-plus-plus-vsix` artifact
for 14 days.

Marketplace publication runs only when a stable version tag in the form `vX.Y.Z`
is pushed. The workflow repeats validation, requires the tag to match `package.json`
and both versions in `package-lock.json`, and requires the tagged commit to be in
`master`. It publishes the validated VSIX artifact using the `VSCE_PAT`
repository secret. The token is available only to the publishing step.

To publish a release:

1. Merge the release changes into `master` and update your local checkout.
2. Run `npm ci` and `npm run check`.
3. Choose the version increment with `npm version major`, `npm version minor`,
   or `npm version patch`. This updates both package manifests and creates a
   version commit and tag.
4. Push `master` and the specific tag created by the version command with
   `git push origin master <tag>`, replacing `<tag>` with that version tag.
5. Check the **Publish to VS Code Marketplace** workflow for validation and
   publication results.

Each release needs a new version. Reusing a published version causes the publish
step to fail.

The workflows pin action commits and use a cached, locked npm install. The install
step receives the read-only GitHub job token so ripgrep binary downloads avoid
anonymous API rate limits. Publishing credentials must retain Marketplace
publishing access. Microsoft recommends
[identity-based publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
and is retiring global Azure DevOps PATs on December 1, 2026; migrate the existing
credential setup before that deadline if it uses a global PAT.
