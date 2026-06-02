export type LineStyle = "solid" | "dashed" | "dotted" | "double";

export interface RelationshipType {
	name: string;             // frontmatter property name, e.g. "ally", "spouse"
	color: string;            // hex
	symmetric: boolean;       // A→B implies B→A
	pair: boolean;            // pair-tightly: pulls nodes close + draws short connector (e.g. spouse)
	treeLayout: boolean;      // when this type dominates a graph, switch to top-down dagre
	lineStyle: LineStyle;     // edge line appearance
	genealogy: boolean;       // counts as a bloodline edge for family-graph layout (e.g. parent)
}

export type GraphMode = "full" | "local";

/** A saved node position in graph coordinates. */
export interface SavedPosition {
	x: number;
	y: number;
}

/** One locked block's saved state: the id-keyed node positions plus a flag. */
export interface LockedLayout {
	locked: boolean;
	positions: Record<string, SavedPosition>;  // node id (file path) -> position
}

/**
 * Persistence interface for locked code-block layouts. Implemented by the plugin
 * (backed by data.json). Code blocks read/write their saved positions through this
 * rather than touching plugin internals directly. Keyed by the block's `id:` option.
 */
export interface PositionStore {
	get(blockId: string): LockedLayout | null;
	set(blockId: string, layout: LockedLayout): Promise<void>;
	clear(blockId: string): Promise<void>;
}

/**
 * Persistence interface for short inline labels on relationship edges
 * (e.g. "hates them 75%"). Labels are global across all blocks and views —
 * an edge between A and B carries the same label everywhere it appears.
 *
 * Keys are built by `edgeLabelKey()` (see below), which canonicalises the
 * direction for symmetric relationship types so A↔B and B↔A resolve to the
 * same label.
 */
export interface EdgeLabelStore {
	getLabel(key: string): string | null;
	setLabel(key: string, label: string): Promise<void>;
	clearLabel(key: string): Promise<void>;
}

/**
 * Canonical key for an edge label. For symmetric relationship types we sort
 * the endpoints so `[A, enemy, B]` and `[B, enemy, A]` map to the same key.
 * For asymmetric types we preserve direction so e.g. a `parent` label from
 * A→B is distinct from a `parent` label B→A (which shouldn't happen, but if
 * it did they'd be different relationships).
 */
export function edgeLabelKey(source: string, type: string, target: string, symmetric: boolean): string {
	if (symmetric && source > target) {
		[source, target] = [target, source];
	}
	return `${source}__${type}__${target}`;
}


export interface RelationsSettings {
	relationshipTypes: RelationshipType[];

	// Property name on NPC notes that holds the portrait image (path or URL)
	imageProperty: string;

	// Folder & tag scoping
	folderScopes: string[];
	requiredTags: string[];

	// Display
	showLegend: boolean;
	layout: "fcose" | "cose" | "dagre";

	// Whether to show the note name under each node. Some users prefer a cleaner
	// portrait-only graph, especially when nodes have recognisable images. Can be
	// overridden per code-block with `labels: false`.
	showNodeLabels: boolean;

	// Local graph: how many hops out from the active note
	localGraphDepth: number;

	// Whether to animate the layout when a graph is first rendered. When false, nodes
	// snap straight to their final positions — useful on slower hardware, or for users
	// who find the settle-in animation distracting.
	animateLayout: boolean;
}

export const DEFAULT_SETTINGS: RelationsSettings = {
	relationshipTypes: [
		// Color choices — each anchored in convention while being distinguishable
		// at small edge widths. ΔE distances between any pair of warm-warm or
		// cool-cool types are at least ~20 in Lab space.
		//   ally    — emerald: classic green-for-positive bond
		//   enemy   — crimson: deep red, reads as "danger"
		//   family  — gold:    warm "kinship" yellow
		//   friend  — cyan:    cool teal, well separated from ally
		//   rival   — tangerine: orange lifted away from enemy red
		//   spouse  — fuchsia: anchors the romantic-bond color family
		//   lover   — rose:    warmer/lighter than spouse, clearly separate
		//   mentor  — violet:  traditional "wisdom" hue
		//   parent  — bronze:  earthy "blood lineage" brown, distinct from family gold
		{ name: "ally",   color: "#22c55e", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "enemy",  color: "#dc2626", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "family", color: "#eab308", symmetric: true,  pair: false, treeLayout: true,  lineStyle: "solid",  genealogy: false },
		{ name: "friend", color: "#0891b2", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "rival",  color: "#fb923c", symmetric: true,  pair: false, treeLayout: false, lineStyle: "dashed", genealogy: false },
		{ name: "spouse", color: "#d946ef", symmetric: true,  pair: true,  treeLayout: false, lineStyle: "double", genealogy: false },
		{ name: "lover",  color: "#fb7185", symmetric: true,  pair: false, treeLayout: false, lineStyle: "dashed", genealogy: false },
		{ name: "mentor", color: "#8b5cf6", symmetric: false, pair: false, treeLayout: false, lineStyle: "dotted", genealogy: false },
		{ name: "parent", color: "#b45309", symmetric: false, pair: false, treeLayout: true,  lineStyle: "solid",  genealogy: true  },
	],
	imageProperty: "npcimage",
	folderScopes: [],
	requiredTags: [],
	showLegend: true,
	layout: "fcose",
	showNodeLabels: true,
	localGraphDepth: 2,
	animateLayout: true,
};

// Internal model
export interface GraphNode {
	id: string;            // file path
	label: string;         // basename
	tags: string[];
	image: string | null;  // resolved resource URL or null
}

export interface GraphEdge {
	source: string;
	target: string;
	type: string;
	color: string;
	symmetric: boolean;
	pair: boolean;
	lineStyle: LineStyle;
	genealogy: boolean;
}

export interface RelationsGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export const VIEW_TYPE_RELATIONS = "relations-graph";

// Codeblock language tags. We register both — `relations` is the new canonical name,
// `npc-graph` is kept as a permanent alias so existing blocks in user notes still
// render after the rename.
export const RELATIONS_CODE_BLOCKS = ["relations", "npc-graph"] as const;
