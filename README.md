<div align="center">

# Relations

**See how your notes connect.**

Visualise relationships between notes — for **worldbuilding**, **fiction**, **TTRPG campaigns**, **genealogies**, or any project where seeing how things connect matters. Note-driven via frontmatter, with portraits, typed line styles, a focused family view, and embeddable graphs that work inside callouts and infoboxes.

![Relations graph preview](docs/preview-graph.png)

[Install](#install) · [Quick start](#quick-start) · [Embedding](#embedding-a-graph-in-a-note) · [Family views](#family-views) · [Settings](#relationship-types)

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

![Inside an ITS infobox](docs/preview-infobox.png)

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
| `depth`       | size-dependent         | hops from the focus note. `mini` is forced to 1; `small` defaults to 1; `large` defaults to 3 |
| `scope`       | `local`                | `local` (this note + N hops) or `full` (entire vault)                          |
| `tree`        | `false`                | force generic top-down dagre layout                                            |
| `family-tree` | `false`                | classical chart family view: orthogonal connectors, dashed bars for informal partnerships. See below. |
| `family-graph`| `false`                | graph-style family view: same positioning, curved Cytoscape edges. See below. If both set, `family-tree` wins. |
| `zoom`        | `1.0`, `1.4` for mini  | zoom multiplier applied after fit. `1.5` or `"150%"` zooms in 50%             |
| `height`      | size default           | override the embed's height. Accepts `px`, `em`, `rem`, `vh`, `vw`, or `%`     |
| `center`      | host note              | wikilink or path of a different note to focus on, e.g. `"[[King Arthur]]"`     |
| `labels`      | (inherits setting)     | `true`/`false` to show or hide note names under nodes for this block, overriding the global **Show node labels** setting |
| `spacing`     | `1.0` (`0.55` in mini) | family-graph only: node spacing multiplier. Lower = tighter tree with shorter edges and larger nodes (good for infoboxes); higher = more spread out. Range `0.2`–`3` |
| `id`          | none                   | a stable identifier for this block. Required to **lock** the layout — see below |

## Family views

Two focused family views are available. Both centre on the host note's family neighbourhood (ancestors, descendants, partners) and use the same generation-aligned positioning algorithm — the difference is purely in how relationships are drawn.

### `family-tree: true` — classical chart

The traditional genealogy-chart look: vertical drops from each parent pair, horizontal distribution bars across siblings, individual stems down to each child. Spouses pulled side-by-side with the standard pair edge.

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

What you'll see:

- **Right-angle SVG connectors** for parent→child relationships (no curved edges)
- **Solid horizontal line** between two people = declared marriage (drawn by the spouse/pair edge)
- **Dashed horizontal bar** between two people = informal partnership — automatically inferred when two people share a child but have no declared marriage. Mirrors the classical-chart convention for inferred co-parenting
- **Spouse-lockstep drag** — grab one partner and the other follows in formation, including informal partners
- **Only family appears** — ancestors, descendants, partners. Other relationship types (allies, enemies, etc.) are hidden so the structure reads cleanly

### `family-graph: true` — graph-style view

The alternative look: same positioning, but Cytoscape draws curved type-differentiated edges instead of the orthogonal chart connectors. Useful when you want the family structure visible but prefer a softer, less formal aesthetic.

````markdown
```relations
size: large
family-graph: true
```
````

What you'll see:

- **Solid curved edge** between two people = declared marriage
- **Dotted curved edge** between two people = informal partnership (same inference as family-tree, just drawn as a curve)
- **Arrowed edge** = parent → child (genealogy)
- **Declared spouses go to the LEFT** of the focus, **informal partners to the RIGHT** — a deterministic visual convention so the layout reads the same way every time

### If both are set

`family-tree` wins. The classical-chart look is more specific and is the default preference.

### Use `scope: full` to see everything

By default both modes build a neighbourhood around the active note. To show the whole vault's family in one view, add `scope: full`:

````markdown
```relations
size: large
family-tree: true
scope: full
```
````

### Tightening the tree for small embeds

In a narrow space — an infobox, a callout, a `mini` embed — the default spacing can leave nodes looking small and far apart, because the view zooms out to fit the whole tree. `mini` embeds already use tighter spacing automatically, but you can tune any embed with `spacing`:

````markdown
```relations
size: small
family-graph: true
spacing: 0.5
```
````

Lower values pull nodes closer together (shorter edges, larger nodes once the view fits); higher values spread them out. The accepted range is `0.2` to `3.0`.

## Inline labels on relationships

Double-click any relationship line in a non-mini graph to add a short label that rides on the line itself — useful for things like a percentage, a date, or a one-word qualifier ("hates them 75%", "married 1485", "estranged").

How it works:

- **Double-click an edge** in a code-block embed (any size except `mini`) or in the side panel. A small floating text field appears at the click point.
- Type a short label (up to 80 characters) and press **Enter** to save, or **Escape** to cancel. Clicking away also saves.
- Labels appear inline along the edge, with a small background pill so they read clearly over the line.
- Labels are stored in the plugin's data (`data.json`) — they don't modify your notes. The same edge shows the same label everywhere it appears.
- For symmetric relationships (most types — ally, enemy, friend, spouse, lover, etc.), a label set on one direction shows up regardless of which side of the relationship you're looking from.
- To remove a label, double-click the edge again and clear the field, then press Enter.

In **family-tree mode**, labels also work on the right-angle parent→child connectors and the dashed informal-partnership bars. Double-click the line itself (anywhere along its visible length) to open the editor. If a child has two parents, a label is shown once on the child's stem and applies to whichever parent currently carries it — most users will only want a single label per child anyway ("estranged" describes the relationship as a whole, not separately per parent).

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
| **Gen**      | Genealogy — counts as a bloodline edge in family-graph mode. Typically `parent`.                                          |
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
