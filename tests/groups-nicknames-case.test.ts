import { describe, it, expect } from "vitest";
import { filterGraphByGroups, localSubgraph, perspectiveLabel } from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph, RelationshipType } from "../src/types";

/**
 * groups: (issue #16) must play nicely with 0.26.0 nicknames (issue #14), and
 * group names match case-insensitively like relationship property names do.
 */

const type = (name: string, group?: string): RelationshipType => ({
	name, color: "#888", symmetric: false, pair: false, treeLayout: false,
	lineStyle: "solid", genealogy: false, group,
});
const node = (id: string): GraphNode => ({ id, label: id.replace(/\.md$/, ""), tags: [], image: null });
const edge = (source: string, target: string, t: string): GraphEdge => ({
	source, target, type: t, color: "#888", symmetric: false, pair: false, lineStyle: "solid", genealogy: false,
});

const TYPES = [type("ally", "Social"), type("parent", "Family")];
const GRAPH: RelationsGraph = {
	nodes: [node("A.md"), node("B.md"), node("C.md")],
	edges: [edge("A.md", "B.md", "ally"), edge("A.md", "C.md", "parent")],
	displayNames: new Map([["A.md", new Map([["B.md", "Bee"]])]]),
};

describe("groups: filter", () => {
	it("keeps nicknames from the focus note", () => {
		const g = localSubgraph(filterGraphByGroups(GRAPH, new Set(["Social"]), "A.md", TYPES), "A.md", 1);
		const b = g.nodes.find((n) => n.id === "B.md")!;
		expect(perspectiveLabel(g, b, "A.md")).toBe("Bee");
	});

	it("matches group names regardless of case or stray spaces", () => {
		for (const name of ["social", "SOCIAL", " Social "]) {
			const g = filterGraphByGroups(GRAPH, new Set([name]), "A.md", TYPES);
			expect(g.edges.map((e) => e.type)).toEqual(["ally"]);
		}
	});
});
