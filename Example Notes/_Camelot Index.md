---
tags:
  - index
---

# Camelot — Example NPCs

A small Arthurian cast for testing the **NPC Relationships** plugin. Each character note has frontmatter declaring relationships, a portrait, and at least one embedded `npc-graph` block.

## Whole vault — force-directed

```relations
size: large
scope: full
```

## Whole vault — top-down (tree-flagged types dominate via `family` and `parent`)

```relations
size: large
scope: full
tree: true
```

## The cast

- [[Arthur]] — High King of Britain
- [[Guinevere]] — Queen, secret love of Lancelot
- [[Merlin]] — court magician, mentor to Arthur
- [[Morgana]] — sorceress, Arthur's half-sister and enemy
- [[Mordred]] — Arthur's son and slayer
- [[Lancelot]] — first of knights, Guinevere's lover
- [[Galahad]] — Lancelot's son, the pure knight
- [[Gawain]] — Arthur's nephew
- [[Kay]] — Arthur's foster brother
- [[Ector]] — Arthur's foster father
- [[Uther]] — Arthur's biological father
- [[Igraine]] — Arthur's mother
- [[Nimue]] — Lady of the Lake

## What this exercises

- **Spouse pair** — Arthur ↔ Guinevere, Uther ↔ Igraine (pulled tight, heavy connector)
- **Lover** — Lancelot ↔ Guinevere (the affair), Merlin ↔ Nimue
- **Family tree** — Uther + Igraine → Arthur and Morgana; Arthur + Morgana → Mordred
- **Mentor** (asymmetric arrows) — Merlin → Arthur, Ector → Arthur, Lancelot → Galahad, Merlin → Nimue
- **Rivalry** (Gawain ↔ Lancelot) and **enmity** (Arthur ↔ Mordred, Merlin ↔ Morgana)
- **Foster vs. biological family** — Arthur is `parent: Uther, Igraine` but `family: Kay, Morgana, Ector` to show foster ties
- **Portraits** load via the `npcimage` frontmatter property pointing to SVGs in `Portraits/`

## Try this

1. Open the **NPC Relationships** view (users icon, left ribbon)
2. Toggle **Active note** mode
3. Click around — click any face on the graph to jump to that note
4. Open **[[Arthur]]** to see all three embed sizes (small, large, large+tree) on one note
