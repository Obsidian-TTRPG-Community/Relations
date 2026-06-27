export type LineStyle = "solid" | "dashed" | "dotted" | "double";

export interface RelationshipType {
	name: string;             // frontmatter property name, e.g. "ally", "spouse"
	color: string;            // hex
	symmetric: boolean;       // A→B implies B→A
	pair: boolean;            // pair-tightly: pulls nodes close + draws short connector (e.g. spouse)
	treeLayout: boolean;      // when this type dominates a graph, switch to top-down dagre
	lineStyle: LineStyle;     // edge line appearance
	genealogy: boolean;       // counts as a bloodline edge for family-graph layout (e.g. parent)
	// Optional grouping label. Purely cosmetic: types sharing a group are
	// clustered under a heading in the legend (e.g. put `parent` and `family`
	// in a "Family" group). Empty/undefined means ungrouped. Does not affect
	// graph structure, so it's excluded from the cache signature.
	group?: string;
}

export type GraphMode = "full" | "local";

/**
 * One rule in the ring-color mapping: when a node's value of the configured
 * frontmatter property equals `value` (string-compared, trimmed, case-sensitive),
 * the node's outer ring renders in `color`. No match means no ring color.
 */
export interface RingColorRule {
	value: string;   // exact-match against frontmatter value (case-sensitive)
	color: string;   // hex color string, e.g. "#ef4444"
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

	// Names of relationship types currently filtered OUT of the graph. Edges of
	// these types (and any nodes left with no remaining edges) are hidden in both
	// the side-panel view and code-block embeds. Persisted so the filter survives
	// reloads. Empty = everything visible. Cosmetic/view-only: not part of the
	// graph-cache signature, since it changes what's shown, not what's parsed.
	disabledTypes: string[];

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

	// Ring color: a property-driven outer ring around each node, configured via
	// a single frontmatter property name plus a list of value→color rules. Empty
	// property name = feature disabled. Rules are exact-match; an unmatched value
	// produces no ring (uses the default border color from the stylesheet).
	//
	// Example use: ringColorProperty = "feelings", rules = [{value: "enemy", color: "#dc2626"},
	// {value: "friendly", color: "#22c55e"}]. A note with `feelings: enemy` in its
	// frontmatter then renders with a red ring.
	ringColorProperty: string;
	ringColorRules: RingColorRule[];

	// Node badges: small DOM overlays pinned to each node's corners and beneath
	// the node, content driven by frontmatter properties. Each is a single
	// property name; the rendered content is whatever the user puts in that
	// property — emoji, abbreviation, short text — passed through unchanged.
	// Empty property name = that slot is disabled. Badges respect the global
	// label-visibility toggle (showNodeLabels): turn labels off and badges
	// also disappear, so "minimal portraits" mode stays minimal.
	topLeftIconProperty: string;
	topRightIconProperty: string;
	subtextProperty: string;
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
	disabledTypes: [],
	showNodeLabels: true,
	localGraphDepth: 2,
	animateLayout: true,
	ringColorProperty: "",
	ringColorRules: [],
	topLeftIconProperty: "",
	topRightIconProperty: "",
	subtextProperty: "",
};

// Internal model
export interface GraphNode {
	id: string;            // file path
	label: string;         // basename
	tags: string[];
	image: string | null;  // resolved resource URL or null
	// Optional outer-ring color for the node. Driven by frontmatter via the
	// settings.ringColorProperty + settings.ringColorRules mapping. Undefined
	// means "no ring color rule applied" — the node uses the default border
	// color from the stylesheet.
	ringColor?: string;
	// Optional badge content rendered by the node-badges DOM overlay (see
	// node-badges.ts). Each is the raw string from frontmatter — emoji,
	// abbreviation, single character, whatever the user wants. The overlay
	// pins these to the corners and beneath the node respectively. Undefined
	// values produce no DOM (the overlay simply skips nodes with nothing to
	// draw, keeping the DOM minimal even on large vaults).
	topLeftIcon?: string;
	topRightIcon?: string;
	subtext?: string;
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

/**
 * Persistence interface for short inline labels on relationship edges
 * (e.g. "hates them 75%", "married 1485"). Labels are global across all
 * blocks and views — an edge between A and B carries the same label
 * everywhere it appears.
 *
 * Keys are built by `edgeLabelKey()` (below), which canonicalises direction
 * for symmetric relationship types so A↔B and B↔A resolve to the same label.
 */
export interface EdgeLabelStore {
	getLabel(key: string): string | null;
	setLabel(key: string, label: string): Promise<void>;
	clearLabel(key: string): Promise<void>;
}

/**
 * Canonical key for an edge label. For symmetric relationship types we sort
 * the endpoints so `[A, enemy, B]` and `[B, enemy, A]` map to the same key.
 * For asymmetric types (e.g. `parent`) direction is preserved.
 */
export function edgeLabelKey(source: string, type: string, target: string, symmetric: boolean): string {
	if (symmetric && source > target) {
		[source, target] = [target, source];
	}
	return `${source}__${type}__${target}`;
}

export const VIEW_TYPE_RELATIONS = "relations-graph";

// Codeblock language tags. We register both — `relations` is the new canonical name,
// `npc-graph` is kept as a permanent alias so existing blocks in user notes still
// render after the rename.
export const RELATIONS_CODE_BLOCKS = ["relations", "npc-graph"] as const;
