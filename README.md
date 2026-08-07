<div align="center">

# Relations

**See how your notes connect.**

Visualise relationships between notes — for **worldbuilding**, **fiction**, **TTRPG campaigns**, **genealogies**, or any project where seeing how things connect matters. Note-driven via frontmatter, with portraits, typed line styles, true family-tree and graph-style family views, and embeddable graphs that work inside callouts and infoboxes.

<img width="709" height="810" alt="image" src="https://github.com/user-attachments/assets/938811de-7ead-4468-a994-87059f815126" />

[Install](#install) · [Quick start](#quick-start) · [Embedding](#embedding-a-graph-in-a-note) · [Family views](#family-views) · [Organization hierarchies](#organization-hierarchies) · [Legend](#the-legend) · [Settings](#relationship-types)

</div>

---

## Why

Obsidian's built-in graph shows every link in your vault, all at once, undifferentiated. **Relations** shows just the connections you care about — the ones you've explicitly named — and shows them with meaning: who's allied with whom, who's married, who's a rival, who descended from whom.

Useful for:

- **Worldbuilding** — factions, organisations, cities, gods, dynasties
- **Fiction writing** — story casts, dramatis personae, conflict webs
- **TTRPG campaigns** — NPC networks, allegiances, rivalries, family lines
- **Historical research** — genealogies, political networks, succession charts
- Anything else where you've got a cast of linked notes and want to *see* it

## Install

### Via Obsisian
The plugin can be installed via the [Community.Obsidian.md](https://community.obsidian.md/plugins/relations) site or directly from within Obsidian. 

### Via BRAT (recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is the standard way to install community plugins that aren't (yet) in Obsidian's official catalogue. It also handles updates automatically.

1. Install the **Obsidian42 - BRAT** plugin from Settings → Community plugins → Browse.
2. Open BRAT's settings and click **Add Beta plugin**.
3. Paste this repository URL: `https://github.com/Obsidian-TTRPG-Community/Relations`
4. Click **Add Plugin**. BRAT downloads it and installs.
5. Settings → Community plugins → enable **Relations**.

BRAT will notify you of updates and apply them when you click through.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/Obsidian-TTRPG-Community/Relations/releases).
2. Drop them into `<your-vault>/.obsidian/plugins/relations/` (create the folder if it doesn't exist).
3. In Obsidian, Settings → Community plugins → enable **Relations**.

## Quick start

Add a portrait and some relationships to any note's frontmatter:

```yaml
---
npcimage: "[[merlin-portrait.png]]"
ally:
  - "[[Arthur]]"
spouse: "[[Nimue]]"
mentor:
  - "[[Arthur]]"
family:
  - "[[Morgana]]"
---

# Merlin

The court magician of Camelot…
```

Open the graph from the **users** ribbon icon in the left sidebar, or run **Open Relations graph** from the command palette. Click any node to open that note. Right-click for *open in tab* / *open in pane*.

The view has a **Full** / **Active note** toggle:

- **Full** — every connected note in the vault.
- **Active note** — the currently open note plus everyone within N hops (configurable, 1–6).

## Embedding a graph in a note

Use a fenced code block with the `relations` language tag anywhere in a note:

````markdown
```relations
size: small
depth: 1
```
````

> [!TIP]
> Don't want to type the fences? Open the command palette and run **Insert relations code block** to drop a bare block at the cursor, or **Insert relations code block (with all options)** to get every option pre-filled as commented-out lines you can selectively enable.

> [!NOTE]
> ` ```npc-graph ` works too as a legacy alias if you have older notes from before the rename.

### Inside callouts and infoboxes

This is the killer feature for character sheets. Drop a `relations` block inside any callout — `[!info]`, `[!note]`, the popular **ITS Theme** infobox, the **Fancy a Story** fas-infobox, anything — and it auto-renders in compact "mini" mode: smaller portraits, no border, transparent background, tightly packed.

<img width="1022" height="632" alt="image" src="https://github.com/user-attachments/assets/73b66b8a-78d9-4511-b135-bc40a0341c13" />


````markdown
> [!infobox|right]
> # Merlin
> ![[merlin.png|cover hsmall]]
> ###### Relationships
> ```relations
> ```
````

The empty block uses sensible defaults — direct neighbours of the host note, mini size, depth 1. You can override with explicit `size: small` or `size: large` if you want the bigger format inside a callout.

### All code-block options

| Option        | Default                | Notes                                                                          |
|---------------|------------------------|--------------------------------------------------------------------------------|
| `size`        | `small`                | `mini` (~160px tall, infobox-friendly), `small` (~320px), `large` (~600px)    |
| `depth`       | size-dependent         | hops from the focus note. `mini` is forced to 1; `small` defaults to 1; `large` defaults to 3. Only relationships reachable within `depth` hops are drawn — `depth: 1` is the focus note's own relationships (hub-and-spoke), cross-links between two outermost nodes wait until the next depth. An explicit `depth` also bounds `scope: connected` |
| `scope`       | `local`                | `local` (this note + N hops), `connected` (everyone transitively linked to this note; bounded by `depth` if you set one) or `full` (entire vault) |
| `tree`        | `false`                | generic top-down dagre layout for any graph — not family-specific              |
| `family-graph`| `false`                | family view, **graph-style**: generation-aligned, drawn with Cytoscape edges (marriage / informal partnership / parent→child). [See below](#family-views). |
| `family-tree` | `false`                | family view, **true tree**: generation-aligned, drawn with orthogonal right-angle connectors. [See below](#family-views). |
| `org-graph`   | —                      | render a settings-defined [organization hierarchy](#organization-hierarchies) by name, force-directed layout. Replaces the relationship graph entirely for this block. |
| `org-tree`    | —                      | same, but top-down dagre layout instead of force-directed. |
| `zoom`        | `1.0`, `1.4` for mini  | zoom multiplier applied after fit. `1.5` or `"150%"` zooms in 50%             |
| `height`      | size default           | override the embed's height. Accepts `px`, `em`, `rem`, `vh`, `vw`, or `%`     |
| `center`      | host note              | wikilink or path of a different note to focus on, e.g. `"[[King Arthur]]"`     |
| `labels`      | (inherits setting)     | `true`/`false` to show or hide note names under nodes for this block, overriding the global **Show node labels** setting |
| `spacing`     | `1.0` (`0.55` in mini) | family views only: node spacing multiplier. Lower = tighter tree with shorter edges and larger nodes (good for infoboxes); higher = more spread out. Range `0.2`–`3` |
| `id`          | none                   | a stable identifier for this block. Required to **lock** the layout — see below |

## Family views

Relations has two layouts built for genealogy. Both are focused on the host note and align generations in horizontal rows — parents above, the focus and any partners on the middle row, children below. They differ only in **how connections are drawn**:

- **`family-tree`** — a true family tree, with orthogonal right-angle connectors.
- **`family-graph`** — the graph-style view, keeping Cytoscape's own typed edges.

<img width="1018" height="652" alt="image" src="https://github.com/user-attachments/assets/bfe50628-7580-45ed-a6c0-18a09cb666e9" />

<img width="1018" height="651" alt="image" src="https://github.com/user-attachments/assets/e06eeaf6-6479-4c95-8e40-da656d81f892" />

(These are distinct from the plain `tree` option, which is a generic top-down dagre layout for *any* graph and has no family-specific logic.)

```yaml
# Arthur's note
parent:
  - "[[Uther]]"
  - "[[Igraine]]"
spouse:
  - "[[Guinevere]]"
```

````markdown
```relations
size: large
family-tree: true
```
````

Swap `family-tree: true` for `family-graph: true` to get the graph-style version instead.

### `family-tree` — a true family tree

Bloodlines are drawn as classic right-angle connectors: a vertical drop from each parent couple, a horizontal distribution bar across the siblings, and an individual drop to each child. Marriage and partnership lines between partners keep their styled appearance (a heavy double line for `spouse`, a dotted line for an inferred partnership). The result reads like a hand-drawn family chart.

### `family-graph` — the graph-style view

Bloodlines stay as Cytoscape's own edges rather than right-angle connectors. This is the original family view — useful, compact, and quick to read, though less obviously "a tree":

- **Solid line** between two people = declared marriage (any `pair`-flagged relationship like `spouse`)
- **Dotted line** between two people = informal partnership (see below)
- **Arrowed line** = parent → child (genealogy edge), pointing in the natural reading direction

### Shared behaviour

Both views behave identically apart from the connector style:

- **Informal partnership is inferred automatically.** When two people share a child but have no declared marriage between them, a dotted partnership line appears. You don't have to model it — just declare the child's parents. (This line also gets its own legend entry; see [The legend](#the-legend).)
- **Declared spouses go to the LEFT** of the focus, **informal partners to the RIGHT** — a deterministic convention so the chart reads the same way every time, regardless of the order Obsidian indexed the frontmatter.
- **Only family appears** — ancestors, descendants, partners. Allies, enemies, mentors and other types are hidden so the family structure reads cleanly. Switch to the Full or Active-note views to see those.

### Use `scope: full` to see everything

By default a family view builds a neighbourhood around the active note. To show the whole vault's family in one view, add `scope: full`:

````markdown
```relations
size: large
family-tree: true
scope: full
```
````

### Tightening the tree for small embeds

In a narrow space — an infobox, a callout, a `mini` embed — the default spacing can leave nodes looking small and far apart, because the view zooms out to fit the whole tree. `mini` embeds already use tighter spacing automatically, but you can tune any family embed with `spacing`:

````markdown
```relations
size: small
family-tree: true
spacing: 0.5
```
````

Lower values pull nodes closer together (shorter edges, larger nodes once the view fits); higher values spread them out. The accepted range is `0.2` to `3.0`.

## Organization hierarchies

Beyond typed relationships, Relations can render a **rank structure** for a single note — an adventuring party's chain of command, a guild's ranks, a military hierarchy — using hierarchies you define yourself, instead of one hardcoded shape.

### Define a hierarchy

In **Settings → Relations → Organization hierarchies**, click **Add hierarchy**, name it (e.g. "Guild Ranks"), then define its levels:

| Level | Name       | Color                | Line   |
|-------|------------|-----------------------|--------|
| 1     | Master     | `#dc2626` red         | solid  |
| 2     | Journeyman | `#3b82f6` blue        | solid  |
| 3     | Apprentice | `#22c55e` green       | solid  |

- **Level** — position in the hierarchy (1 = top). Gaps (1, 2, 5) are fine; levels always display sorted by number.
- **Color** — the legend swatch color; also the ring color when a level has one member, or the hub node's fill color when it has several.
- **Line** — `solid` / `dashed` / `dotted` / `double`, for the connector from this level up to the level above it.
- **Self** (checkbox) — if this level's field is empty on the note, show the note itself as this level's member instead of skipping the level. Off by default. Useful when the note the code block lives on IS the top of the hierarchy — see [below](#the-note-itself-as-the-top-level).

At least two levels are required, and level numbers and names must be unique.

### Use it on a Group note

A level's name converts to a frontmatter field — lowercase, spaces become underscores (`Guild Masters` → `guild_masters`). List members under those fields:

```yaml
---
tags: [Category/Group]
master: "[[The Shadowhand]]"
journeyman:
  - "[[Vex]]"
  - "[[Morath]]"
apprentice:
  - "[[Kess]]"
  - "[[Dorn]]"
  - "[[Lira]]"
---
```

Then render it, the same way you'd embed any other graph:

````markdown
```relations
org-tree: Guild Ranks
```
````

`org-tree` lays the hierarchy out top-down (dagre); swap it for `org-graph` to lay it out force-directed instead — the same split as `family-tree`/`family-graph`. If both are set, `org-tree` wins.

> [!TIP]
> Command palette → **Insert organization hierarchy code block** drops in an editable `org-tree: Hierarchy Name` block (with `org-graph` included as a commented alternative) so you don't have to type the fences by hand.

### How it renders

- A level with a **single** member shows that member's own portrait directly, ringed in the level's color — no redundant placeholder node for a party of one.
- A level with **multiple** members gets a colored hub node labeled with the level's name — always visible regardless of the **Show node labels** setting, since it's structural information rather than decoration — with thin connectors fanning out to each member.
- Levels chain top-down, one connector per level pair, styled with the lower level's line setting.
- A level with no data on the note is skipped entirely — no empty box in the graph.
- An unresolved link (a typo'd wikilink, or a name with no matching note) still renders as a plain node instead of silently disappearing, so the mistake is visible.

Clicking a member node opens that note, same as any other graph; hub nodes aren't real notes, so clicking one does nothing. Layout locking, pan/zoom, and both layout engines all work the same as everywhere else in the plugin.

If the code block names a hierarchy that isn't configured, or the note has no data for any level of the named hierarchy, you'll get an inline error instead of a blank graph.

### The note itself as the top level

Some hierarchies don't have a natural note to name at the top — a worship hierarchy's top level is the deity, and the deity's own page is where you'd embed the graph. There's nothing to link to; the note itself IS that level.

Check **Self** on that level in the settings modal, and when its frontmatter field is empty, the note the code block is embedded on stands in as that level's sole member instead of the level being skipped:

```yaml
# Solari.md
worshippers:
  - "[[Kess]]"
  - "[[Dorn]]"
```

````markdown
```relations
org-tree: Worship Hierarchy
```
````

With **Self** checked on "Deity" and no `deity:` field on the note, Solari's own page appears at the top, ringed in the Deity level's color, chained down to the Worshippers hub — same as if `deity: "[[Solari]]"` had been declared explicitly. If a `deity:` field *is* present, it's used as normal; the note only stands in when the field is empty.

This also means a note using only the top level (nothing else filled in) still renders instead of showing "No members found" — the host note counts as that level's data.

## The legend

When **Show legend** is enabled (Settings → Relations, on by default), non-`mini` graphs show a legend strip listing every relationship type present in the view, each with its colour swatch drawn in that type's line style, plus a small symbol for one-way (→) and paired (⚭) types.

In a family view, the legend also gains an **informal partnership** entry — a dotted grey swatch — whenever the view contains an inferred (unmarried co-parent) partnership, so that automatically-drawn line is always explained.

The legend can be turned off globally in settings, and is always hidden in `mini` embeds to save space.

## Locking a layout in place

By default the graph lays itself out automatically each time it renders — which means a force-directed graph can shuffle slightly between refreshes, and any nodes you drag around snap back when the note re-renders. To pin everything exactly where you want it:

1. Drag the nodes into the arrangement you want.
2. Hover the graph and click the **lock** button in the top-right corner.

That's it. If the block doesn't already have an `id`, the plugin generates one (like `rel-7f3a9c2b`) and writes it into the code block for you — the id is what keys the saved positions, and having it in the block keeps the layout portable if you sync or share the note. You can rename it to something friendlier (e.g. `id: arthur-court`) any time.

The node positions are saved (in the plugin's own data) and restored on every future render — surviving note refreshes, switching away and back, and restarting Obsidian. While locked, the auto-layout is skipped so nothing reshuffles.

**Adjusting a locked layout.** You can keep dragging nodes after locking. When you've nudged things into a better arrangement, click the button again (it now shows a **save** icon) to capture the new positions — this updates the saved layout in place without resetting anything else, and without a disruptive re-render.

**Resetting.** A separate **reset** button (the circular arrow, shown next to the save button while locked) clears the saved positions and returns the graph to automatic layout.

If you'd rather set the `id` yourself up front, you still can:

````markdown
```relations
size: large
id: arthur-court
```
````

Notes:
- The `id` must be unique within your vault. Reusing the same `id` in two blocks makes them share one saved layout.
- Locking is per-block, stored by `id` — editing other parts of the note won't disturb it.
- If you add new related notes after locking, the new nodes appear via auto-layout while the locked ones stay put; drag them where you want and hit save to capture them.

## Relationship types

Configure types in **Settings → Relations**. Each type has a name (= frontmatter property name), a color, and a set of behaviour flags:

| Flag         | Effect                                                                                                                  |
|--------------|-------------------------------------------------------------------------------------------------------------------------|
| **Sym**      | Symmetric — declaring on either note creates the relationship both ways. Off = one-way (drawn with an arrow).           |
| **Pair**     | Pulls paired nodes very close, with a heavy connector. Use for `spouse`, `partner`, `bonded`.                            |
| **Tree**     | When this type dominates a graph (≥60% of edges), auto-switches to top-down layout.                                       |
| **Gen**      | Genealogy — counts as a bloodline edge in the family views (`family-tree` / `family-graph`). Typically `parent`. |
| **Child**    | For Gen types only: this property is written on the **parent's** note and names the child (e.g. a `children:` property). Relations flips the edge internally so it doesn't matter which side of a bond is declared — parent-side, child-side, or both produce the same tree, and a bond declared from both sides draws as a single line. |
| **Line**     | `solid`, `dashed`, `dotted`, or `double`. Useful for marking "secret", "former", "rumored" relationships.               |

Defaults shipped:

| Name    | Colour                | Sym | Pair | Tree | Gen | Line    |
|---------|-----------------------|:---:|:----:|:----:|:---:|---------|
| ally    | `#22c55e` emerald     | ✓   |      |      |     | solid   |
| enemy   | `#dc2626` crimson     | ✓   |      |      |     | solid   |
| family  | `#eab308` gold        | ✓   |      | ✓    |     | solid   |
| friend  | `#0891b2` deep cyan   | ✓   |      |      |     | solid   |
| rival   | `#fb923c` tangerine   | ✓   |      |      |     | dashed  |
| spouse  | `#d946ef` fuchsia     | ✓   | ✓    |      |     | double  |
| lover   | `#fb7185` rose        | ✓   |      |      |     | dashed  |
| mentor  | `#8b5cf6` violet      |     |      |      |     | dotted  |
| parent  | `#b45309` bronze      |     |      | ✓    | ✓   | solid   |

The palette is chosen so each line is distinguishable from every other at the typical edge widths used in the graph view, on both Obsidian dark and light themes. Greens read as positive, reds and oranges as adversarial, gold and bronze as kinship, pinks as romantic, violet for the asymmetric mentor relationship.

![Palette](docs/palette.png)

Rename, recolour, add, or delete freely — they're just defaults.

## Portraits

The portrait property name is configurable in settings (default: `npcimage`). Accepted forms:

```yaml
npcimage: "[[merlin.png]]"                     # vault wikilink (recommended)
npcimage: "Assets/Portraits/merlin.png"        # vault path
npcimage: "https://example.com/merlin.png"     # external URL
```

The plugin uses Obsidian's resource path resolution, so vault images load even if your vault isn't web-served.

<details>
<summary><b>Frontmatter formats accepted</b> for relationship properties (click to expand)</summary>

```yaml
ally: "[[Bob]]"                     # single
ally: ["[[Bob]]", "[[Alice]]"]      # YAML inline list
ally:                               # YAML block list
  - "[[Bob]]"
  - "[[Alice]]"
ally: "[[Bob]], [[Alice]]"          # comma-separated
```

Aliases (`[[Bob|Bobby]]`) and headings (`[[Bob#background]]`) are normalised to the file link.

</details>

<details>
<summary><b>Including notes in the graph</b> — folder and tag scoping (click to expand)</summary>

By default, any note with at least one configured relationship property qualifies. Notes pointed at by another note's relationship are pulled in too.

For stricter scoping, set **Folder scope** or **Required tags** in settings:
- **Folder scope** — only scan notes under specific folders, e.g. `World/People, World/Factions`.
- **Required tags** — only include notes with one of these tags, e.g. `character, organisation`.

Useful if your vault has lots of incidental wikilinks you don't want polluting the graph.

</details>

## Building from source

```bash
git clone https://github.com/Obsidian-TTRPG-Community/Relations.git
cd Relations
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/relations/` and enable the plugin.

## Roadmap

- Filter chips by relationship type / tag inside the graph
- Edit relationships directly from the graph (right-click → add ally)
- Per-relationship metadata (notes, strength) via richer frontmatter
- Group/cluster by faction tag
- Export graph as PNG/SVG

## Acknowledgements

Built on [Cytoscape.js](https://js.cytoscape.org/) for graph rendering, with [fcose](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) for force-directed layouts and [dagre](https://github.com/cytoscape/cytoscape.js-dagre) for top-down trees.

## License

[MIT](./LICENSE).
