<div align="center">

# Relations

**See how your notes connect.**

Visualise relationships between notes — for **worldbuilding**, **fiction**, **TTRPG campaigns**, **genealogies**, or any project where seeing how things connect matters. Note-driven via frontmatter, with portraits, typed line styles, a focused family view, and embeddable graphs that work inside callouts and infoboxes.

Relations standard graph view:
<img width="816" height="863" alt="RFdUQRM2xC" src="https://github.com/user-attachments/assets/ab1aed71-e7cf-441e-8146-3b5460150b09" />

Family-graph view
<img width="1123" height="610" alt="ucOs475xnH" src="https://github.com/user-attachments/assets/8e78973b-575a-4f3a-a877-8b22e59db822" />


[Install](#install) · [Quick start](#quick-start) · [Embedding](#embedding-a-graph-in-a-note) · [Family-graph mode](#family-graph-mode) · [Settings](#relationship-types)

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

### Via Community.Obsidian.md (recommended)

Browse to: https://community.obsidian.md/plugins/relations

Install the plugin

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
| `family-graph`| `false`                | family view: parents above the focus, partners on the same row, children below. See below. |
| `zoom`        | `1.0`, `1.4` for mini  | zoom multiplier applied after fit. `1.5` or `"150%"` zooms in 50%             |
| `height`      | size default           | override the embed's height. Accepts `px`, `em`, `rem`, `vh`, `vw`, or `%`     |
| `center`      | host note              | wikilink or path of a different note to focus on, e.g. `"[[King Arthur]]"`     |

## Family-graph mode

A focused family view for the host note. Generations are aligned in horizontal rows — parents above, the focus and any partners on the middle row, children below — with edges styled to distinguish marriage from informal partnership and parent from child.

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
family-graph: true
```
````

### What you'll see

- **Solid line** between two people = declared marriage (any `pair`-flagged relationship like `spouse`)
- **Dotted line** between two people = informal partnership — automatically inferred when two people share a child but have no declared marriage between them. You don't have to model this explicitly; just declare the child's parents, and a partnership line appears
- **Arrowed line** = parent → child (genealogy edge), pointing in the natural reading direction
- **Declared spouses go to the LEFT** of the focus, **informal partners to the RIGHT** — a deterministic visual convention so the chart reads the same way every time, regardless of which order Obsidian indexed the frontmatter
- **Only family appears** — ancestors, descendants, partners. Allies, enemies, mentors, and other relationship types are hidden so the family structure reads cleanly. Switch to the regular Full or Active-note views to see those

### Use `scope: full` to see everything

By default `family-graph` builds a neighbourhood around the active note. To show the whole vault's family in one view, add `scope: full`:

````markdown
```relations
size: large
family-graph: true
scope: full
```
````

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
