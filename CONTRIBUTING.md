# Contributing to search++

This guide covers local development, validation, and Marketplace releases. For
product documentation, see the [README](README.md).

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
version. The package includes the production bundle, third-party notices, manifest, documentation,
and `media/logo.png` as the icon. Development files, dependency trees, and all
other files in `media/` are excluded. The
`--githubBranch master` option rewrites README image links to files on GitHub's
`master` branch, so new or changed images appear on the Marketplace only after
they are merged into `master`. The command uses `--skip-license` because this
repository currently has no license file.

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
