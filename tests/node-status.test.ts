import { describe, it, expect } from "vitest";
import {
	nodePropertyValues,
	distinctStatusProperties,
	filterGraphByNodeProperties,
	applyMutedNodes,
	mutedLegendEntries,
} from "../src/graph";
import type { GraphEdge, GraphNode, RelationsGraph, StatusRule } from "../src/types";

/**
 * Tests for the Node status feature: value extraction (nodePropertyValues),
 * the property-name aggregator used by the graph cache (distinctStatusProperties),
 * Hide (filterGraphByNodeProperties), and Mute (applyMutedNodes).
 */

function node(id: string, filterValues?: Record<string, string[]>): GraphNode {
	return { id, label: id, tags: [], image: null, filterValues };
}

function edge(source: string, target: string, type = "friend"): GraphEdge {
	return {
		source, target, type,
		color: "#888",
		symmetric: true,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
	};
}

function rule(overrides: Partial<StatusRule> = {}): StatusRule {
	return {
		property: "char_status",
		value: "Dead",
		hide: false,
		mute: false,
		muteColor: "#6b7280",
		...overrides,
	};
}

describe("nodePropertyValues", () => {
	it("returns an empty array when the property name is blank", () => {
		expect(nodePropertyValues({ char_status: "Dead" }, "")).toEqual([]);
	});

	it("returns an empty array when frontmatter is missing entirely", () => {
		expect(nodePropertyValues(undefined, "char_status")).toEqual([]);
	});

	it("returns an empty array when the property isn't set in this note", () => {
		expect(nodePropertyValues({ other: "x" }, "char_status")).toEqual([]);
	});

	it("returns a single-element array for a scalar value", () => {
		expect(nodePropertyValues({ char_status: "Dead" }, "char_status")).toEqual(["Dead"]);
	});

	it("returns EVERY element of a list-valued property, not just the first", () => {
		// This is the key difference from resolveFrontmatterString/resolveRingColor,
		// which take only the first element — Hide/Mute must catch a match on any
		// element of a multi-value property like char_condition.
		expect(nodePropertyValues({ char_condition: ["Charmed", "Poisoned"] }, "char_condition"))
			.toEqual(["Charmed", "Poisoned"]);
	});

	it("trims whitespace and drops blank elements", () => {
		expect(nodePropertyValues({ char_condition: [" Charmed ", "", "  "] }, "char_condition"))
			.toEqual(["Charmed"]);
	});

	it("coerces numeric and boolean values to strings", () => {
		expect(nodePropertyValues({ level: 5 }, "level")).toEqual(["5"]);
		expect(nodePropertyValues({ hostile: true }, "hostile")).toEqual(["true"]);
	});
});

describe("distinctStatusProperties", () => {
	it("returns an empty array for no rules", () => {
		expect(distinctStatusProperties([])).toEqual([]);
	});

	it("dedupes property names shared across multiple rules", () => {
		const rules = [
			rule({ property: "char_status", value: "Dead" }),
			rule({ property: "char_status", value: "Undead" }),
			rule({ property: "char_condition", value: "Charmed" }),
		];
		expect(distinctStatusProperties(rules).sort()).toEqual(["char_condition", "char_status"]);
	});

	it("ignores rules with a blank property name", () => {
		expect(distinctStatusProperties([rule({ property: "  " })])).toEqual([]);
	});
});

