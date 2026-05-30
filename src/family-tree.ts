import { Core } from "cytoscape";
import { RelationsGraph } from "./types";

/**
 * Generation-aligned positioning for the family-graph view.
 *
 * Computes (x, y) positions for each node so that:
 *  - Generations stack vertically (parents above, children below)
 *  - Partners sit on the same row as their counterpart
 *  - Declared spouses go to the LEFT of the focus, informal partners to the RIGHT
 *
 * The function only sets positions; Cytoscape's edge rendering handles the
 * visual connections. Edge styles (solid for marriage, dotted for informal,
 * arrowed for parent→child) are defined in render.ts's stylesheet.
 *
 * Algorithm (bottom-up subtree-width allocation, Walker-style):
 *  1. Build family units. A unit groups one or two parents with their shared
 *     children. We resolve "shared parents" by intersecting each child's parent
 *     set: if two adults are both listed as a child's parents, they're paired
 *     in a unit even without a declared `spouse`.
 *  2. Assign generations top-down. A node's generation = max(parent generation) + 1.
 *  3. Recursively compute each subtree's required horizontal width, bottom up:
 *     a leaf needs its own width; a unit needs its children's combined widths +
 *     gaps, OR its own minimum width if larger.
 *  4. Place subtrees left-to-right within their parent unit; centre each unit
 *     above its children's collective midpoint.
 *  5. Fall back to adjacent placement for non-canonical second-spouse units —
 *     left side for declared marriages, right side for informal partnerships.
 *
 * What this layout deliberately ignores:
 *  - Non-genealogy/pair edges (ally, enemy, mentor, etc.) — they're filtered out
 *    of the family-graph view; the other graph views still show them.
 *  - Sibling birth order — without explicit metadata we use declaration order.
 */

interface FamilyUnit {
	id: string;                  // synthetic id derived from sorted parent ids
	parents: string[];            // 1-2 node ids; in display order (left, right)
	parentsAreMarried: boolean;   // pair edge between them — affects bar style
	children: string[];           // node ids; in declaration/display order
	generation: number;           // 0 = root generation
	subtreeWidth: number;         // horizontal space this unit's subtree occupies
	x: number;                    // centre X in graph coords (computed later)
	y: number;                    // generation Y in graph coords (computed later)
}

// Spacing constants. Tuned to match the proportions of a classical family chart —
// generation rows are tall enough for portraits + label, horizontal gaps wide
// enough that adjacent siblings' labels don't crash into each other.
const GEN_HEIGHT = 220;
const SIBLING_GAP = 40;        // gap between adjacent children in the same unit
const COUSIN_GAP = 80;         // gap between adjacent units in the same generation
const SPOUSE_GAP = 220;        // distance between paired spouses (must fit label widths)
const NODE_NOMINAL_WIDTH = 140; // a typical labeled-portrait's footprint

/**
 * Compute generation-aligned positions for a family graph and write them to
 * Cytoscape. Parents stack above children, partners sit on the same row, and
 * declared spouses go to the LEFT of the focus while informal partners go to
 * the RIGHT (per the family-graph display convention).
 *
 * The function only sets node positions and fits the viewport — it doesn't
 * draw any connectors. Cytoscape's own edge rendering handles the visual
 * connections, with edge styles (solid for marriage, dotted for informal,
 * arrowed for parent→child) defined in the stylesheet.
 */
