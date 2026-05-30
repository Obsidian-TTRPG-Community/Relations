import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { applyGenerationLayout } from "../src/family-tree";
import type { RelationsGraph, GraphEdge, GraphNode } from "../src/types";

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function genealogyEdge(child: string, parent: string): GraphEdge {
	return {
		source: child,
		target: parent,
		type: "parent",
		color: "#b45309",
		symmetric: false,
		pair: false,
		lineStyle: "solid",
		genealogy: true,
	};
}

function pairEdge(a: string, b: string): GraphEdge {
	return {
		source: a,
		target: b,
		type: "spouse",
		color: "#d946ef",
		symmetric: true,
		pair: true,
		lineStyle: "double",
		genealogy: false,
	};
}

function buildCy(graph: RelationsGraph): cytoscape.Core {
	const elements: cytoscape.ElementDefinition[] = [];
	for (const n of graph.nodes) {
		elements.push({ data: { id: n.id, label: n.label } });
	}
	for (const e of graph.edges) {
		elements.push({
			data: {
				id: `${e.source}__${e.type}__${e.target}`,
				source: e.source,
				target: e.target,
			},
		});
	}
	return cytoscape({ elements, headless: true });
}

function positions(cy: cytoscape.Core): Record<string, { x: number; y: number }> {
	const result: Record<string, { x: number; y: number }> = {};
	cy.nodes().forEach((n) => {
		result[n.id()] = n.position();
	});
	return result;
}

describe("applyGenerationLayout", () => {
	it("places a single node at the origin row", () => {
		const graph: RelationsGraph = {
			nodes: [node("A")],
			edges: [],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["A"]).toBeDefined();
	});

	it("places parent above child", () => {
		const graph: RelationsGraph = {
			nodes: [node("Parent"), node("Child")],
			edges: [genealogyEdge("Child", "Parent")],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["Parent"].y).toBeLessThan(pos["Child"].y);
	});

	it("places grandparent above parent above grandchild", () => {
		const graph: RelationsGraph = {
			nodes: [node("Grandparent"), node("Parent"), node("Child")],
			edges: [
				genealogyEdge("Parent", "Grandparent"),
				genealogyEdge("Child", "Parent"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["Grandparent"].y).toBeLessThan(pos["Parent"].y);
		expect(pos["Parent"].y).toBeLessThan(pos["Child"].y);
	});

	it("places spouses on the same row", () => {
		const graph: RelationsGraph = {
			nodes: [node("Arthur"), node("Morgause"), node("Mordred")],
			edges: [
				pairEdge("Arthur", "Morgause"),
				genealogyEdge("Mordred", "Arthur"),
				genealogyEdge("Mordred", "Morgause"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["Arthur"].y).toBe(pos["Morgause"].y);
		expect(pos["Mordred"].y).toBeGreaterThan(pos["Arthur"].y);
	});

	it("places siblings on the same row", () => {
		const graph: RelationsGraph = {
			nodes: [node("Parent"), node("Child1"), node("Child2"), node("Child3")],
			edges: [
				genealogyEdge("Child1", "Parent"),
				genealogyEdge("Child2", "Parent"),
				genealogyEdge("Child3", "Parent"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["Child1"].y).toBe(pos["Child2"].y);
		expect(pos["Child2"].y).toBe(pos["Child3"].y);
	});

	it("spaces siblings horizontally", () => {
		const graph: RelationsGraph = {
			nodes: [node("Parent"), node("A"), node("B")],
			edges: [
				genealogyEdge("A", "Parent"),
				genealogyEdge("B", "Parent"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["A"].x).not.toBe(pos["B"].x);
	});

	it("respects spacing parameter", () => {
		const graph: RelationsGraph = {
			nodes: [node("Parent"), node("Child")],
			edges: [genealogyEdge("Child", "Parent")],
		};
		const cy1 = buildCy(graph);
		applyGenerationLayout(cy1, graph, { spacing: 1 });
		const gap1 = positions(cy1)["Child"].y - positions(cy1)["Parent"].y;

		const cy2 = buildCy(graph);
		applyGenerationLayout(cy2, graph, { spacing: 2 });
		const gap2 = positions(cy2)["Child"].y - positions(cy2)["Parent"].y;

		expect(gap2).toBeGreaterThan(gap1);
	});

	it("clamps spacing to valid range", () => {
		const graph: RelationsGraph = {
			nodes: [node("Parent"), node("Child")],
			edges: [genealogyEdge("Child", "Parent")],
		};
		const cyMin = buildCy(graph);
		applyGenerationLayout(cyMin, graph, { spacing: 0 });
		const gapMin = positions(cyMin)["Child"].y - positions(cyMin)["Parent"].y;

		const cyLow = buildCy(graph);
		applyGenerationLayout(cyLow, graph, { spacing: 0.2 });
		const gapLow = positions(cyLow)["Child"].y - positions(cyLow)["Parent"].y;

		// spacing: 0 should be clamped to 0.2
		expect(gapMin).toBe(gapLow);
	});

	it("handles multi-marriage: two units sharing a parent", () => {
		const graph: RelationsGraph = {
			nodes: [
				node("Arthur"), node("Morgause"), node("Guinevere"),
				node("Mordred"), node("Galahad"),
			],
			edges: [
				pairEdge("Arthur", "Morgause"),
				pairEdge("Arthur", "Guinevere"),
				genealogyEdge("Mordred", "Arthur"),
				genealogyEdge("Mordred", "Morgause"),
				genealogyEdge("Galahad", "Arthur"),
				genealogyEdge("Galahad", "Guinevere"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		// All parents on the same row
		expect(pos["Arthur"].y).toBe(pos["Morgause"].y);
		expect(pos["Arthur"].y).toBe(pos["Guinevere"].y);
		// All children on the same row, below parents
		expect(pos["Mordred"].y).toBe(pos["Galahad"].y);
		expect(pos["Mordred"].y).toBeGreaterThan(pos["Arthur"].y);
	});

	it("handles childless couple", () => {
		const graph: RelationsGraph = {
			nodes: [node("A"), node("B")],
			edges: [pairEdge("A", "B")],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		expect(pos["A"].y).toBe(pos["B"].y);
		expect(pos["A"].x).not.toBe(pos["B"].x);
	});

	it("positions all nodes (no node left at default 0,0)", () => {
		const graph: RelationsGraph = {
			nodes: [
				node("Grandpa"), node("Grandma"),
				node("Dad"), node("Mom"),
				node("Kid1"), node("Kid2"),
			],
			edges: [
				pairEdge("Grandpa", "Grandma"),
				pairEdge("Dad", "Mom"),
				genealogyEdge("Dad", "Grandpa"),
				genealogyEdge("Dad", "Grandma"),
				genealogyEdge("Kid1", "Dad"),
				genealogyEdge("Kid1", "Mom"),
				genealogyEdge("Kid2", "Dad"),
				genealogyEdge("Kid2", "Mom"),
			],
		};
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		const allAtOrigin = Object.values(pos).every((p) => p.x === 0 && p.y === 0);
		expect(allAtOrigin).toBe(false);
	});
});
