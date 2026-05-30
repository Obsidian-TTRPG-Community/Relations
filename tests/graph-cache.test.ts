import { describe, it, expect } from "vitest";
import { GraphCache } from "../src/graph-cache";
import { DEFAULT_SETTINGS } from "../src/types";
import type { RelationsGraph, RelationsSettings } from "../src/types";

function makeGraph(nodeIds: string[]): RelationsGraph {
	return {
		nodes: nodeIds.map((id) => ({ id, label: id, tags: [], image: null })),
		edges: [],
	};
}

describe("GraphCache", () => {
	it("returns null on empty cache", () => {
		const cache = new GraphCache();
		expect(cache.get(DEFAULT_SETTINGS)).toBeNull();
	});

	it("returns cached graph on matching settings", () => {
		const cache = new GraphCache();
		const graph = makeGraph(["A", "B"]);
		cache.set(DEFAULT_SETTINGS, graph);
		expect(cache.get(DEFAULT_SETTINGS)).toBe(graph);
	});

	it("returns null after invalidate", () => {
		const cache = new GraphCache();
		cache.set(DEFAULT_SETTINGS, makeGraph(["A"]));
		cache.invalidate();
		expect(cache.get(DEFAULT_SETTINGS)).toBeNull();
	});

	it("returns null when structural settings change", () => {
		const cache = new GraphCache();
		cache.set(DEFAULT_SETTINGS, makeGraph(["A"]));

		const changed: RelationsSettings = {
			...DEFAULT_SETTINGS,
			folderScopes: ["Characters/"],
		};
		expect(cache.get(changed)).toBeNull();
	});

	it("returns cached graph when only cosmetic settings change", () => {
		const cache = new GraphCache();
		const graph = makeGraph(["A"]);
		cache.set(DEFAULT_SETTINGS, graph);

		const cosmetic: RelationsSettings = {
			...DEFAULT_SETTINGS,
			showLegend: !DEFAULT_SETTINGS.showLegend,
			layout: "dagre",
			animateLayout: false,
			localGraphDepth: 5,
		};
		expect(cache.get(cosmetic)).toBe(graph);
	});

	it("busts cache when relationship type names change", () => {
		const cache = new GraphCache();
		cache.set(DEFAULT_SETTINGS, makeGraph(["A"]));

		const changed: RelationsSettings = {
			...DEFAULT_SETTINGS,
			relationshipTypes: [
				...DEFAULT_SETTINGS.relationshipTypes,
				{
					name: "vassal",
					color: "#ffffff",
					symmetric: false,
					pair: false,
					treeLayout: false,
					lineStyle: "solid",
					genealogy: false,
				},
			],
		};
		expect(cache.get(changed)).toBeNull();
	});

	it("busts cache when required tags change", () => {
		const cache = new GraphCache();
		cache.set(DEFAULT_SETTINGS, makeGraph(["A"]));

		const changed: RelationsSettings = {
			...DEFAULT_SETTINGS,
			requiredTags: ["#npc"],
		};
		expect(cache.get(changed)).toBeNull();
	});

	it("busts cache when image property changes", () => {
		const cache = new GraphCache();
		cache.set(DEFAULT_SETTINGS, makeGraph(["A"]));

		const changed: RelationsSettings = {
			...DEFAULT_SETTINGS,
			imageProperty: "portrait",
		};
		expect(cache.get(changed)).toBeNull();
	});

	it("replaces cache on second set", () => {
		const cache = new GraphCache();
		const first = makeGraph(["A"]);
		const second = makeGraph(["B"]);
		cache.set(DEFAULT_SETTINGS, first);
		cache.set(DEFAULT_SETTINGS, second);
		expect(cache.get(DEFAULT_SETTINGS)).toBe(second);
	});
});