export function applyGenerationLayout(
	cy: Core,
	graph: RelationsGraph,
	opts: { spacing?: number } = {},
): void {
	const sp = Math.max(0.2, Math.min(3, opts.spacing ?? 1));
	const genHeight = GEN_HEIGHT * sp;
	const siblingGap = SIBLING_GAP * sp;
	const cousinGap = COUSIN_GAP * sp;
	const spouseGap = SPOUSE_GAP * sp;
	const nodeWidth = NODE_NOMINAL_WIDTH * Math.sqrt(sp);
	// 1. Build adjacency: for every node, what are its parents (genealogy edges
	//    with this node as source) and who is it paired with (pair edges).
	const parentsOf = new Map<string, string[]>();
	const pairsOf = new Map<string, Set<string>>();
	for (const e of graph.edges) {
		if (e.genealogy) {
			// Convention: edge goes child → parent.
			pushTo(parentsOf, e.source, e.target);
		}
		if (e.pair) {
			addPair(pairsOf, e.source, e.target);
		}
	}

	// 2. Group children by parent-set. The key is the sorted parent ids joined,
	//    so children with the same two parents end up in the same unit even if
	//    declared in different orders on different child notes.
	const unitsByKey = new Map<string, FamilyUnit>();
	for (const [child, parents] of parentsOf) {
		const sortedParents = [...parents].sort();
		const key = sortedParents.join("|");
		let unit = unitsByKey.get(key);
		if (!unit) {
			const married = areMarried(sortedParents, pairsOf);
			unit = {
				id: `unit:${key}`,
				parents: orderParents(sortedParents, pairsOf),
				parentsAreMarried: married,
				children: [],
				generation: 0,
				subtreeWidth: 0,
				x: 0,
				y: 0,
			};
			unitsByKey.set(key, unit);
		}
		unit.children.push(child);
	}

	// Childless couples (a pair edge between two nodes, neither parents to anyone)
	// also deserve a unit so the marriage bar still renders. We add these last.
	const allUnits = [...unitsByKey.values()];
	const visitedPair = new Set<string>();
	for (const [a, partners] of pairsOf) {
		for (const b of partners) {
			const k = [a, b].sort().join("|");
			if (visitedPair.has(k)) continue;
			visitedPair.add(k);
			if (unitsByKey.has(k)) continue;  // already a parent-unit
			allUnits.push({
				id: `unit:${k}`,
				parents: orderParents([a, b].sort(), pairsOf),
				parentsAreMarried: true,
				children: [],
				generation: 0,
				subtreeWidth: 0,
				x: 0,
				y: 0,
			});
		}
	}

	// 3. Generations — assign each node a generation level, top-down. A node with
	//    no parents starts at 0. A node with parents is max(parent_gen) + 1.
	const generationOf = new Map<string, number>();
	for (const node of graph.nodes) generationOf.set(node.id, 0);
	// Iterate until stable. Cycle protection via iteration cap (genealogy cycles
	// are nonsense but a malformed vault could create one).
	let changed = true;
	let iterations = 0;
	while (changed && iterations < graph.nodes.length + 5) {
		changed = false;
		iterations++;
		for (const [child, parents] of parentsOf) {
			const childGen = generationOf.get(child) ?? 0;
			let maxParentGen = -1;
			for (const p of parents) {
				const pg = generationOf.get(p) ?? 0;
				if (pg > maxParentGen) maxParentGen = pg;
			}
			if (maxParentGen >= 0 && childGen <= maxParentGen) {
				generationOf.set(child, maxParentGen + 1);
				changed = true;
			}
		}
	}

	// 4. Each unit's generation = its parents' generation. Children live one
	//    generation below.
	for (const unit of allUnits) {
		unit.generation = Math.max(...unit.parents.map((p) => generationOf.get(p) ?? 0));
	}

	// 5. Build child-unit relationships. Each unit's children may themselves be
	//    parents in another unit — this gives us the recursive tree structure.
	const childToUnit = new Map<string, FamilyUnit>();
	for (const unit of allUnits) {
		for (const c of unit.children) {
			childToUnit.set(c, unit);
		}
	}
	// All units a given person appears as a parent in. For people in multiple
	// marriages this can be more than one — but recursive layout needs a single
	// "canonical" unit per parent or we get cascading double-placements.
	const allUnitsByParent = new Map<string, FamilyUnit[]>();
	for (const unit of allUnits) {
		for (const p of unit.parents) {
			pushTo(allUnitsByParent, p, unit);
		}
	}
	// Canonical unit per parent: prefer the unit with the most children. This is
	// a heuristic — without it, multi-marriage genealogies (A+B → kid1; A+C → kid2)
	// position A in two contradictory places. Picking the more-prolific marriage
	// as the canonical placement is a reasonable approximation. Other marriages
	// for A still get a marriage bar drawn, but they're treated as visual notes
	// rather than layout constraints.
	const canonicalUnitOf = new Map<string, FamilyUnit>();
	for (const [parent, units] of allUnitsByParent) {
		let best = units[0];
		for (const u of units) {
			if (u.children.length > best.children.length) best = u;
		}
		canonicalUnitOf.set(parent, best);
	}
	// downstreamUnitsByParent: only the canonical unit, used by recursion.
	const downstreamUnitsByParent = new Map<string, FamilyUnit[]>();
	for (const [parent, unit] of canonicalUnitOf) {
		downstreamUnitsByParent.set(parent, [unit]);
	}

	// 6. Find root units. A unit is "reachable by canonical recursion" iff at least
	//    one of its parents has this unit as their canonical AND that parent
	//    appears as a child in some other unit (so recursion will descend to them).
	//    If neither parent meets that condition, the unit is unreachable and we
	//    must include it as a root so it gets positioned at all.
	//
	//    EXCEPTION: childless pair units (e.g. Arthur+Guinevere where they have
	//    no shared children). Even when unreachable, we don't make these roots —
	//    that would place them in their own corner of the canvas. Instead they're
	//    deferred to step 9b which places the non-canonical partner adjacent to
	//    the canonical partner (so a childless spouse sits right next to their
	//    husband/wife rather than floating off elsewhere).
	const roots: FamilyUnit[] = [];
	for (const unit of allUnits) {
		const hasUpstream = unit.parents.some((p) => parentsOf.has(p));
		if (!hasUpstream) {
			// Even with no upstream, a childless pair unit can defer to 9b if at
			// least one partner is positioned by ANOTHER unit. Otherwise it has
			// to be a root or it'd never appear at all.
			if (unit.children.length === 0) {
				const someoneHasOtherUnit = unit.parents.some(
					(p) => (allUnitsByParent.get(p)?.length ?? 0) > 1,
				);
				if (someoneHasOtherUnit) continue;
			}
			roots.push(unit);
			continue;
		}
		// Has upstream. Skip childless pair units — 9b handles them.
		if (unit.children.length === 0) continue;
		const reachableByCanon = unit.parents.some(
			(p) => canonicalUnitOf.get(p) === unit && parentsOf.has(p),
		);
		if (!reachableByCanon) roots.push(unit);
	}

	// 7. Recursively compute subtree widths bottom-up.
	const widthCache = new Map<string, number>();
	function subtreeWidth(unit: FamilyUnit): number {
		const cached = widthCache.get(unit.id);
		if (cached !== undefined) return cached;
		// Each child either has its own downstream unit (where it's a parent) or
		// is a leaf. Sum child subtree widths + gaps. Compare against the parents'
		// own footprint (one or two nodes plus spouse gap).
		let childrenWidth = 0;
		for (let i = 0; i < unit.children.length; i++) {
			const c = unit.children[i];
			const ownUnits = downstreamUnitsByParent.get(c) ?? [];
			let cw = nodeWidth;
			for (const downstream of ownUnits) {
				cw = Math.max(cw, subtreeWidth(downstream));
			}
			childrenWidth += cw;
			if (i < unit.children.length - 1) childrenWidth += siblingGap;
		}
		const parentsWidth = unit.parents.length === 2
			? spouseGap + nodeWidth
			: nodeWidth;
		const w = Math.max(parentsWidth, childrenWidth);
		widthCache.set(unit.id, w);
		unit.subtreeWidth = w;
		return w;
	}
	for (const r of roots) subtreeWidth(r);

	// 8. Place root units left-to-right with COUSIN_GAP between them.
	// `childPositions` collects each child's resolved (x,y) so we can write all
	// node positions in one pass at the end. Declared before positionUnit so the
	// closure captures it cleanly.
	const childPositions = new Map<string, { x: number; y: number }>();
	// `positionedUnits` tracks which units actually got laid out by positionUnit.
	// Childless pair units skipped from root recursion (like Arthur+Guinevere)
	// are NOT in this set — their unit.x/unit.y are zero and we mustn't try to
	// write parent positions from them in step 9.
	const positionedUnits = new Set<FamilyUnit>();

	let cursor = 0;
	for (const root of roots) {
		positionUnit(root, cursor + root.subtreeWidth / 2);
		cursor += root.subtreeWidth + cousinGap;
	}

	function positionUnit(unit: FamilyUnit, centerX: number): void {
		unit.x = centerX;
		unit.y = unit.generation * genHeight;
		positionedUnits.add(unit);
		// Position children left-to-right under this unit.
		const children = unit.children;
		if (children.length === 0) return;

		// First pass: compute each child's width so we know how to lay them out.
		const childWidths: number[] = [];
		let totalChildrenWidth = 0;
		for (let i = 0; i < children.length; i++) {
			const c = children[i];
			const ownUnits = downstreamUnitsByParent.get(c) ?? [];
			let cw = nodeWidth;
			for (const downstream of ownUnits) {
				cw = Math.max(cw, downstream.subtreeWidth);
			}
			childWidths.push(cw);
			totalChildrenWidth += cw;
			if (i < children.length - 1) totalChildrenWidth += siblingGap;
		}

		let childCursor = centerX - totalChildrenWidth / 2;
		for (let i = 0; i < children.length; i++) {
			const c = children[i];
			const cw = childWidths[i];
			const cx = childCursor + cw / 2;

			// If this child is itself a parent in a downstream unit, recurse so
			// that downstream positions itself (and writes its own parent positions).
			// In that case the child's position was already set by the recursion,
			// so we don't overwrite it here. Only leaves get their position set
			// in this loop.
			const ownUnits = downstreamUnitsByParent.get(c) ?? [];
			if (ownUnits.length > 0) {
				let subCursor = cx - cw / 2;
				for (const downstream of ownUnits) {
					positionUnit(downstream, subCursor + downstream.subtreeWidth / 2);
					subCursor += downstream.subtreeWidth;
				}
			} else {
				// Leaf child — write its position.
				childPositions.set(c, { x: cx, y: (unit.generation + 1) * genHeight });
			}

			childCursor += cw;
			if (i < children.length - 1) childCursor += siblingGap;
		}
	}

	// (positionUnit hoists; calls above use `childPositions` declared at the top
	// of this section.)

	// 9. Write parent positions. Only the parent for whom THIS unit is canonical
	//    gets its position written here — the other parent (if their canonical is
	//    a different unit) keeps its position from that unit. This is the key
	//    fix for multi-marriage: previously, Arthur's position was being overwritten
	//    by the Arthur+Guinevere unit even though Arthur's canonical was Arthur+Morgause.
	const positionedNodes = new Set<string>();
	for (const unit of allUnits) {
		// Only write positions from units that were actually laid out by
		// positionUnit. Skipped childless pair units have zero coords and would
		// place their parents at (0, 0) which is wrong on every axis.
		if (!positionedUnits.has(unit)) continue;
		if (unit.parents.length === 2) {
			const [left, right] = unit.parents;
			if (canonicalUnitOf.get(left) === unit) {
				cy.getElementById(left).position({ x: unit.x - spouseGap / 2, y: unit.y });
				positionedNodes.add(left);
			}
			if (canonicalUnitOf.get(right) === unit) {
				cy.getElementById(right).position({ x: unit.x + spouseGap / 2, y: unit.y });
				positionedNodes.add(right);
			}
		} else if (unit.parents.length === 1) {
			const p = unit.parents[0];
			if (canonicalUnitOf.get(p) === unit) {
				cy.getElementById(p).position({ x: unit.x, y: unit.y });
				positionedNodes.add(p);
			}
		}
	}

	// 9b-prep. Build a "what nodes are at each generation row" lookup. This is
	// reused by step 9b (placing non-canonical second-spouses) and by step 12
	// (deciding whether a marriage bar would clip through a third node). It must
	// be built *after* canonical positions are written but *before* anything
	// that depends on knowing where everyone sits.
	const nodesByGenY = new Map<number, { id: string; x: number }[]>();
	for (const node of graph.nodes) {
		if (!positionedNodes.has(node.id)) continue;
		const pos = cy.getElementById(node.id).position();
		if (!pos) continue;
		const gen = generationOf.get(node.id) ?? 0;
		const y = gen * genHeight;
		if (!nodesByGenY.has(y)) nodesByGenY.set(y, []);
		nodesByGenY.get(y)!.push({ id: node.id, x: pos.x });
	}

	// 9b. Fallback pass for parents that weren't positioned in step 9. Two cases
	//     to handle differently:
	//
	//     (a) **Childless pair unit** (e.g. Arthur+Guinevere — they're a declared
	//         spouse pair but have no shared children). The non-canonical partner
	//         should sit IMMEDIATELY adjacent to the canonical partner, like a
	//         normal spouse, so the marriage bar between them is short and clean.
	//         If that slot is occupied (e.g. Morgana already sits next to Arthur),
	//         we look further out.
	//
	//     (b) **Multi-marriage with-children unit** — second marriage where the
	//         partner has children of their own, but the OTHER partner's canonical
	//         is elsewhere. Here we want more room: 1.5× SPOUSE_GAP so the
	//         secondary unit's children don't crash into the canonical unit's.
	for (const unit of allUnits) {
		if (unit.parents.length !== 2) continue;
		const [a, b] = unit.parents;
		const aPositioned = positionedNodes.has(a);
		const bPositioned = positionedNodes.has(b);
		if (aPositioned === bPositioned) continue;

		const placedId = aPositioned ? a : b;
		const orphanId = aPositioned ? b : a;
		const placedPos = cy.getElementById(placedId).position();
		const sameRow = (nodesByGenY.get(placedPos.y) ?? []);
		const isChildless = unit.children.length === 0;
		// Convention: formally-married partner goes to the LEFT of the focus,
		// informal partners (lovers, "side pieces") go to the RIGHT. Reads as
		// "official partner first, on-the-side second" in left-to-right script.
		// If the preferred side is blocked by another node, we fall through to
		// the other side and then to wider offsets.
		const formal = unit.parentsAreMarried;
		const baseGap = isChildless ? spouseGap : spouseGap * 1.5;
		const offsets = formal
			? [-baseGap, baseGap, -baseGap * (isChildless ? 1.5 : 0.67), baseGap * (isChildless ? 1.5 : 0.67)]
			: [ baseGap, -baseGap,  baseGap * (isChildless ? 1.5 : 0.67), -baseGap * (isChildless ? 1.5 : 0.67)];

		let chosenX = placedPos.x + offsets[0];
		for (const off of offsets) {
			const tx = placedPos.x + off;
			const conflict = sameRow.some((n) => n.id !== orphanId && Math.abs(n.x - tx) < spouseGap * 0.6);
			if (!conflict) { chosenX = tx; break; }
		}
		cy.getElementById(orphanId).position({ x: chosenX, y: placedPos.y });
		positionedNodes.add(orphanId);
		if (!nodesByGenY.has(placedPos.y)) nodesByGenY.set(placedPos.y, []);
		nodesByGenY.get(placedPos.y)!.push({ id: orphanId, x: chosenX });
	}

	// 10. Write child positions.
	for (const [child, pos] of childPositions) {
		cy.getElementById(child).position(pos);
	}

	// 11. Place any orphan nodes (no genealogy edges, no pair edges) off to one
	//     side so they're visible but don't crowd the tree.
	let orphanCursor = cursor + cousinGap;
	for (const node of graph.nodes) {
		const inFamily = parentsOf.has(node.id) || downstreamUnitsByParent.has(node.id) || pairsOf.has(node.id);
		if (!inFamily) {
			cy.getElementById(node.id).position({ x: orphanCursor, y: 0 });
			orphanCursor += nodeWidth + cousinGap;
		}
	}

}


/* ------------------------------ helpers ------------------------------ */

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
	if (!m.has(k)) m.set(k, []);
	m.get(k)!.push(v);
}

function addPair(m: Map<string, Set<string>>, a: string, b: string): void {
	if (!m.has(a)) m.set(a, new Set());
	if (!m.has(b)) m.set(b, new Set());
	m.get(a)!.add(b);
	m.get(b)!.add(a);
}

function areMarried(sortedParents: string[], pairsOf: Map<string, Set<string>>): boolean {
	if (sortedParents.length < 2) return false;
	const [a, b] = sortedParents;
	return pairsOf.get(a)?.has(b) ?? false;
}

/**
 * Decide which parent goes on the left, which on the right. Where one is named
 * as the host note's main subject, putting them on the right feels more natural
 * (they're the focus); but with no clearer signal we just keep the sorted order.
 */
function orderParents(sortedParents: string[], _pairsOf: Map<string, Set<string>>): string[] {
	return sortedParents;
}
