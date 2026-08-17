# Agent Instructions

Before opening a PR, update release metadata for the change:

- Bump the version in `package.json`, `package-lock.json`, `manifest.json`, and `manifest.firefox.json`.
- Add a new `### vX.Y.Z` entry at the top of the collapsible release notes section in `README.md`.
- Run `npm run check:release` and `npm test -- --run`.

The GitHub Actions release check enforces this on pull requests.
