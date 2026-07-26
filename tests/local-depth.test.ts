import { describe, it, expect } from "vitest";
import { localSubgraph } from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

/**
 * Tests for the local (N-hop) scope, exposed to users as `scope: local`
 * with a `depth` option, and as the side panel's Depth control.
 *
 * The semantics: starting from a center note, include every note within
 * `depth` hops (edges treated as undirected). An edge is only included when
 * it is itself reachable within `depth` hops — i.e. its nearer endpoint is
 * strictly closer than `depth`. Crossing an edge from a node N hops out is
 * hop N+1, so:
 *
 *   depth 1 → the center, its direct connections, and ONLY the edges from
 *             the center to those connections (hub-and-spoke). Cross-links
 *             between two of the center's neighbors are depth-2 information
 *             and must not appear.
 *   depth 2 → additionally the neighbors' own relationships, but not
 *             cross-links between two nodes that are both 2 hops out.
 */

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function edge(source: string, target: string, type = "knows"): GraphEdge {
	return {
		source, target, type,
		color: "#888",
		symmetric: true,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
	};
}

/** Center C with neighbors A and B, where A and B are also linked to each
 *  other, and B has a further connection D (2 hops from C). */
function diamondPlusTail(): RelationsGraph {
	return {
		nodes: [node("C"), node("A"), node("B"), node("D")],
		edges: [
			edge("C", "A"),
			edge("C", "B"),
			edge("A", "B"), // cross-link between two depth-1 neighbors
			edge("B", "D"), // tail reaching depth 2
		],
	};
}

describe("localSubgraph — node inclusion", () => {
	it("depth 0 returns only the center, no edges", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 0);
		expect(out.nodes.map((n) => n.id)).toEqual(["C"]);
		expect(out.edges).toEqual([]);
	});

	it("depth 1 includes the center and its direct neighbors only", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 1);
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
	});

	it("depth 2 additionally includes nodes 2 hops out", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 2);
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "D"]);
	});

	it("negative depth is clamped to 0", () => {
		const out = localSubgraph(diamondPlusTail(), "C", -3);
		expect(out.nodes.map((n) => n.id)).toEqual(["C"]);
		expect(out.edges).toEqual([]);
	});

	it("returns an empty graph when the center is not in the graph", () => {
		const out = localSubgraph(diamondPlusTail(), "Nope", 2);
		expect(out.nodes).toEqual([]);
		expect(out.edges).toEqual([]);
	});
});

describe("localSubgraph — edge hop limit", () => {
	it("depth 1 is hub-and-spoke: only edges touching the center", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 1);
		expect(out.edges).toHaveLength(2);
		for (const e of out.edges) {
			expect(e.source === "C" || e.target === "C").toBe(true);
		}
	});

	it("depth 1 drops the cross-link between two depth-1 neighbors", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 1);
		const hasCrossLink = out.edges.some(
			(e) =>
				(e.source === "A" && e.target === "B") ||
				(e.source === "B" && e.target === "A"),
		);
		expect(hasCrossLink).toBe(false);
	});

	it("depth 2 includes the neighbors' own relationships", () => {
		const out = localSubgraph(diamondPlusTail(), "C", 2);
		// A–B cross-link and B–D tail are both reachable on the 2nd hop now.
		expect(out.edges).toHaveLength(4);
	});

	it("depth 2 drops cross-links between two outermost-ring nodes", () => {
		// C → A → X and C → B → Y, with X–Y linked. X and Y are both exactly
		// 2 hops out, so the X–Y edge would be hop 3 and must not appear.
		const graph: RelationsGraph = {
			nodes: [node("C"), node("A"), node("B"), node("X"), node("Y")],
			edges: [
				edge("C", "A"),
				edge("C", "B"),
				edge("A", "X"),
				edge("B", "Y"),
				edge("X", "Y"),
			],
		};
		const out = localSubgraph(graph, "C", 2);
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "X", "Y"]);
		const hasOuterCrossLink = out.edges.some(
			(e) =>
				(e.source === "X" && e.target === "Y") ||
				(e.source === "Y" && e.target === "X"),
		);
		expect(hasOuterCrossLink).toBe(false);
		expect(out.edges).toHaveLength(4);
	});

	it("treats directed edges as undirected for hop counting", () => {
		// Edge points B → C (e.g. "parent: C" written in B's frontmatter);
		// from center C at depth 1, B is still 1 hop away and the edge shows.
		const graph: RelationsGraph = {
			nodes: [node("C"), node("B")],
			edges: [{ ...edge("B", "C"), symmetric: false }],
		};
		const out = localSubgraph(graph, "C", 1);
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["B", "C"]);
		expect(out.edges).toHaveLength(1);
	});

	it("keeps parallel edges of different types between center and neighbor", () => {
		const graph: RelationsGraph = {
			nodes: [node("C"), node("A")],
			edges: [edge("C", "A", "friend"), edge("C", "A", "coworker")],
		};
		const out = localSubgraph(graph, "C", 1);
		expect(out.edges).toHaveLength(2);
	});

	it("every included node beyond the center stays connected to the graph", () => {
		// No node should ever float with zero edges (except the center at depth 0):
		// each included node was discovered via a BFS edge whose nearer endpoint
		// is strictly closer, so that edge always survives the filter.
		const out = localSubgraph(diamondPlusTail(), "C", 2);
		for (const n of out.nodes) {
			if (n.id === "C") continue;
			const touched = out.edges.some((e) => e.source === n.id || e.target === n.id);
			expect(touched).toBe(true);
		}
	});
});