describe("filterGraphByNodeProperties (Hide)", () => {
	it("returns the original graph reference when no rule has hide set", () => {
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const out = filterGraphByNodeProperties(graph, [rule({ hide: false })]);
		expect(out).toBe(graph);
	});

	it("removes a node whose filterValues match a hide rule, and prunes the neighbor it strands", () => {
		// B has no other edges, so once A is hidden B is left with zero edges —
		// pruned too, mirroring filterGraphByTypes' own pruning, so Hide doesn't
		// leave a dangling isolated node behind.
		const graph: RelationsGraph = {
			nodes: [
				node("A", { char_status: ["Dead"] }),
				node("B", { char_status: ["Alive"] }),
			],
			edges: [edge("A", "B")],
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })]);
		expect(out.nodes).toEqual([]);
		expect(out.edges).toEqual([]);
	});

	it("keeps a stranded neighbor when it is keepNodeId", () => {
		// Same shape as above, but B is the active/center note this time — it
		// must survive even though its only edge went to the now-hidden A.
		const graph: RelationsGraph = {
			nodes: [
				node("A", { char_status: ["Dead"] }),
				node("B", { char_status: ["Alive"] }),
			],
			edges: [edge("A", "B")],
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })], "B");
		expect(out.nodes.map((n) => n.id)).toEqual(["B"]);
		expect(out.edges).toEqual([]);
	});

	it("matches ANY element of a list-valued property", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_condition: ["Poisoned", "Undead"] })],
			edges: [],
		};
		const out = filterGraphByNodeProperties(
			graph,
			[rule({ property: "char_condition", value: "Undead", hide: true })],
		);
		expect(out.nodes).toEqual([]);
	});

	it("keeps keepNodeId even when it matches a hide rule", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] }), node("B")],
			edges: [edge("A", "B")],
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })], "A");
		expect(out.nodes.map((n) => n.id)).toContain("A");
	});

	it("drops edges touching a hidden node", () => {
		const graph: RelationsGraph = {
			nodes: [
				node("A", { char_status: ["Dead"] }),
				node("B"),
				node("C"),
			],
			edges: [edge("A", "B"), edge("B", "C")],
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })]);
		expect(out.edges.map((e) => `${e.source}-${e.target}`)).toEqual(["B-C"]);
	});

	it("ORs across multiple hide rules — a node hidden by any one rule is hidden", () => {
		// D gives C an edge to a survivor unrelated to A/B, so this test isolates
		// the OR-across-rules behavior from the separate stranded-neighbor pruning
		// covered above.
		const graph: RelationsGraph = {
			nodes: [
				node("A", { char_status: ["Dead"] }),
				node("B", { char_condition: ["Undead"] }),
				node("C", { char_status: ["Alive"] }),
				node("D"),
			],
			edges: [edge("A", "C"), edge("B", "C"), edge("C", "D")],
		};
		const rules = [
			rule({ property: "char_status", value: "Dead", hide: true }),
			rule({ property: "char_condition", value: "Undead", hide: true }),
		];
		const out = filterGraphByNodeProperties(graph, rules);
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["C", "D"]);
		expect(out.edges.map((e) => `${e.source}-${e.target}`)).toEqual(["C-D"]);
	});

	it("does not hide a node with mute-only rules (hide false)", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] })],
			edges: [],
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: false, mute: true })]);
		expect(out.nodes.map((n) => n.id)).toEqual(["A"]);
	});

	it("prunes an already-edgeless node once any hide rule is active, unless it's keepNodeId", () => {
		// Mirrors filterGraphByTypes: once pruning is active, a node with zero
		// edges doesn't survive just because it wasn't itself hidden. In real
		// usage buildFullGraph never emits a truly edgeless node here (every
		// node has >=1 edge, or is the sole-node "no relationships yet"
		// fallback, which always passes its own id as keepNodeId) — this test
		// just pins the contract directly.
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })]);
		expect(out.nodes).toEqual([]);
	});

	it("keeps an already-edgeless keepNodeId node even with a hide rule active", () => {
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })], "A");
		expect(out.nodes.map((n) => n.id)).toEqual(["A"]);
	});

	it("does not mutate the input graph", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] }), node("B")],
			edges: [edge("A", "B")],
		};
		filterGraphByNodeProperties(graph, [rule({ hide: true })]);
		expect(graph.nodes.length).toBe(2);
		expect(graph.edges.length).toBe(1);
	});
});

describe("applyMutedNodes (Mute)", () => {
	it("returns the original graph reference when no rule has mute set", () => {
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const out = applyMutedNodes(graph, [rule({ mute: false })]);
		expect(out).toBe(graph);
	});

	it("flags a matching node as muted with the rule's color", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] })],
			edges: [],
		};
		const out = applyMutedNodes(graph, [rule({ mute: true, muteColor: "#111111" })]);
		expect(out.nodes[0].muted).toBe(true);
		expect(out.nodes[0].mutedColor).toBe("#111111");
	});

	it("never removes a node or edge", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] }), node("B")],
			edges: [edge("A", "B")],
		};
		const out = applyMutedNodes(graph, [rule({ mute: true })]);
		expect(out.nodes.map((n) => n.id)).toEqual(["A", "B"]);
		expect(out.edges).toEqual(graph.edges);
	});

	it("leaves a non-matching node's muted flag unset", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Alive"] })],
			edges: [],
		};
		const out = applyMutedNodes(graph, [rule({ mute: true })]);
		expect(out.nodes[0].muted).toBeUndefined();
	});

	it("first matching rule wins when multiple rules match the same node", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"], char_condition: ["Undead"] })],
			edges: [],
		};
		const rules = [
			rule({ property: "char_status", value: "Dead", mute: true, muteColor: "#aaaaaa" }),
			rule({ property: "char_condition", value: "Undead", mute: true, muteColor: "#00ff00" }),
		];
		const out = applyMutedNodes(graph, rules);
		expect(out.nodes[0].mutedColor).toBe("#aaaaaa");
	});

	it("matches ANY element of a list-valued property", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_condition: ["Charmed", "Poisoned"] })],
			edges: [],
		};
		const out = applyMutedNodes(
			graph,
			[rule({ property: "char_condition", value: "Poisoned", mute: true })],
		);
		expect(out.nodes[0].muted).toBe(true);
	});

	it("does not mutate the input graph", () => {
		const graph: RelationsGraph = {
			nodes: [node("A", { char_status: ["Dead"] })],
			edges: [],
		};
		applyMutedNodes(graph, [rule({ mute: true })]);
		expect(graph.nodes[0].muted).toBeUndefined();
	});
});

