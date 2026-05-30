import { describe, it, expect } from "vitest";
import { extractLinkTargets, stripAlias, dedupeEdges } from "../src/graph";
import type { GraphEdge } from "../src/types";

function edge(overrides: Partial<GraphEdge> & Pick<GraphEdge, "source" | "target" | "type">): GraphEdge {
	return {
		color: "#888",
		symmetric: false,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
		...overrides,
	};
}

describe("stripAlias", () => {
	it("returns plain text unchanged", () => {
		expect(stripAlias("Arthur")).toBe("Arthur");
	});

	it("strips pipe alias", () => {
		expect(stripAlias("Arthur|King")).toBe("Arthur");
	});

	it("strips heading anchor", () => {
		expect(stripAlias("Arthur#Background")).toBe("Arthur");
	});

	it("strips both pipe and heading (pipe first)", () => {
		expect(stripAlias("Arthur|King#Background")).toBe("Arthur");
	});

	it("trims whitespace", () => {
		expect(stripAlias("  Arthur  ")).toBe("Arthur");
	});

	it("handles empty string", () => {
		expect(stripAlias("")).toBe("");
	});
});

describe("extractLinkTargets", () => {
	it("returns empty array for null/undefined", () => {
		expect(extractLinkTargets(null)).toEqual([]);
		expect(extractLinkTargets(undefined)).toEqual([]);
	});

	it("returns empty array for non-string types", () => {
		expect(extractLinkTargets(42)).toEqual([]);
		expect(extractLinkTargets(true)).toEqual([]);
		expect(extractLinkTargets({})).toEqual([]);
	});

	it("returns empty array for empty/whitespace string", () => {
		expect(extractLinkTargets("")).toEqual([]);
		expect(extractLinkTargets("   ")).toEqual([]);
	});

	it("extracts single wikilink", () => {
		expect(extractLinkTargets("[[Arthur]]")).toEqual(["Arthur"]);
	});

	it("extracts multiple wikilinks", () => {
		expect(extractLinkTargets("[[Arthur]] and [[Merlin]]")).toEqual(["Arthur", "Merlin"]);
	});

	it("strips aliases from wikilinks", () => {
		expect(extractLinkTargets("[[Arthur|King Arthur]]")).toEqual(["Arthur"]);
	});

	it("strips heading anchors from wikilinks", () => {
		expect(extractLinkTargets("[[Arthur#Background]]")).toEqual(["Arthur"]);
	});

	it("handles comma-separated plain text", () => {
		expect(extractLinkTargets("Arthur, Merlin, Guinevere")).toEqual([
			"Arthur", "Merlin", "Guinevere",
		]);
	});

	it("handles single plain text value", () => {
		expect(extractLinkTargets("Arthur")).toEqual(["Arthur"]);
	});

	it("flattens array values recursively", () => {
		expect(extractLinkTargets(["[[Arthur]]", "[[Merlin]]"])).toEqual([
			"Arthur", "Merlin",
		]);
	});

	it("handles mixed array with nulls", () => {
		expect(extractLinkTargets(["[[Arthur]]", null, "Merlin"])).toEqual([
			"Arthur", "Merlin",
		]);
	});

	it("handles nested arrays", () => {
		expect(extractLinkTargets([["[[Arthur]]"], "[[Merlin]]"])).toEqual([
			"Arthur", "Merlin",
		]);
	});
});

describe("dedupeEdges", () => {
	it("returns empty array for empty input", () => {
		expect(dedupeEdges([])).toEqual([]);
	});

	it("keeps unique directed edges", () => {
		const edges = [
			edge({ source: "A", target: "B", type: "parent" }),
			edge({ source: "B", target: "C", type: "parent" }),
		];
		expect(dedupeEdges(edges)).toHaveLength(2);
	});

	it("removes duplicate directed edges", () => {
		const edges = [
			edge({ source: "A", target: "B", type: "parent" }),
			edge({ source: "A", target: "B", type: "parent" }),
		];
		expect(dedupeEdges(edges)).toHaveLength(1);
	});

	it("keeps directed edges with different directions", () => {
		const edges = [
			edge({ source: "A", target: "B", type: "parent" }),
			edge({ source: "B", target: "A", type: "parent" }),
		];
		expect(dedupeEdges(edges)).toHaveLength(2);
	});

	it("deduplicates symmetric edges regardless of direction", () => {
		const edges = [
			edge({ source: "A", target: "B", type: "ally", symmetric: true }),
			edge({ source: "B", target: "A", type: "ally", symmetric: true }),
		];
		expect(dedupeEdges(edges)).toHaveLength(1);
	});

	it("keeps symmetric edges of different types", () => {
		const edges = [
			edge({ source: "A", target: "B", type: "ally", symmetric: true }),
			edge({ source: "A", target: "B", type: "friend", symmetric: true }),
		];
		expect(dedupeEdges(edges)).toHaveLength(2);
	});

	it("preserves first occurrence", () => {
		const first = edge({ source: "A", target: "B", type: "ally", symmetric: true, color: "#111" });
		const second = edge({ source: "B", target: "A", type: "ally", symmetric: true, color: "#222" });
		const result = dedupeEdges([first, second]);
		expect(result[0].color).toBe("#111");
	});
});
