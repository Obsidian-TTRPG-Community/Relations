import { describe, it, expect } from "vitest";
import { synthesizeInformalPartnerships, INFORMAL_PARTNERSHIP_TYPE } from "../src/render";
import type { GraphEdge, RelationsGraph } from "../src/types";

// Raw genealogy edges run child→parent (the child's note declares its parents),
// so a "co-parent" pair is two parents reached from the same child.
function gen(child: string, parent: string): GraphEdge {
	return { source: child, target: parent, type: "parent", color: "#888", symmetric: false, pair: false, lineStyle: "solid", genealogy: true };
}

function pair(a: string, b: string): GraphEdge {
	return { source: a, target: b, type: "spouse", color: "#d946ef", symmetric: true, pair: true, lineStyle: "double", genealogy: false };
}

function graphOf(edges: GraphEdge[]): RelationsGraph {
	return { nodes: [], edges };
}

describe("synthesizeInformalPartnerships", () => {
	it("connects two co-parents who have no declared pair edge", () => {
		const out = synthesizeInformalPartnerships(graphOf([gen("Kid", "Anna"), gen("Kid", "Bram")]));
		expect(out).toHaveLength(1);
		const e = out[0];
		expect(e.type).toBe(INFORMAL_PARTNERSHIP_TYPE);
		expect(e.lineStyle).toBe("dotted");
		expect(e.pair).toBe(true);
		expect([e.source, e.target].sort()).toEqual(["Anna", "Bram"]);
	});

	it("does NOT synthesize when the co-parents already have a declared pair edge", () => {
		const out = synthesizeInformalPartnerships(graphOf([
			gen("Kid", "Anna"),
			gen("Kid", "Bram"),
			pair("Anna", "Bram"),
		]));
		expect(out).toHaveLength(0);
	});

	it("ignores a child with a single parent", () => {
		const out = synthesizeInformalPartnerships(graphOf([gen("Kid", "Anna")]));
		expect(out).toHaveLength(0);
	});

	it("emits one edge per distinct co-parent pair for three co-parents", () => {
		const out = synthesizeInformalPartnerships(graphOf([
			gen("Kid", "Anna"),
			gen("Kid", "Bram"),
			gen("Kid", "Cora"),
		]));
		expect(out).toHaveLength(3); // C(3,2)
	});

	it("dedupes a co-parent pair that shares two children", () => {
		const out = synthesizeInformalPartnerships(graphOf([
			gen("KidOne", "Anna"), gen("KidOne", "Bram"),
			gen("KidTwo", "Anna"), gen("KidTwo", "Bram"),
		]));
		expect(out).toHaveLength(1);
	});

	it("does not connect parents of different children", () => {
		const out = synthesizeInformalPartnerships(graphOf([
			gen("KidOne", "Anna"),
			gen("KidTwo", "Bram"),
		]));
		expect(out).toHaveLength(0);
	});
});
