import { describe, it, expect } from "vitest";
import { filterGraphByTypes } from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

/**
 * Tests for filterGraphByTypes — the type on/off filter used by the side-panel
 * view and code-block embeds. Removing a type drops its edges, then any node
 * left with no remaining edges is pruned (except an optional keepNodeId, the
 * active/center note).
 */

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function edge(source: string, target: string, type: string): GraphEdge {
	return {
		source, target, type,
		color: "#888",
		symmetric: true,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
	};
}

describe("filterGraphByTypes", () => {
	it("returns the original graph reference when nothing is disabled", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [edge("A", "B", "friend")],
		};
		const out = filterGraphByTypes(graph, new Set());
		expect(out).toBe(graph);
	});

	it("removes edges of a disabled type", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C")],
			edges: [edge("A", "B", "friend"), edge("B", "C", "enemy")],
		};
		const out = filterGraphByTypes(graph, new Set(["enemy"]));
		expect(out.edges.map((e) => e.type)).toEqual(["friend"]);
	});

	it("prunes nodes left with no remaining edges", () => {
		// C is only reachable via the disabled 'enemy' edge, so it should drop.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C")],
			edges: [edge("A", "B", "friend"), edge("B", "C", "enemy")],
		};
		const out = filterGraphByTypes(graph, new Set(["enemy"]));
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
	});

	it("keeps a node still connected via an enabled type", () => {
		// B has both a friend and an enemy edge; disabling enemy keeps B via friend.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C")],
			edges: [edge("A", "B", "friend"), edge("B", "C", "enemy")],
		};
		const out = filterGraphByTypes(graph, new Set(["enemy"]));
		expect(out.nodes.map((n) => n.id)).toContain("B");
	});

	it("retains keepNodeId even when it becomes isolated", () => {
		// Disable the only edge touching A; A is the center note so it stays.
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [edge("A", "B", "friend")],
		};
		const out = filterGraphByTypes(graph, new Set(["friend"]), "A");
		expect(out.nodes.map((n) => n.id)).toEqual(["A"]);
		expect(out.edges).toEqual([]);
	});

	it("can empty the graph when every type is disabled and no node is kept", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [edge("A", "B", "friend")],
		};
		const out = filterGraphByTypes(graph, new Set(["friend"]));
		expect(out.nodes).toEqual([]);
		expect(out.edges).toEqual([]);
	});

	it("does not mutate the input graph", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C")],
			edges: [edge("A", "B", "friend"), edge("B", "C", "enemy")],
		};
		filterGraphByTypes(graph, new Set(["enemy"]));
		expect(graph.nodes.length).toBe(3);
		expect(graph.edges.length).toBe(2);
	});
});
