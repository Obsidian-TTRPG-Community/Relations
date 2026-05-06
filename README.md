# PF2e Kingmaker — Kingdom Manager

> An Obsidian plugin for running **Pathfinder 2e Kingmaker** — a complete digital kingdom-management tracker that lives inside your campaign vault.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.0.0%2B-7c3aed)](https://obsidian.md)
[![Pathfinder](https://img.shields.io/badge/Pathfinder-2e%20Kingmaker-c8102e)](https://store.paizo.com/pathfinder/pathfinder-second-edition/adventure-paths/kingmaker/)

Replaces the paper Kingdom Management Tracker with six interconnected Obsidian codeblocks: a hex map, settlement urban grids, the kingdom sheet, the per-turn activity workflow, an army roster, and the event resolution log. Everything updates live, rolls itself, and persists in your vault.

> **Companion tool, not a replacement for the rulebook.** This plugin scaffolds the bookkeeping. For the actual rules, please [buy the Kingmaker Adventure Path](https://store.paizo.com/pathfinder/pathfinder-second-edition/adventure-paths/kingmaker/) — and the [free Kingmaker Player's Guide PDF](https://paizo.com/products/btpy8dqh) is the canonical source for the kingdom-building rules the plugin paraphrases.

---

## Highlights

- **🗺️ Hex map** — Click to claim hexes, set terrain, drop worksites, build roads. Auto-derives kingdom size and Control DC.
- **🏰 Settlement urban grid** — A 3×3 block layout (36 lots) per settlement. Click a lot, pick from 47 buildings, watch stats update live.
- **📜 Kingdom sheet** — Identity, abilities, ruin tracks, leadership (all 11 roles), kingdom feats, cross-settlement roll-up. Click any field to edit.
- **⚔️ Per-turn workflow** — Phase pills walk you through Upkeep → Commerce → Leadership → Activity → Event. Rolls dice, classifies success, applies outcomes.
- **🛡️ Army roster** — Editable stat blocks with picker dropdowns for ~45 tactics and ~18 war-gear options. Recruit Army auto-creates units.
- **⚡ Event engine** — 20 catalogued events. Continuous events tick each Upkeep; critical failures worsen them.
- **✨ Level-up wizard** — Banner appears when XP hits 1000. Walk through ability boosts, skill increases, and a feat from the ~50-entry catalogue.
- **🎲 Half-auto rolling** — Engine rolls and classifies; you confirm, override, or add GM notes before applying. No fighting the tool.

---

## Installation

### Via BRAT (recommended for now)

The plugin is in beta and not yet listed in the official Obsidian Community Plugins. To install:

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Open the Command Palette and run **BRAT: Add a beta plugin for testing**
3. Paste the repo URL: `https://github.com/Obsidian-TTRPG-Community/PF2e-Kingmaker-KingdomManager`
4. BRAT will install the plugin and keep it updated automatically

### Manual install

1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/Obsidian-TTRPG-Community/PF2e-Kingmaker-KingdomManager/releases/latest)
2. Create the folder `<vault>/.obsidian/plugins/kingdom-manager/` and drop the three files into it
3. Reload Obsidian (Ctrl/Cmd+R) and enable **PF2e Kingmaker - Kingdom Manager** in **Settings → Community plugins**

---

## Getting started

1. Open any note where you want to track a kingdom
2. Open the Command Palette (Ctrl/Cmd+P) and run **Set up new kingdom (insert blocks at cursor)**
3. Fill in the wizard — only the kingdom name is required
4. Click **Create kingdom and insert blocks**

The plugin pre-creates the kingdom record and inserts six codeblocks at your cursor: hex map, capital settlement, kingdom sheet, kingdom turn, army roster, kingdom events. Everything is editable in-place from there.

> **Tip:** rename your note to match the kingdom's name (e.g. "Brevoy Reborn") so Obsidian wiki-links from session notes and NPC pages just work.

---

## Codeblock reference

| Codeblock | Purpose |
|---|---|
| `kingdom-hex` | Territory map with terrain, worksites, and roads |
| `kingdom-settlement` | Urban-grid editor for a single settlement |
| `kingdom-sheet` | Identity, abilities, ruin, leadership, feats, roll-up |
| `kingdom-turn` | Per-turn activity workflow with half-auto rolling |
| `kingdom-armies` | Editable army stat blocks with tactics and gear |
| `kingdom-events` | Active and historical events; resolution and ticking |

Every codeblock takes a `kingdom: <name>` field that links it to a kingdom record. The settlement codeblock additionally takes `id` and `name`. Example:

````markdown
```kingdom-sheet
kingdom: Brevoy Reborn
```

```kingdom-settlement
id: new-stetven
name: New Stetven
kingdom: Brevoy Reborn
```
````

---

## Commands

| Command | What it does |
|---|---|
| **Set up new kingdom (insert blocks at cursor)** | Main onboarding wizard |
| **Level up kingdom (open wizard)** | Opens the level-up wizard if any kingdom has ≥1000 XP |
| **Insert kingdom sheet codeblock** | Inserts a single `kingdom-sheet` block |
| **Insert kingdom turn codeblock** | Inserts a single `kingdom-turn` block |
| **Insert kingdom hex map codeblock** | Inserts a single `kingdom-hex` block |
| **Insert kingdom armies codeblock** | Inserts a single `kingdom-armies` block |
| **Insert kingdom events codeblock** | Inserts a single `kingdom-events` block |
| **Insert settlement codeblock** | Inserts a single `kingdom-settlement` block |
| **Reload building images from plugin folder** | Re-scan `building_images/` for PNG overrides |
| **Reset ALL settlement & kingdom data (irreversible)** | Wipes every record stored by the plugin |

---

## Design philosophy

**Half-auto.** The engine rolls dice, classifies success tiers, and tracks kingdom state, but every applied effect goes through a confirm / override / GM-notes step. The plugin does the bookkeeping; you make the table-side calls.

This shows up everywhere:

- Activity rolls show a result tier with an **Override** dropdown and a **GM notes** field
- Event resolution lets you reroll, override the outcome, or add adjudication notes
- Each army has a **House rules / overrides** free-text field
- Each event instance has a **Notes** field
- Continuous-event ticking is button-driven (not automatic each phase change)
- Level-up choices have a final **Review** step before any state mutates

**Catalogues, not engines.** The plugin includes catalogues for buildings (~47), activities (~30), events (~20), army tactics (~45), war gear (~18), and kingdom feats (~50). All catalogue data is best-effort modelled from the AP appendices. Feat mechanical effects, building bonuses, and tactic edge cases are surfaced as rules-text references for GM-driven application — they don't auto-fire. This keeps the plugin tractable and respects the way Kingmaker actually plays at the table.

---

## Building art pack

The plugin ships with simple abstract building tokens. For the published Kingmaker AP token art, a separate `kingdom-manager-art-pack.zip` is available. Extract the PNGs into `<plugin folder>/building_images/` and run **Reload building images from plugin folder** (or restart Obsidian).

The art pack is for **personal use only** — Paizo retains copyright on the published images, so it's not bundled into the main release.

---

## Legal & acknowledgements

**Plugin code: MIT License.** The plugin's code is released under the MIT License (see [LICENSE](LICENSE)). You're free to fork, modify, and redistribute the code; please retain attribution.

**Paizo Community Use.** This plugin uses trademarks and/or copyrights owned by Paizo Inc., used under [Paizo's Community Use Policy](https://paizo.com/communityuse). We are expressly prohibited from charging you to use or access this content. This plugin is not published, endorsed, or specifically approved by Paizo. For more information about Paizo Inc. and Paizo products, please visit [paizo.com](https://paizo.com).

The MIT License above applies to the plugin's code. Trademarked names, descriptions, and rules text from the Pathfinder 2e Kingmaker Adventure Path referenced by the plugin's catalogues remain the property of Paizo Inc.

**Building art pack (separate).** The separately-distributed building art pack contains derivative imagery of Paizo's published Kingmaker token art and is for personal use only. It is **NOT** covered by the MIT License above and ships separately from the main plugin release for that reason.

---

## Support Paizo

If you're going to run Kingmaker, please support Paizo:

- **[Pathfinder Kingmaker Adventure Path](https://store.paizo.com/pathfinder/pathfinder-second-edition/adventure-paths/kingmaker/)** — the full 640-page hardcover including kingdom rules, warfare rules, and the AP itself
- **[Kingmaker Player's Guide (free PDF)](https://paizo.com/products/btpy8dqh)** — spoiler-safe, contains the kingdom-building and warfare rules

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
