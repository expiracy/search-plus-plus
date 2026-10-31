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

Every non-master branch push and pull request runs checks on Linux, macOS, and
Windows, plus extension-host smoke tests against VS Code 1.96.0 and current stable. Once those
checks pass, CI builds and retains the VSIX as the `search-plus-plus-vsix` artifact
for 14 days.

Marketplace publication is manual. Merging to `master` does not trigger validation,
publication, or Pages deployment. Pull requests and non-master branch pushes
still run validation automatically.

To publish a release:

1. Merge the changes you want to release into `master`.
   Add a matching version section to `CHANGELOG.md` describing what users will
   receive, for example `## 3.1.0 — 2026-10-31`. The workflow requires non-empty
   notes for the chosen version and uses them for the GitHub release. The same
   changelog is included in the VSIX and checked before publishing.
2. Open **Actions → Release search++ → Run workflow** and select **master**.
3. Enter the new stable version, such as `3.1.0`, without a `v` prefix. It must be
   newer than the version in `package.json`.
4. Run the workflow. It prepares all manifest versions, runs the cross-platform
   checks and VS Code smoke tests, and packages a VSIX with your chosen version.
5. After validation, it commits the version to `master`, creates the matching
   `vX.Y.Z` tag, publishes that validated VSIX to the Marketplace, creates a GitHub
   release with the changelog notes and VSIX attached, and deploys the site from
   the release tag.

The publishing job needs the existing `VSCE_PAT` repository secret and write
access for `GITHUB_TOKEN` to record the release commit and tag. Only the Marketplace
credential steps receive `VSCE_PAT`. The input is validated before use and is
passed through environment variables rather than interpolated into shell code.

If publishing fails after the tag is recorded, rerun the failed jobs from the
same Actions run. A retry checks that the existing tag matches the validated
source tree, skips an already-published Marketplace version, and reuses an
existing GitHub release. A concurrent change to `master` rejects the release
push; start a new run from the updated branch. Pushing tags alone no longer
starts publication.

## Project Website

The GitHub Pages site lives in `site/`. `npm run build:site` assembles it in
`_site/` with the images from `media/` and the version from `package.json`;
serve that folder locally to preview it. The manual release workflow rebuilds
and publishes the site from its release tag. To deploy the site separately, open **Deploy GitHub Pages** on the
**Actions** page and choose **Run workflow**. The repository's Pages source must be set to
**GitHub Actions**.

The workflows pin action commits and use a cached, locked npm install. The install
step receives the read-only GitHub job token so ripgrep binary downloads avoid
anonymous API rate limits. Publishing credentials must retain Marketplace
publishing access. Microsoft recommends
[identity-based publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
and is retiring global Azure DevOps PATs on December 1, 2026; migrate the existing
credential setup before that deadline if it uses a global PAT.
