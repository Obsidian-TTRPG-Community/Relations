export type LineStyle = "solid" | "dashed" | "dotted" | "double";

export interface RelationshipType {
	name: string;             // frontmatter property name, e.g. "ally", "spouse"
	color: string;            // hex
	symmetric: boolean;       // A→B implies B→A
	pair: boolean;            // pair-tightly: pulls nodes close + draws short connector (e.g. spouse)
	treeLayout: boolean;      // when this type dominates a graph, switch to top-down dagre
	lineStyle: LineStyle;     // edge line appearance
	genealogy: boolean;       // counts as a bloodline edge for family-tree layout (e.g. parent)
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

	// Local graph: how many hops out from the active note
	localGraphDepth: number;

	// Side-panel: render in family-tree mode (overrides force-directed)
	familyTree: boolean;
}

export const DEFAULT_SETTINGS: RelationsSettings = {
	relationshipTypes: [
		{ name: "ally",   color: "#4ade80", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "enemy",  color: "#ef4444", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "family", color: "#fbbf24", symmetric: true,  pair: false, treeLayout: true,  lineStyle: "solid",  genealogy: false },
		{ name: "friend", color: "#60a5fa", symmetric: true,  pair: false, treeLayout: false, lineStyle: "solid",  genealogy: false },
		{ name: "rival",  color: "#f97316", symmetric: true,  pair: false, treeLayout: false, lineStyle: "dashed", genealogy: false },
		{ name: "spouse", color: "#ec4899", symmetric: true,  pair: true,  treeLayout: false, lineStyle: "double", genealogy: false },
		{ name: "lover",  color: "#f472b6", symmetric: true,  pair: false, treeLayout: false, lineStyle: "dashed", genealogy: false },
		{ name: "mentor", color: "#a78bfa", symmetric: false, pair: false, treeLayout: false, lineStyle: "dotted", genealogy: false },
		{ name: "parent", color: "#fbbf24", symmetric: false, pair: false, treeLayout: true,  lineStyle: "solid",  genealogy: true  },
	],
	imageProperty: "npcimage",
	folderScopes: [],
	requiredTags: [],
	showLegend: true,
	layout: "fcose",
	localGraphDepth: 2,
	familyTree: false,
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
