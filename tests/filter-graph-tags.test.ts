import { describe, it, expect } from "vitest";
import { filterGraphByTags } from "../src/graph";
import { parseOptions, resolveTags } from "../src/codeblock";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

/**
 * `tags:` — a per-graph note filter: only notes carrying one of the tags (and
 * the edges between them) appear in that code block.
 */

function node(id: string, tags: string[] = []): GraphNode {
	return { id, label: id, tags, image: null };
}

function edge(source: string, target: string, type = "ally"): GraphEdge {
	return { source, target, type, color: "#888", symmetric: true, pair: false, lineStyle: "solid", genealogy: false };
}

const ids = (g: RelationsGraph) => g.nodes.map((n) => n.id).sort();

describe("filterGraphByTags", () => {
	const graph: RelationsGraph = {
		nodes: [
			node("A", ["#ballroom"]),
			node("B", ["#Ballroom/guests"]),
			node("C", ["#ballroom"]),
			node("D", ["#npc"]),
			node("E", []),
		],
		edges: [edge("A", "B"), edge("B", "D"), edge("C", "D"), edge("D", "E")],
	};

	it("returns the same graph when no tags are given", () => {
		expect(filterGraphByTags(graph, new Set())).toBe(graph);
	});

	it("keeps only tagged notes and the edges between them", () => {
		const g = filterGraphByTags(graph, new Set(["ballroom"]));
		expect(ids(g)).toEqual(["A", "B"]);
		expect(g.edges).toEqual([edge("A", "B")]);
	});

	it("matches case-insensitively, with or without #, and nested tags", () => {
		expect(ids(filterGraphByTags(graph, new Set(["#BALLROOM"])))).toEqual(["A", "B"]);
	});

	it("does not match a tag that only shares a prefix", () => {
		const g: RelationsGraph = { nodes: [node("X", ["#ballroomdance"]), node("Y", ["#ballroom"])], edges: [edge("X", "Y")] };
		expect(ids(filterGraphByTags(g, new Set(["ballroom"])))).toEqual([]);
	});

	it("uses OR logic across tags", () => {
		expect(ids(filterGraphByTags(graph, new Set(["ballroom", "npc"])))).toEqual(["A", "B", "C", "D"]);
	});

	it("always keeps the center note, tagged or not", () => {
		const g = filterGraphByTags(graph, new Set(["ballroom"]), "D");
		expect(ids(g)).toEqual(["A", "B", "C", "D"]);
		expect(g.edges.length).toBe(3);
	});

	it("drops missing notes (they have no tags)", () => {
		const g: RelationsGraph = {
			nodes: [node("A", ["#ballroom"]), { ...node("missing:Z"), missing: true }],
			edges: [edge("A", "missing:Z")],
		};
		expect(ids(filterGraphByTags(g, new Set(["ballroom"])))).toEqual([]);
	});

	it("carries display names through", () => {
		const g = { ...graph, displayNames: new Map() } as RelationsGraph;
		expect(filterGraphByTags(g, new Set(["ballroom"])).displayNames).toBe(g.displayNames);
	});
});

describe("tags: option", () => {
	it("accepts a comma string or a list", () => {
		expect(resolveTags({ tags: "ballroom, #court" })).toEqual(["ballroom", "#court"]);
		expect(resolveTags({ tags: ["ballroom", "court"] })).toEqual(["ballroom", "court"]);
	});

	it("is undefined when absent or empty", () => {
		expect(resolveTags({})).toBeUndefined();
		expect(resolveTags({ tags: "" })).toBeUndefined();
	});

	it("is parsed from a code block", () => {
		expect(parseOptions("scope: full\ntags: ballroom").tags).toEqual(["ballroom"]);
	});
});
