import { describe, it, expect } from "vitest";
import { resolveConnectorStyle } from "../src/family-connectors";
import type { GraphEdge, RelationsGraph } from "../src/types";

// Raw genealogy edges run child→parent (the child's note declares its parents),
// matching the pre-inversion convention family-connectors.ts expects.
function gen(child: string, parent: string, opts: Partial<GraphEdge> = {}): GraphEdge {
	return {
		source: child,
		target: parent,
		type: "parent",
		color: "#b45309",
		symmetric: false,
		pair: false,
		lineStyle: "solid",
		genealogy: true,
		...opts,
	};
}

function graphOf(edges: GraphEdge[]): RelationsGraph {
	return { nodes: [], edges };
}

describe("resolveConnectorStyle", () => {
	it("resolves a single-parent child's own color/lineStyle", () => {
		const graph = graphOf([gen("Kid", "Anna")]);
		expect(resolveConnectorStyle(graph, "Kid", ["Anna"])).toEqual({ color: "#b45309", lineStyle: "solid" });
	});

	it("resolves via either parent leg for a two-parent child", () => {
		const graph = graphOf([gen("Kid", "Anna"), gen("Kid", "Bram")]);
		expect(resolveConnectorStyle(graph, "Kid", ["Anna", "Bram"])).toEqual({ color: "#b45309", lineStyle: "solid" });
	});

	it("gives different children under the same parent-set their own distinct style (adoption case)", () => {
		const graph = graphOf([
			gen("Bio", "Anna"), gen("Bio", "Bram"),
			gen("Adopted", "Anna", { type: "adopted", color: "#7c3aed", lineStyle: "dotted" }),
			gen("Adopted", "Bram", { type: "adopted", color: "#7c3aed", lineStyle: "dotted" }),
		]);
		expect(resolveConnectorStyle(graph, "Bio", ["Anna", "Bram"])).toEqual({ color: "#b45309", lineStyle: "solid" });
		expect(resolveConnectorStyle(graph, "Adopted", ["Anna", "Bram"])).toEqual({ color: "#7c3aed", lineStyle: "dotted" });
	});

	it("returns undefined when no matching genealogy edge exists", () => {
		const graph = graphOf([gen("Kid", "Anna")]);
		expect(resolveConnectorStyle(graph, "Kid", ["SomeoneElse"])).toBeUndefined();
		expect(resolveConnectorStyle(graph, "OtherKid", ["Anna"])).toBeUndefined();
	});

	it("ignores non-genealogy edges between the same nodes", () => {
		const graph = graphOf([
			{ source: "Kid", target: "Anna", type: "ally", color: "#0f0", symmetric: true, pair: false, lineStyle: "solid", genealogy: false },
		]);
		expect(resolveConnectorStyle(graph, "Kid", ["Anna"])).toBeUndefined();
	});
});
