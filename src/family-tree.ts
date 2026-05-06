import cytoscape, { Core, NodeSingular } from "cytoscape";
import dagre from "cytoscape-dagre";
import { RelationsGraph } from "./types";

let dagreReg = false;
function ensureDagre(): void {
	if (dagreReg) return;
	cytoscape.use(dagre);
	dagreReg = true;
}

/**
 * Apply a family-tree layout to a Cytoscape instance.
 *
 * Strategy:
 * 1. Run dagre top-down using only genealogy edges (parent-of relationships). This
 *    establishes generations as horizontal rows. Spouse edges are excluded so dagre
 *    doesn't try to put spouses in different rows.
 * 2. Snap each generation to a clean Y. Dagre's row spacing is approximate; we want
 *    sharp horizontal bands. We bucket nodes by their dagre Y, average each bucket,
 *    and pin every node in the bucket to that average.
 * 3. Pair spouses on the X axis: for each pair edge (spouse, partner, etc.), pull
 *    both endpoints to a shared Y (the higher of the two — spouses share a generation)
 *    and place them at a fixed horizontal offset from each other.
 * 4. Re-position children of paired parents: a child's X becomes the midpoint of its
 *    parents' X. This produces the visual T-junction characteristic of family trees.
 * 5. Lock all positions so subsequent interactions don't drift the layout.
 *
 * Limitations (worth being honest about):
 *  - Sibling order is whatever dagre picked; we don't honor an explicit birthOrder.
 *  - A person with two distinct partners will have one partner placed adjacent and
 *    the other floating — proper genealogy software draws the person twice; we don't.
 *  - If a child has only one declared parent, it's centered under that parent.
 */
