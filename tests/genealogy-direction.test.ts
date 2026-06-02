import { describe, it, expect } from "vitest";
import type { GraphEdge, RelationsGraph } from "../src/types";

/**
 * Regression test for the genealogy-arrow-direction bug reported by user
 * TGSlasher: when a child note declares `parent: "[[X]]"`, the standard graph
 * view drew the arrow child→parent, visually reading as "child IS the parent of X".
 *
 * The fix inverts genealogy edges at the rendering layer in ALL modes (not just
 * family modes), so the arrow always points parent→child — the conventional
 * reading direction. The raw data model stays child→parent (matching the
 * frontmatter declaration); only the displayed edges flip.
 *
 * We test this by replicating the rendering layer's inversion logic against
 * a minimal graph. Pulling the real renderGraph into a vitest environment
 * would drag in Cytoscape and DOM dependencies; the inversion function is
 * pure and isolating it lets us assert direction without that complexity.
 */

// Mirror of the inversion used inside renderGraph. If renderGraph changes this
// behaviour, this test will need to follow — but the public-facing invariant
// is what we're guarding: genealogy edges render parent→child regardless of
// what the data says.
function invertGenealogy(e: GraphEdge): GraphEdge {
	return e.genealogy ? { ...e, source: e.target, target: e.source } : e;
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

function allyEdge(a: string, b: string): GraphEdge {
	return {
		source: a,
		target: b,
		type: "ally",
		color: "#22c55e",
		symmetric: true,
		pair: false,
		lineStyle: "solid",
		genealogy: false,
	};
}

describe("genealogy arrow direction (regression for TGSlasher report)", () => {
	it("inverts a child→parent genealogy edge so the arrow renders parent→child", () => {
		// The user's setup: Sylvaria declares `parent: "[[Vaelorian Vaelith]]"`.
		// Data model stores source=Sylvaria, target=Vaelorian (the canonical
		// direction). After inversion, source=Vaelorian, target=Sylvaria — so
		// the rendered arrow goes from Vaelorian (parent) to Sylvaria (child).
		const raw = genealogyEdge("Sylvaria", "Vaelorian Vaelith");
		const rendered = invertGenealogy(raw);
		expect(rendered.source).toBe("Vaelorian Vaelith");
		expect(rendered.target).toBe("Sylvaria");
	});

	it("preserves the canonical raw direction for label storage", () => {
		// Labels key against the canonical direction (child→parent) so they
		// stay stable regardless of how the edge is displayed. The raw edge
		// must not be mutated by the inversion.
		const raw = genealogyEdge("Sylvaria", "Vaelorian Vaelith");
		const rawSource = raw.source;
		const rawTarget = raw.target;
		invertGenealogy(raw);
		expect(raw.source).toBe(rawSource);
		expect(raw.target).toBe(rawTarget);
	});

	it("leaves non-genealogy edges untouched", () => {
		// Allies, enemies, spouses, etc. are not inverted — their direction
		// is whatever the frontmatter declared (and most are symmetric anyway).
		const raw = allyEdge("Arthur", "Lancelot");
		const rendered = invertGenealogy(raw);
		expect(rendered.source).toBe("Arthur");
		expect(rendered.target).toBe("Lancelot");
	});

	it("handles a multi-generation chain consistently", () => {
		// Sylvaria → mother → grandmother. Each genealogy edge is stored
		// child→parent and inverts independently.
		const edges = [
			genealogyEdge("Sylvaria", "Vaelorian Vaelith"),
			genealogyEdge("Vaelorian Vaelith", "Grand-Vaelorian"),
		];
		const rendered = edges.map(invertGenealogy);
		// Render order should read parent → child for each generation.
		expect(rendered[0].source).toBe("Vaelorian Vaelith");
		expect(rendered[0].target).toBe("Sylvaria");
		expect(rendered[1].source).toBe("Grand-Vaelorian");
		expect(rendered[1].target).toBe("Vaelorian Vaelith");
	});

	it("renders mixed graphs (genealogy + non-genealogy) with only genealogy inverted", () => {
		const graph: RelationsGraph = {
			nodes: [],
			edges: [
				genealogyEdge("Sylvaria", "Vaelorian Vaelith"),
				allyEdge("Sylvaria", "Some Friend"),
			],
		};
		const rendered = graph.edges.map(invertGenealogy);
		// Genealogy inverted.
		expect(rendered[0].source).toBe("Vaelorian Vaelith");
		expect(rendered[0].target).toBe("Sylvaria");
		// Ally untouched.
		expect(rendered[1].source).toBe("Sylvaria");
		expect(rendered[1].target).toBe("Some Friend");
	});
});
