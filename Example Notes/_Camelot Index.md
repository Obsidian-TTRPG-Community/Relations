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

## Nicknames

Characters can have their own names for each other. Put a `|` and a nickname inside the link:

```yaml
parent:
  - "[[Arthur|Father]]"
```

Open these notes and look at the graph. The same person shows a different name depending on whose note you're on:

- [[Mordred]]: Arthur says **Father**, Morgana says **Mother**
- [[Kay]]: Arthur says **Little Brother**
- [[Merlin]]: Arthur says **The Boy King**
- [[Lancelot]]: Guinevere says **My Lady**
- [[Arthur]]: no nicknames, so everyone shows their real name

## Notes you haven't written yet

[[Uther]] has an enemy, Gorlois, who doesn't have a note yet. Open Uther and Gorlois shows up as a faded circle. Click it to create his note.

## Two graphs, two filters

Each graph has its own **Filter** button. Hiding something in one graph doesn't touch the other. The filter is saved as a `hide:` line in the code block.

Arthur's family:

```relations
center: "[[Arthur]]"
hide: ally, enemy, friend, rival, mentor, lover
```

Everyone else in Arthur's life:

```relations
center: "[[Arthur]]"
hide: parent, family, spouse
```

## Only some kinds of relationships

First, in **Settings → Relations**, type `Family` into the **Group** box for `family` and `parent`, and `Social` for `ally`, `enemy`, `friend` and `rival`.

Arthur's family only:

```relations
center: "[[Arthur]]"
groups: Family
```

Arthur's friends and enemies only:

```relations
center: "[[Arthur]]"
groups: Social
```

If these only show Arthur on his own, the Group boxes haven't been filled in yet.

## Try this

1. Open the **NPC Relationships** view (users icon, left ribbon)
2. Toggle **Active note** mode
3. Click around — click any face on the graph to jump to that note
4. Open **[[Arthur]]** to see all three embed sizes (small, large, large+tree) on one note
