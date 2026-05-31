import { describe, it, expect } from "vitest";
import { filterFamilyNeighborhood } from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph } from "../src/types";

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function gen(child: string, parent: string): GraphEdge {
	return { source: child, target: parent, type: "parent", color: "#888", symmetric: false, pair: false, lineStyle: "solid", genealogy: true };
}

function pair(a: string, b: string): GraphEdge {
	return { source: a, target: b, type: "spouse", color: "#d946ef", symmetric: true, pair: true, lineStyle: "double", genealogy: false };
}

// Great-grandparent → Grandparent → Parent → Focus → Child → Grandchild
const LINEAGE: RelationsGraph = {
	nodes: [node("GGP"), node("GP"), node("P"), node("Focus"), node("C"), node("GC")],
	edges: [
		gen("GP", "GGP"),
		gen("P", "GP"),
		gen("Focus", "P"),
		gen("C", "Focus"),
		gen("GC", "C"),
	],
};

function ids(graph: RelationsGraph): string[] {
	return graph.nodes.map((n) => n.id).sort();
}

describe("filterFamilyNeighborhood", () => {
	it("includes entire lineage when depth is omitted", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus");
		expect(ids(result)).toEqual(["C", "Focus", "GC", "GGP", "GP", "P"]);
	});

	it("includes entire lineage when depth is undefined", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", undefined);
		expect(ids(result)).toEqual(["C", "Focus", "GC", "GGP", "GP", "P"]);
	});

	it("depth 0 returns only the focus node", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 0);
		expect(ids(result)).toEqual(["Focus"]);
	});

	it("depth 1 returns parents and children", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 1);
		expect(ids(result)).toEqual(["C", "Focus", "P"]);
	});

	it("depth 2 returns grandparents and grandchildren", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 2);
		expect(ids(result)).toEqual(["C", "Focus", "GC", "GP", "P"]);
	});

	it("depth 3 reaches the full lineage", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 3);
		expect(ids(result)).toEqual(["C", "Focus", "GC", "GGP", "GP", "P"]);
	});

	it("depth larger than lineage returns everything", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 100);
		expect(ids(result)).toEqual(["C", "Focus", "GC", "GGP", "GP", "P"]);
	});

	it("includes partners of nodes within depth", () => {
		const graph: RelationsGraph = {
			nodes: [node("P"), node("Focus"), node("Spouse")],
			edges: [gen("Focus", "P"), pair("Focus", "Spouse")],
		};
		const result = filterFamilyNeighborhood(graph, "Focus", 1);
		expect(ids(result)).toEqual(["Focus", "P", "Spouse"]);
	});

	it("does NOT include partners beyond depth boundary", () => {
		const graph: RelationsGraph = {
			nodes: [node("GP"), node("GPSpouse"), node("P"), node("Focus")],
			edges: [
				gen("P", "GP"),
				gen("Focus", "P"),
				pair("GP", "GPSpouse"),
			],
		};
		// depth 1: Focus sees P. GP is 2 generations up — excluded along with GPSpouse.
		const result = filterFamilyNeighborhood(graph, "Focus", 1);
		expect(ids(result)).toEqual(["Focus", "P"]);
	});

	it("includes co-parents of children within depth", () => {
		const graph: RelationsGraph = {
			nodes: [node("Focus"), node("ExPartner"), node("Child")],
			edges: [
				gen("Child", "Focus"),
				gen("Child", "ExPartner"),
			],
		};
		const result = filterFamilyNeighborhood(graph, "Focus", 1);
		expect(ids(result)).toEqual(["Child", "ExPartner", "Focus"]);
	});

	it("returns only edges between included nodes", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Focus", 1);
		expect(result.edges).toHaveLength(2); // Focus→P and C→Focus
		for (const e of result.edges) {
			expect(ids(result)).toContain(e.source);
			expect(ids(result)).toContain(e.target);
		}
	});

	it("drops non-genealogy/pair edges", () => {
		const graph: RelationsGraph = {
			nodes: [node("Focus"), node("Ally")],
			edges: [
				{ source: "Focus", target: "Ally", type: "ally", color: "#0f0", symmetric: true, pair: false, lineStyle: "solid", genealogy: false },
			],
		};
		const result = filterFamilyNeighborhood(graph, "Focus");
		expect(result.edges).toHaveLength(0);
	});

	it("returns empty graph when focus not found", () => {
		const result = filterFamilyNeighborhood(LINEAGE, "Nobody");
		expect(result.nodes).toHaveLength(0);
		expect(result.edges).toHaveLength(0);
	});
});
