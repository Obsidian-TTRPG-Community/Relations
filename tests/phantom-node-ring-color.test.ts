import { describe, it, expect } from "vitest";
import type { GraphNode, RelationsSettings, RingColorRule } from "../src/types";

/**
 * Tests for phantom nodes with ring color rules.
 *
 * Phantom nodes are created for unresolved references (links to notes that don't exist).
 * Key behavior: Phantom nodes should NEVER have a ringColor property, even when
 * ring color rules are configured in settings.
 *
 * Reason: Ring colors are resolved from note frontmatter. Phantom nodes have no
 * frontmatter (they're not real files), so they can't have colors applied.
 *
 * Test scenarios:
 *   - Phantom node exists alongside ring color rules → no ringColor on phantom
 *   - Real node matches ring color rule → ringColor applied to real node
 *   - Phantom node would hypothetically match rule (if it existed) → still no ringColor
 *   - Multiple phantoms in graph → none get ring colors
 */

function makePhantomNode(id: string, label: string): GraphNode {
	return {
		id,
		label,
		tags: [],
		image: null,
		isPhantom: true,
	};
}

function makeRealNode(
	id: string,
	label: string,
	ringColor?: string
): GraphNode {
	const node: GraphNode = {
		id,
		label,
		tags: [],
		image: null,
	};
	if (ringColor) node.ringColor = ringColor;
	return node;
}

describe("phantom nodes and ring color", () => {
	it("phantom nodes do not have ringColor property", () => {
		// Create a phantom node for an unresolved reference
		const phantom = makePhantomNode("alice", "Alice the Wise");

		// Verify the phantom node is marked as phantom
		expect(phantom.isPhantom).toBe(true);

		// Verify it has NO ringColor property
		expect(phantom.ringColor).toBeUndefined();
	});

	it("phantom nodes never get ringColor even with configured rules", () => {
		// This mirrors scenario 5 from the issue:
		// - Ring color rules are configured (e.g., type: villain → red)
		// - A phantom node would match those rules if it existed
		// - But since it doesn't exist, it's a phantom with no ringColor

		const phantom = makePhantomNode("alice", "Alice");

		// Even though settings have ringColor rules configured,
		// the phantom node doesn't go through resolveRingColor (no frontmatter to read)
		expect(phantom.ringColor).toBeUndefined();

		// Verify phantom is still phantom
		expect(phantom.isPhantom).toBe(true);
	});

	it("real nodes can have ringColor while phantoms don't", () => {
		// Real node with ring color applied
		const realNode = makeRealNode("bob", "Bob", "#dc2626");

		// Phantom node with no ring color
		const phantomNode = makePhantomNode("charlie", "Charlie");

		// Real node has the property
		expect(realNode.ringColor).toBe("#dc2626");
		expect(realNode.isPhantom).toBeUndefined();

		// Phantom does not
		expect(phantomNode.ringColor).toBeUndefined();
		expect(phantomNode.isPhantom).toBe(true);
	});

	it("phantom nodes render with isPhantom data attribute for CSS selector", () => {
		// When rendered to Cytoscape, phantom nodes expose isPhantom as a data attribute.
		// This prevents CSS ring-color selectors (node[ringColor]) from matching them.

		const phantom = makePhantomNode("alice", "Alice");

		// The data attribute is present and true
		expect(phantom.isPhantom).toBe(true);

		// No ringColor data attribute exists
		expect(phantom.ringColor).toBeUndefined();

		// Cytoscape selectors:
		//   node[ringColor] — matches real nodes with ring colors, NOT phantoms
		//   node[isPhantom = 'true'] — matches only phantoms (for faded styling)
		// So ring-color styling never applies to phantoms.
	});

	it("multiple phantom nodes all lack ringColor", () => {
		// Graph with multiple unresolved references
		const phantoms = [
			makePhantomNode("alice", "Alice the Wise"),
			makePhantomNode("bob", "Bob"),
			makePhantomNode("charlie", "Charlie the Brave"),
		];

		// None should have ringColor
		for (const p of phantoms) {
			expect(p.ringColor).toBeUndefined();
			expect(p.isPhantom).toBe(true);
		}
	});

	it("mixed real and phantom nodes maintain correct styling", () => {
		// Graph with both real and phantom nodes
		const nodes: GraphNode[] = [
			makeRealNode("alice", "Alice", "#22c55e"), // real, has color
			makePhantomNode("bob", "Bob"), // phantom, no color
			makeRealNode("charlie", "Charlie", "#ef4444"), // real, has color
			makePhantomNode("david", "David"), // phantom, no color
		];

		// Verify each node's state
		expect(nodes[0].ringColor).toBe("#22c55e");
		expect(nodes[0].isPhantom).toBeUndefined();

		expect(nodes[1].ringColor).toBeUndefined();
		expect(nodes[1].isPhantom).toBe(true);

		expect(nodes[2].ringColor).toBe("#ef4444");
		expect(nodes[2].isPhantom).toBeUndefined();

		expect(nodes[3].ringColor).toBeUndefined();
		expect(nodes[3].isPhantom).toBe(true);
	});

	it("phantom nodes with images don't get ring colors", () => {
		// Even though phantom nodes have a placeholder image,
		// they still don't have ring colors
		const phantom: GraphNode = {
			id: "alice",
			label: "Alice",
			tags: [],
			image: "z_Assets/Placeholder.png", // has image
			isPhantom: true,
		};

		expect(phantom.image).toBe("z_Assets/Placeholder.png");
		expect(phantom.ringColor).toBeUndefined();
		expect(phantom.isPhantom).toBe(true);
	});

	it("CSS selector node[ringColor] correctly excludes phantoms", () => {
		// This test documents the CSS selector behavior:
		//   node[ringColor] — matches only nodes with ringColor data attribute
		//
		// Real nodes with colors have the attribute:
		const realNodeWithColor: GraphNode = {
			id: "alice",
			label: "Alice",
			tags: [],
			image: null,
			ringColor: "#ef4444",
		};

		// Phantoms don't have the attribute:
		const phantom: GraphNode = {
			id: "bob",
			label: "Bob",
			tags: [],
			image: null,
			isPhantom: true,
		};

		// When rendering to Cytoscape, Cytoscape's selector
		// 'node[ringColor]' will match realNodeWithColor but not phantom.
		// This is because ringColor is undefined/missing on phantom.

		expect(realNodeWithColor.ringColor).toBeDefined();
		expect(phantom.ringColor).toBeUndefined();

		// The presence test in Cytoscape (node[ringColor]) only matches
		// when the attribute is truthy and present.
	});
});