export function applyFamilyTreeLayout(cy: Core, graph: RelationsGraph): void {
	ensureDagre();

	// Adjacency: who are each node's parents (genealogy edges) and pair partners.
	const parentsOf = new Map<string, string[]>();    // child -> [parents]
	const pairsOf = new Map<string, string[]>();      // node  -> [spouses/partners]
	for (const e of graph.edges) {
		if (e.genealogy) {
			// In our schema, `parent` on a child note declares "this child has parent X",
			// so the edge child -> parent. We treat child as the dependent.
			// But users might declare it the other way (parent -> child) too, especially
			// with symmetric `family` types they've toggled to genealogy. We can't tell
			// direction reliably, so for layout purposes we trust the edge direction:
			// source = child, target = parent — which matches our parent-on-child convention.
			if (!parentsOf.has(e.source)) parentsOf.set(e.source, []);
			parentsOf.get(e.source)!.push(e.target);
		}
		if (e.pair) {
			if (!pairsOf.has(e.source)) pairsOf.set(e.source, []);
			if (!pairsOf.has(e.target)) pairsOf.set(e.target, []);
			pairsOf.get(e.source)!.push(e.target);
			pairsOf.get(e.target)!.push(e.source);
		}
	}

	// Run dagre on genealogy edges only. We do this by collecting the Cytoscape eles
	// that correspond to genealogy edges + all nodes, and running the layout against
	// that subset.
	const genEdgeIds = new Set<string>();
	for (const e of graph.edges) {
		if (e.genealogy) {
			genEdgeIds.add(`${e.source}__${e.type}__${e.target}`);
		}
	}

	const allNodes = cy.nodes();
	const genEdges = cy.edges().filter((edge) => genEdgeIds.has(edge.id()));
	const layoutEles = allNodes.union(genEdges);

	// Run dagre synchronously (animate: false so we don't have to wait for layoutstop).
	const layout = layoutEles.layout({
		name: "dagre",
		rankDir: "TB",
		nodeSep: 80,
		rankSep: 110,
		animate: false,
	} as unknown as cytoscape.LayoutOptions);
	layout.run();

	// 2. Snap generations: cluster Ys within ~50px and average each cluster.
	const nodes: NodeSingular[] = allNodes.toArray();
	const ys = nodes.map((n) => n.position("y")).sort((a, b) => a - b);
	const generations = clusterValues(ys, 50);
	for (const node of nodes) {
		const y = node.position("y");
		const gen = generations.find((g) => Math.abs(g.center - y) <= g.span / 2 + 25);
		if (gen) node.position({ x: node.position("x"), y: gen.center });
	}

	// 3. Pair spouses. For each pair (visited once), align Y to the higher node and
	// nudge both to be horizontally adjacent. We use a fixed offset (110px) — this
	// matches the dagre nodeSep so spouse spacing looks consistent with sibling spacing.
	const PAIR_OFFSET = 110;
	const visited = new Set<string>();
	for (const [a, partners] of pairsOf) {
		for (const b of partners) {
			const key = [a, b].sort().join("|");
			if (visited.has(key)) continue;
			visited.add(key);
			const na = cy.getElementById(a);
			const nb = cy.getElementById(b);
			if (!na.nonempty() || !nb.nonempty()) continue;

			// Same generation: pick whichever Y appears more "central" — typically
			// they should already be close after dagre + snapping. We just take the avg.
			const sharedY = (na.position("y") + nb.position("y")) / 2;
			// Place A on the left of the midpoint, B on the right.
			const midX = (na.position("x") + nb.position("x")) / 2;
			na.position({ x: midX - PAIR_OFFSET / 2, y: sharedY });
			nb.position({ x: midX + PAIR_OFFSET / 2, y: sharedY });
		}
	}

	// 4. Children of paired parents: center them under the midpoint.
	// We do this in generation order (top to bottom) so when a child's position
	// shifts, their own children later get the new position.
	const sortedNodes = [...nodes].sort((a, b) => a.position("y") - b.position("y"));
	for (const node of sortedNodes) {
		const parents = parentsOf.get(node.id());
		if (!parents || parents.length === 0) continue;

		const parentNodes = parents
			.map((p) => cy.getElementById(p))
			.filter((n) => n.nonempty());
		if (parentNodes.length === 0) continue;

		// Midpoint of parents' X. With one parent, it's just that parent's X.
		const sumX = parentNodes.reduce((s, p) => s + p.position("x"), 0);
		const midX = sumX / parentNodes.length;
		node.position({ x: midX, y: node.position("y") });
	}

	// After child re-positioning, siblings of the same parent set might overlap.
	// Spread them: for each set of siblings sharing parents, lay them out evenly
	// around the parent midpoint.
	const siblingGroups = new Map<string, NodeSingular[]>();
	for (const node of sortedNodes) {
		const parents = parentsOf.get(node.id());
		if (!parents || parents.length === 0) continue;
		const key = [...parents].sort().join("|");
		if (!siblingGroups.has(key)) siblingGroups.set(key, []);
		siblingGroups.get(key)!.push(node);
	}
	const SIBLING_SEP = 100;
	for (const sibs of siblingGroups.values()) {
		if (sibs.length <= 1) continue;
		// Sort siblings by current X to preserve dagre's edge-crossing minimisation.
		sibs.sort((a, b) => a.position("x") - b.position("x"));
		const midX = sibs.reduce((s, n) => s + n.position("x"), 0) / sibs.length;
		const spread = (sibs.length - 1) * SIBLING_SEP;
		const startX = midX - spread / 2;
		const y = sibs[0].position("y");
		sibs.forEach((sib, i) => {
			sib.position({ x: startX + i * SIBLING_SEP, y });
		});
	}

	// 5. Fit the viewport.
	cy.fit(undefined, 40);
}

/**
 * Cluster a sorted ascending list of numbers into buckets where consecutive values
 * within `gap` of each other go into the same bucket. Returns each bucket's center
 * and span.
 */
function clusterValues(sortedAsc: number[], gap: number): { center: number; span: number }[] {
	if (sortedAsc.length === 0) return [];
	const out: { center: number; span: number }[] = [];
	let bucket: number[] = [sortedAsc[0]];
	for (let i = 1; i < sortedAsc.length; i++) {
		const v = sortedAsc[i];
		if (v - bucket[bucket.length - 1] <= gap) {
			bucket.push(v);
		} else {
			out.push(toCluster(bucket));
			bucket = [v];
		}
	}
	out.push(toCluster(bucket));
	return out;
}

function toCluster(b: number[]): { center: number; span: number } {
	const min = b[0];
	const max = b[b.length - 1];
	return { center: (min + max) / 2, span: max - min };
}
