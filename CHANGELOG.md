# Changelog

All notable changes to this project will be documented here. This file is
maintained by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commits](https://www.conventionalcommits.org/).

## [0.15.2] - 2026-06-02

### Added

- **Inline edge labels** — double-click any relationship line to add a short label like "hates them 75%", "married 1485", or "estranged". Labels are stored in plugin data, follow the line as nodes move, and persist across sessions. Works on both Cytoscape-drawn edges (spouse, ally, enemy, etc.) and the orthogonal SVG connectors in family-tree mode.
- **Informal partnership in the legend** — when the graph contains co-parents who share a child but have no declared marriage, "informal partnership" now appears as a legend entry alongside the configured relationship types.

### Changed

- **Upgraded esbuild to 0.25.0** and @types/node to 20.x for current Node compatibility.

### Fixed

- **Version-consistency guard in release workflow** — the build now fails loudly if the git tag doesn't match `manifest.json`'s version, preventing the BRAT "version mismatch detected" warning that affected 0.15.1.
- **Auto-generated release notes** — releases now pull notes from `CHANGELOG.md` (maintained by release-please) instead of relying on raw commit messages.

### Infrastructure

- Added release-please workflow so `feat:` / `fix:` commits on `main` automatically open a release PR with version bumps and changelog updates.
- Added `scripts/sync-versions.mjs` to keep `versions.json` aligned with `manifest.json` automatically during the release-please flow.
