import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { applyGenerationLayout } from "../src/family-tree";
import type { RelationsGraph, GraphEdge, GraphNode } from "../src/types";

function node(id: string): GraphNode {
	return { id, label: id, tags: [], image: null };
}

function genealogyEdge(child: string, parent: string): GraphEdge {
	return { source: child, target: parent, type: "parent", color: "#b45309", symmetric: false, pair: false, lineStyle: "solid", genealogy: true };
}

function allyEdge(a: string, b: string): GraphEdge {
	return { source: a, target: b, type: "ally", color: "#22c55e", symmetric: true, pair: false, lineStyle: "solid", genealogy: false };
}

function buildCy(graph: RelationsGraph): cytoscape.Core {
	const elements: cytoscape.ElementDefinition[] = [];
	for (const n of graph.nodes) elements.push({ data: { id: n.id, label: n.label } });
	for (const e of graph.edges) {
		elements.push({ data: { id: `${e.source}__${e.type}__${e.target}`, source: e.source, target: e.target } });
	}
	return cytoscape({ elements, headless: true });
}

function positions(cy: cytoscape.Core): Record<string, { x: number; y: number }> {
	const out: Record<string, { x: number; y: number }> = {};
	cy.nodes().forEach((n) => { out[n.id()] = { ...n.position() }; });
	return out;
}

// Varinka (child of Amalayin) has a child Twice. Meine and Serion are allies of
// Varinka; Marta is an ally of Twice; Kolimot is linked only to Meine.
function familyWithRelations(): RelationsGraph {
	return {
		nodes: ["Amalayin", "Varinka", "Twice", "Meine", "Serion", "Marta", "Kolimot"].map(node),
		edges: [
			genealogyEdge("Varinka", "Amalayin"),
			genealogyEdge("Twice", "Varinka"),
			allyEdge("Varinka", "Meine"),
			allyEdge("Varinka", "Serion"),
			allyEdge("Twice", "Marta"),
			allyEdge("Meine", "Kolimot"),
		],
	};
}

describe("applyGenerationLayout: anchorRelations", () => {
	it("puts a non-family note on its anchor's row, to the right of the whole tree", () => {
		const graph = familyWithRelations();
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph, { anchorRelations: true });
		const pos = positions(cy);
		const treeMaxX = Math.max(pos["Amalayin"].x, pos["Varinka"].x, pos["Twice"].x);
		expect(pos["Meine"].y).toBe(pos["Varinka"].y);
		expect(pos["Serion"].y).toBe(pos["Varinka"].y);
		expect(pos["Marta"].y).toBe(pos["Twice"].y);
		for (const id of ["Meine", "Serion", "Marta"]) {
			expect(pos[id].x).toBeGreaterThan(treeMaxX);
		}
	});

	it("stacks several notes on one row side by side without overlapping", () => {
		const graph = familyWithRelations();
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph, { anchorRelations: true });
		const pos = positions(cy);
		expect(pos["Meine"].x).not.toBe(pos["Serion"].x);
		expect(Math.abs(pos["Meine"].x - pos["Serion"].x)).toBeGreaterThanOrEqual(100);
	});

	it("places a note linked only to another non-family note on that note's row", () => {
		const graph = familyWithRelations();
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph, { anchorRelations: true });
		const pos = positions(cy);
		expect(pos["Kolimot"].y).toBe(pos["Meine"].y);
		expect(pos["Kolimot"].x).not.toBe(pos["Meine"].x);
	});

	it("puts a note with no links at all into the fallback area, not on top of anything", () => {
		const graph = familyWithRelations();
		graph.nodes.push(node("Loner"));
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph, { anchorRelations: true });
		const pos = positions(cy);
		const others = Object.entries(pos).filter(([id]) => id !== "Loner");
		for (const [, p] of others) {
			expect(Math.hypot(p.x - pos["Loner"].x, p.y - pos["Loner"].y)).toBeGreaterThan(60);
		}
	});

	it("leaves the family nodes where they were without the option", () => {
		const graph = familyWithRelations();
		const a = buildCy(graph);
		const b = buildCy(graph);
		applyGenerationLayout(a, graph, { anchorRelations: true });
		applyGenerationLayout(b, graph);
		const pa = positions(a);
		const pb = positions(b);
		for (const id of ["Amalayin", "Varinka", "Twice"]) expect(pa[id]).toEqual(pb[id]);
	});

	it("without the option, non-family notes keep the old single row at y = 0", () => {
		const graph = familyWithRelations();
		const cy = buildCy(graph);
		applyGenerationLayout(cy, graph);
		const pos = positions(cy);
		for (const id of ["Meine", "Serion", "Marta", "Kolimot"]) expect(pos[id].y).toBe(0);
	});
});
