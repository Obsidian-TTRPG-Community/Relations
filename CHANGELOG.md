# Changelog

All notable changes to this project will be documented here. This file is
maintained by [release-please](https://github.com/googleapis/release-please)
from [Conventional Commits](https://www.conventionalcommits.org/).

## [0.16.0](https://github.com/Obsidian-TTRPG-Community/Relations/compare/0.15.2...0.16.0) (2026-06-02)


### Features

* inline edge labels + release automation ([ef9b154](https://github.com/Obsidian-TTRPG-Community/Relations/commit/ef9b154aca79a03831ee17c752c87b0841a21803))
* orthogonal SVG connectors for family-graph mode ([0f3232e](https://github.com/Obsidian-TTRPG-Community/Relations/commit/0f3232e7a17d25ec266c03fac447c8a438f3b68f))
* orthogonal SVG connectors for family-graph mode ([b410cbc](https://github.com/Obsidian-TTRPG-Community/Relations/commit/b410cbc4c69086fc88797f6af3b4cbc23abff2a0))
* respect depth in family-graph/family-tree modes ([2ba6d2f](https://github.com/Obsidian-TTRPG-Community/Relations/commit/2ba6d2fa4d5aeb41be3acce889dfe26375c19ea5))
* respect depth parameter in family-graph/family-tree modes ([86e28b9](https://github.com/Obsidian-TTRPG-Community/Relations/commit/86e28b9ea1adb108f44af2e75fc84c85f6cd01ed))


### Bug Fixes

* adopt author naming, fix cy leak, harden preset guard ([b30b8a8](https://github.com/Obsidian-TTRPG-Community/Relations/commit/b30b8a85221b3d70c20536d2f01ac76974bc0492))
* back-port 0.11.0–0.12.2 features to TypeScript source ([34558dc](https://github.com/Obsidian-TTRPG-Community/Relations/commit/34558dc852bddfc083b6b033efcd0c9a5c50adad))
* offset lock controls to avoid Obsidian source toggle ([66f2c3d](https://github.com/Obsidian-TTRPG-Community/Relations/commit/66f2c3d6bf203d74442377f2932c1f994c0ae2fb))

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
