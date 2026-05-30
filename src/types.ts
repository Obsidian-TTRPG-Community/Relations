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

export interface SavedPosition {
	x: number;
	y: number;
}

export interface LockedLayout {
	locked: boolean;
	positions: Record<string, SavedPosition>;
}

export interface PositionStore {
	get(blockId: string): LockedLayout | null;
	set(blockId: string, layout: LockedLayout): Promise<void>;
	clear(blockId: string): Promise<void>;
}

export const VIEW_TYPE_RELATIONS = "relations-graph";

// Codeblock language tags. We register both — `relations` is the new canonical name,
// `npc-graph` is kept as a permanent alias so existing blocks in user notes still
// render after the rename.
export const RELATIONS_CODE_BLOCKS = ["relations", "npc-graph"] as const;