function mutedNode(id: string, color: string): GraphNode {
	return { id, label: id, tags: [], image: null, muted: true, mutedColor: color };
}

describe("mutedLegendEntries", () => {
	it("returns nothing when no node in the graph is muted", () => {
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const rules = [rule({ mute: true, muteColor: "#6b7280" })];
		expect(mutedLegendEntries(graph, rules)).toEqual([]);
	});

	it("returns nothing when a mute rule exists but no on-screen node carries its color", () => {
		// Rule is configured, but nothing currently rendered is actually muted —
		// the husband's point: don't show the swatch just because the rule exists.
		const graph: RelationsGraph = { nodes: [node("A")], edges: [] };
		const rules = [rule({ value: "Dead", mute: true, muteColor: "#6b7280" })];
		expect(mutedLegendEntries(graph, rules)).toEqual([]);
	});

	it("returns an entry when a muted node with that color is on screen", () => {
		const graph: RelationsGraph = { nodes: [mutedNode("A", "#6b7280")], edges: [] };
		const rules = [rule({ value: "Dead", mute: true, muteColor: "#6b7280" })];
		expect(mutedLegendEntries(graph, rules)).toEqual([{ label: "Dead", color: "#6b7280" }]);
	});

	it("dedupes rules that share a mute color to one entry", () => {
		const graph: RelationsGraph = { nodes: [mutedNode("A", "#6b7280")], edges: [] };
		const rules = [
			rule({ value: "Dead", mute: true, muteColor: "#6b7280" }),
			rule({ property: "char_status", value: "MIA", mute: true, muteColor: "#6b7280" }),
		];
		expect(mutedLegendEntries(graph, rules)).toEqual([{ label: "Dead", color: "#6b7280" }]);
	});

	it("returns a separate entry per distinct color actually on screen", () => {
		const graph: RelationsGraph = {
			nodes: [mutedNode("A", "#6b7280"), mutedNode("B", "#22c55e")],
			edges: [],
		};
		const rules = [
			rule({ value: "Dead", mute: true, muteColor: "#6b7280" }),
			rule({ property: "char_condition", value: "Undead", mute: true, muteColor: "#22c55e" }),
		];
		expect(mutedLegendEntries(graph, rules)).toEqual([
			{ label: "Dead", color: "#6b7280" },
			{ label: "Undead", color: "#22c55e" },
		]);
	});

	it("only includes the color that's actually on screen, not every configured rule", () => {
		const graph: RelationsGraph = { nodes: [mutedNode("A", "#6b7280")], edges: [] };
		const rules = [
			rule({ value: "Dead", mute: true, muteColor: "#6b7280" }),
			rule({ property: "char_condition", value: "Undead", mute: true, muteColor: "#22c55e" }),
		];
		expect(mutedLegendEntries(graph, rules)).toEqual([{ label: "Dead", color: "#6b7280" }]);
	});

	it("falls back to the property name when value is blank", () => {
		const graph: RelationsGraph = { nodes: [mutedNode("A", "#6b7280")], edges: [] };
		const rules = [rule({ property: "char_status", value: "", mute: true, muteColor: "#6b7280" })];
		expect(mutedLegendEntries(graph, rules)).toEqual([{ label: "char_status", color: "#6b7280" }]);
	});

	it("ignores hide-only rules (mute false)", () => {
		const graph: RelationsGraph = { nodes: [mutedNode("A", "#6b7280")], edges: [] };
		const rules = [rule({ value: "Dead", mute: false, hide: true, muteColor: "#6b7280" })];
		expect(mutedLegendEntries(graph, rules)).toEqual([]);
	});
});

describe("perspective display names survive Node status", () => {
	// Upstream (#14) carries a per-direction nickname map on the graph. Hide and
	// Mute return new graphs, so they must carry it along or nicknames vanish
	// whenever a status rule is active.
	const displayNames = new Map([["A", new Map([["B", "The Enlightened One"]])]]);

	it("Hide keeps the displayNames map", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B"), node("C", { char_status: ["Dead"] })],
			edges: [edge("A", "B"), edge("A", "C")],
			displayNames,
		};
		const out = filterGraphByNodeProperties(graph, [rule({ hide: true })], "A");
		expect(out.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
		expect(out.displayNames).toBe(displayNames);
	});

	it("Mute keeps the displayNames map", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B", { char_status: ["Dead"] })],
			edges: [edge("A", "B")],
			displayNames,
		};
		const out = applyMutedNodes(graph, [rule({ mute: true })]);
		expect(out.nodes.find((n) => n.id === "B")?.muted).toBe(true);
		expect(out.displayNames).toBe(displayNames);
	});
});
