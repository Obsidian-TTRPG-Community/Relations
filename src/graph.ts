import { App, TFile, CachedMetadata, getAllTags, normalizePath } from "obsidian";
import {
	RelationsGraph,
	GraphNode,
	GraphEdge,
	RelationsSettings,
	RelationshipType,
	ParsedLink,
	AliasMap,
	GraphBuildResult,
} from "./types";
import { GraphCache } from "./graph-cache";

/**
 * Parse a single link value from frontmatter into a ParsedLink.
 * Handles three formats:
 *   1. Plain text: "Alice" → target: "alice", displayName: "Alice"
 *   2. Wikilink: "[[Alice]]" → target: "alice", displayName: "Alice"
 *   3. Aliased: "[[Alice|Bobby]]" → target: "alice", displayName: "Bobby"
 *
 * Plain text is case-insensitive for vault lookup (target is lowercased),
 * but preserves user's casing in displayName.
 */
export function parseLink(value: unknown): ParsedLink | null {
	if (value == null) return null;
	if (typeof value !== "string") return null;

	const s = value.trim();
	if (!s) return null;

	// Try wikilink format: [[...]] (including empty [[]])
	const wikiMatch = s.match(/^\[\[(.*?)\]\]$/);
	if (wikiMatch) {
		const content = wikiMatch[1].trim();
		if (!content) return null;

		// Check for pipe alias: "target|display"
		const pipeIdx = content.indexOf("|");
		if (pipeIdx >= 0) {
			const target = content.slice(0, pipeIdx).trim();
			let displayName = content.slice(pipeIdx + 1).trim();

			// Validate both parts are non-empty
			if (!target || !displayName) return null;

			// Strip heading anchor from alias if present
			const hashIdx = displayName.indexOf("#");
			if (hashIdx >= 0) {
				displayName = displayName.slice(0, hashIdx).trim();
			}
			if (!displayName) return null;

			return {
				target: normalizeNoteName(target),
				displayName,
				baseName: target,  // Preserve target name with case for extractLinkTargets
				source: "wikilink-alias",
			};
		}

		// No pipe: "[[Alice]]" or "[[Alice#section]]"
		const hashIdx = content.indexOf("#");
		const baseName = (hashIdx >= 0 ? content.slice(0, hashIdx) : content).trim();
		if (baseName) {
			return {
				target: normalizeNoteName(baseName),
				displayName: baseName,
				baseName,  // For consistency with aliased links
				source: "wikilink",
			};
		}
	}

	// Plain text: "Alice" or "alice"
	const normalized = normalizeNoteName(s);
	if (normalized) {
		return {
			target: normalized,
			displayName: s,
			baseName: s,
			source: "plain-text",
		};
	}

	return null;
}

/**
 * Normalize a note name for case-insensitive comparison.
 * Lowercases the input. Returns empty string if input is blank.
 */
export function normalizeNoteName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Extract ParsedLink objects from a frontmatter value.
 * Handles: single values, arrays, comma-separated strings, and nested arrays.
 *
 * Returns array of ParsedLink objects. Invalid entries are skipped.
 */
export function extractParsedLinks(value: unknown): ParsedLink[] {
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.flatMap((v) => extractParsedLinks(v));
	}
	if (typeof value !== "string") return [];

	const s = value.trim();
	if (!s) return [];

	// Check for wikilinks first
	const wikiRegex = /\[\[([^\]]+)\]\]/g;
	const wikiMatches = [...s.matchAll(wikiRegex)];
	if (wikiMatches.length > 0) {
		return wikiMatches
			.map((m) => parseLink(`[[${m[1]}]]`))
			.filter((p): p is ParsedLink => p !== null);
	}

	// No wikilinks: check for comma-separated plain text
	if (s.includes(",")) {
		return s
			.split(",")
			.map((part) => parseLink(part.trim()))
			.filter((p): p is ParsedLink => p !== null);
	}

	// Single plain text value
	const parsed = parseLink(s);
	return parsed ? [parsed] : [];
}

/**
 * Remove edges whose relationship type is in `disabled`, then drop any node left
 * with no remaining edges. `keepNodeId` (the active/center note, when there is
 * one) is always retained even if it becomes isolated, so the view never goes
 * empty on the very note you're looking at.
 *
 * Pure and side-effect-free — returns a new graph, leaving the input untouched.
 */
export function filterGraphByTypes(
	graph: RelationsGraph,
	disabled: ReadonlySet<string>,
	keepNodeId?: string,
): RelationsGraph {
	if (disabled.size === 0) return graph;

	const edges = graph.edges.filter((e) => !disabled.has(e.type));
	const connected = new Set<string>();
	for (const e of edges) {
		connected.add(e.source);
		connected.add(e.target);
	}
	const nodes = graph.nodes.filter(
		(n) => connected.has(n.id) || n.id === keepNodeId,
	);
	return { nodes, edges };
}

/**
 * Build the full relationship graph by scanning every markdown file in scope.
 *
 * Returns both the graph structure and a per-direction alias map for
 * context-aware display names. The graph is cached for performance.
 *
 * If a `cache` is provided, it's consulted first — a hit returns the previously-
 * built graph immediately without rescanning the vault. On miss, the freshly-built
 * graph is stored. Callers that don't have a cache (or want to force a rebuild)
 * can pass `null` or omit the parameter.
 */
export function buildFullGraph(
	app: App,
	settings: RelationsSettings,
	cache: GraphCache | null = null,
): GraphBuildResult {
	const aliasMap: AliasMap = new Map();

	if (cache) {
		const hit = cache.get(settings);
		if (hit) return { graph: hit, aliasMap };
	}

	const typeMap = buildTypeMap(settings);
	const files = app.vault.getMarkdownFiles().filter((f) => inScope(f, settings));

	const notePaths = new Set<string>();
	const rawEdges: GraphEdge[] = [];

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		if (settings.requiredTags.length > 0 && !hasRequiredTag(cache, settings.requiredTags)) {
			continue;
		}

		const fm = cache.frontmatter;
		if (!fm) continue;

		let hasAnyRelationship = false;

		// Process relationship properties in alphabetical order so that when two
		// properties alias the same target differently, precedence is deterministic
		// (independent of the frontmatter's own YAML key order).
		const relevantKeys = Object.keys(fm)
			.filter((key) => typeMap.has(key.toLowerCase()))
			.sort((a, b) => a.localeCompare(b));

		for (const key of relevantKeys) {
			const type = typeMap.get(key.toLowerCase())!;

			const parsedLinks = extractParsedLinks(fm[key]);
			for (const link of parsedLinks) {
				// Resolve via Obsidian's own resolver using the case-preserved link path.
				// getFirstLinkpathDest already handles case, duplicate basenames, and
				// relative paths itself — feeding it a lowercased target would only
				// fight that resolution.
				const resolved = app.metadataCache.getFirstLinkpathDest(link.baseName ?? link.displayName, file.path);
				if (!resolved) continue;
				if (resolved.path === file.path) continue;
				if (!inScope(resolved, settings)) continue;

				let source = file.path;
				let target = resolved.path;
				// For genealogy types declared by parent (declaresChild), swap direction
				// so edges are stored uniformly as child→parent
				if (type.genealogy && type.declaresChild) {
					[source, target] = [target, source];
				}
				rawEdges.push({
					source,
					target,
					type: type.name,
					color: type.color,
					symmetric: type.symmetric,
					pair: type.pair,
					lineStyle: type.lineStyle,
					genealogy: type.genealogy,
				});
				hasAnyRelationship = true;
				notePaths.add(file.path);
				notePaths.add(resolved.path);

				if (link.source === "wikilink-alias") {
					// Keyed from file.path (not the potentially-swapped source) — the
					// alias always describes how file.path refers to the target,
					// regardless of which direction the edge itself is stored.
					if (!aliasMap.has(file.path)) {
						aliasMap.set(file.path, new Map());
					}
					const targetAliases = aliasMap.get(file.path)!;
					// First property wins (relevantKeys is alphabetical, and links
					// within one property are processed in declaration order) when
					// two properties alias the same target differently.
					if (!targetAliases.has(resolved.path)) {
						targetAliases.set(resolved.path, link.displayName);
					}
				}
			}
		}

		if (hasAnyRelationship) notePaths.add(file.path);
	}

	if (settings.requiredTags.length > 0) {
		for (const path of Array.from(notePaths)) {
			const f = app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) { notePaths.delete(path); continue; }
			const cache = app.metadataCache.getFileCache(f);
			if (!cache || !hasRequiredTag(cache, settings.requiredTags)) {
				notePaths.delete(path);
			}
		}
	}

	// Deduplicate edges first, filtering to valid path combinations
	const edges = dedupeEdges(rawEdges.filter(
		(e) => notePaths.has(e.source) && notePaths.has(e.target),
	));

	const nodes: GraphNode[] = [];
	for (const path of notePaths) {
		const f = app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) continue;
		const node = buildNode(app, f, settings);
		if (node) nodes.push(node);
	}

	const graph = { nodes, edges };
	if (cache) cache.set(settings, graph);
	return { graph, aliasMap };
}

/**
 * Build a graph centered on a single file, expanding outward by `depth` hops.
 * BFS over the full graph's edge set.
 *
 * Both nodes AND edges respect the hop limit. A node is included when it is
 * within `depth` hops of the center; an edge is included only when it can be
 * reached within `depth` hops — i.e. its nearer endpoint is strictly closer
 * than `depth`. Traversing an edge from a node N hops out is hop N+1, so an
 * edge between two nodes that are both exactly `depth` hops away is NOT shown:
 * at depth 1 you see the center and its own relationships (hub-and-spoke),
 * not the cross-links between the center's neighbors — those belong to depth 2.
 *
 * The full graph is fetched via the same cache as `buildFullGraph` — local-graph
 * calls from multiple embeds on the same page reuse one scan.
 */
export function buildLocalGraph(
	app: App,
	settings: RelationsSettings,
	centerPath: string,
	depth: number,
	cache: GraphCache | null = null,
): GraphBuildResult {
	const { graph: full, aliasMap } = buildFullGraph(app, settings, cache);
	if (!full.nodes.some((n) => n.id === centerPath)) {
		const f = app.vault.getAbstractFileByPath(centerPath);
		if (f instanceof TFile) {
			const node = buildNode(app, f, settings);
			return { graph: { nodes: node ? [node] : [], edges: [] }, aliasMap };
		}
		return { graph: { nodes: [], edges: [] }, aliasMap };
	}

	return { graph: localSubgraph(full, centerPath, depth), aliasMap };
}

/**
 * Filter a graph to the neighborhood within `depth` hops of centerPath.
 * Pure function — no app/vault access — for testability.
 *
 * See `buildLocalGraph` for the hop semantics: nodes at distance <= depth,
 * edges whose nearer endpoint is at distance < depth.
 */
export function localSubgraph(
	full: RelationsGraph,
	centerPath: string,
	depth: number,
): RelationsGraph {
	if (depth < 0) depth = 0;
	if (!full.nodes.some((n) => n.id === centerPath)) {
		return { nodes: [], edges: [] };
	}

	// adjacency map (undirected for traversal purposes — we want hops regardless of edge direction)
	const adj = new Map<string, Set<string>>();
	for (const e of full.edges) {
		if (!adj.has(e.source)) adj.set(e.source, new Set());
		if (!adj.has(e.target)) adj.set(e.target, new Set());
		adj.get(e.source)!.add(e.target);
		adj.get(e.target)!.add(e.source);
	}

	const visited = new Map<string, number>(); // path -> distance
	visited.set(centerPath, 0);
	let frontier: string[] = [centerPath];
	for (let d = 1; d <= depth; d++) {
		const next: string[] = [];
		for (const cur of frontier) {
			const neighbors = adj.get(cur);
			if (!neighbors) continue;
			for (const nb of neighbors) {
				if (visited.has(nb)) continue;
				visited.set(nb, d);
				next.push(nb);
			}
		}
		frontier = next;
		if (frontier.length === 0) break;
	}

	const includedPaths = new Set(visited.keys());
	const nodes = full.nodes.filter((n) => includedPaths.has(n.id));
	// An edge is reachable in `depth` hops only if its nearer endpoint is
	// closer than `depth` (crossing the edge is one more hop). This drops
	// cross-links between two outermost-ring nodes, so depth 1 renders as
	// hub-and-spoke instead of the full induced subgraph.
	const edges = full.edges.filter((e) => {
		const ds = visited.get(e.source);
		const dt = visited.get(e.target);
		if (ds === undefined || dt === undefined) return false;
		return Math.min(ds, dt) < depth;
	});

	return { nodes, edges };
}

/**
 * Filter a graph to only the connected component containing centerPath.
 * Pure function — no app/vault access — for testability.
 */
export function connectedComponent(
	graph: RelationsGraph,
	centerPath: string,
): RelationsGraph {
	if (!graph.nodes.some((n) => n.id === centerPath)) {
		return { nodes: [], edges: [] };
	}
	const adj = new Map<string, Set<string>>();
	for (const e of graph.edges) {
		if (!adj.has(e.source)) adj.set(e.source, new Set());
		if (!adj.has(e.target)) adj.set(e.target, new Set());
		adj.get(e.source)!.add(e.target);
		adj.get(e.target)!.add(e.source);
	}
	const visited = new Set<string>([centerPath]);
	const queue: string[] = [centerPath];
	while (queue.length > 0) {
		const cur = queue.shift()!;
		const neighbors = adj.get(cur);
		if (!neighbors) continue;
		for (const nb of neighbors) {
			if (visited.has(nb)) continue;
			visited.add(nb);
			queue.push(nb);
		}
	}
	return {
		nodes: graph.nodes.filter((n) => visited.has(n.id)),
		edges: graph.edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
	};
}

/**
 * Build a graph containing every note reachable from a focus note via any relationship edge.
 */
export function buildConnectedGraph(
	app: App,
	settings: RelationsSettings,
	centerPath: string,
	cache: GraphCache | null = null,
): GraphBuildResult {
	const { graph: full, aliasMap } = buildFullGraph(app, settings, cache);
	if (!full.nodes.some((n) => n.id === centerPath)) {
		const f = app.vault.getAbstractFileByPath(centerPath);
		if (f instanceof TFile) {
			const node = buildNode(app, f, settings);
			return { graph: { nodes: node ? [node] : [], edges: [] }, aliasMap };
		}
		return { graph: { nodes: [], edges: [] }, aliasMap };
	}
	const filtered = connectedComponent(full, centerPath);
	return { graph: filtered, aliasMap };
}

/**
 * Build a graph containing only the genealogy/partner neighbourhood of a focus note.
 */
export function buildFamilyNeighborhood(
	app: App,
	settings: RelationsSettings,
	focusPath: string,
	depth?: number,
	cache: GraphCache | null = null,
): GraphBuildResult {
	const { graph: full, aliasMap } = buildFullGraph(app, settings, cache);

	if (!full.nodes.some((n) => n.id === focusPath)) {
		const f = app.vault.getAbstractFileByPath(focusPath);
		if (f instanceof TFile) {
			const node = buildNode(app, f, settings);
			return { graph: { nodes: node ? [node] : [], edges: [] }, aliasMap };
		}
		return { graph: { nodes: [], edges: [] }, aliasMap };
	}

	const filtered = filterFamilyNeighborhood(full, focusPath, depth);
	return { graph: filtered, aliasMap };
}

export function filterFamilyNeighborhood(
	full: RelationsGraph,
	focusPath: string,
	depth?: number,
): RelationsGraph {
	if (!full.nodes.some((n) => n.id === focusPath)) {
		return { nodes: [], edges: [] };
	}

	const childrenOf = new Map<string, Set<string>>();
	const parentsOf = new Map<string, Set<string>>();
	const partnersOf = new Map<string, Set<string>>();

	for (const e of full.edges) {
		if (e.genealogy) {
			if (!parentsOf.has(e.source)) parentsOf.set(e.source, new Set());
			if (!childrenOf.has(e.target)) childrenOf.set(e.target, new Set());
			parentsOf.get(e.source)!.add(e.target);
			childrenOf.get(e.target)!.add(e.source);
		}
		if (e.pair) {
			if (!partnersOf.has(e.source)) partnersOf.set(e.source, new Set());
			if (!partnersOf.has(e.target)) partnersOf.set(e.target, new Set());
			partnersOf.get(e.source)!.add(e.target);
			partnersOf.get(e.target)!.add(e.source);
		}
	}

	const maxGen = (depth != null && depth >= 0) ? depth : Infinity;
	const included = new Set<string>([focusPath]);
	let ancestorFrontier: string[] = [focusPath];
	for (let gen = 0; gen < maxGen && ancestorFrontier.length > 0; gen++) {
		const next: string[] = [];
		for (const cur of ancestorFrontier) {
			const parents = parentsOf.get(cur);
			if (!parents) continue;
			for (const p of parents) {
				if (included.has(p)) continue;
				included.add(p);
				next.push(p);
			}
		}
		ancestorFrontier = next;
	}
	let descendantFrontier: string[] = [focusPath];
	for (let gen = 0; gen < maxGen && descendantFrontier.length > 0; gen++) {
		const next: string[] = [];
		for (const cur of descendantFrontier) {
			const children = childrenOf.get(cur);
			if (!children) continue;
			for (const c of children) {
				if (included.has(c)) continue;
				included.add(c);
				next.push(c);
			}
		}
		descendantFrontier = next;
	}

	const focusFamily = new Set(included);
	for (const personId of focusFamily) {
		const kids = childrenOf.get(personId);
		if (!kids) continue;
		for (const kid of kids) {
			const kidParents = parentsOf.get(kid);
			if (!kidParents) continue;
			for (const coParent of kidParents) {
				included.add(coParent);
			}
		}
	}

	for (const personId of [...included]) {
		const partners = partnersOf.get(personId);
		if (!partners) continue;
		for (const p of partners) included.add(p);
	}

	const nodes = full.nodes.filter((n) => included.has(n.id));
	const edges = full.edges.filter(
		(e) => (e.genealogy || e.pair) && included.has(e.source) && included.has(e.target),
	);

	return { nodes, edges };
}

function buildTypeMap(settings: RelationsSettings): Map<string, RelationshipType> {
	const m = new Map<string, RelationshipType>();
	for (const t of settings.relationshipTypes) m.set(t.name.toLowerCase(), t);
	return m;
}

function buildNode(
	app: App,
	file: TFile,
	settings: RelationsSettings,
): GraphNode | null {
	const cache = app.metadataCache.getFileCache(file);
	const tags = cache ? (getAllTags(cache) ?? []) : [];
	const image = resolveImage(app, file, settings, cache);
	const fm = cache?.frontmatter;
	const ringColor = resolveRingColor(settings, fm);
	const topLeftIcon = resolveFrontmatterString(fm, settings.topLeftIconProperty);
	const topRightIcon = resolveFrontmatterString(fm, settings.topRightIconProperty);
	const bottomLeftIcon = resolveFrontmatterString(fm, settings.bottomLeftIconProperty);
	const bottomRightIcon = resolveFrontmatterString(fm, settings.bottomRightIconProperty);
	const subtext = resolveFrontmatterString(fm, settings.subtextProperty);
	const node: GraphNode = {
		id: file.path,
		label: file.basename,
		tags,
		image,
	};
	if (ringColor) node.ringColor = ringColor;
	if (topLeftIcon) node.topLeftIcon = topLeftIcon;
	if (topRightIcon) node.topRightIcon = topRightIcon;
	if (bottomLeftIcon) node.bottomLeftIcon = bottomLeftIcon;
	if (bottomRightIcon) node.bottomRightIcon = bottomRightIcon;
	if (subtext) node.subtext = subtext;
	return node;
}

export function resolveFrontmatterString(
	frontmatter: Record<string, unknown> | undefined,
	propertyName: string,
): string | undefined {
	const prop = propertyName?.trim();
	if (!prop) return undefined;
	if (!frontmatter) return undefined;
	const raw: unknown = frontmatter[prop];
	if (raw == null) return undefined;
	const first: unknown = Array.isArray(raw) ? raw[0] : raw;
	if (first == null) return undefined;
	const value = String(first).trim();
	if (!value) return undefined;
	return value;
}

export function resolveRingColor(
	settings: RelationsSettings,
	frontmatter: Record<string, unknown> | undefined,
): string | undefined {
	const prop = settings.ringColorProperty?.trim();
	if (!prop) return undefined;
	if (!settings.ringColorRules || settings.ringColorRules.length === 0) return undefined;
	if (!frontmatter) return undefined;
	const raw: unknown = frontmatter[prop];
	if (raw == null) return undefined;
	const first: unknown = Array.isArray(raw) ? raw[0] : raw;
	if (first == null) return undefined;
	const value = String(first).trim();
	if (!value) return undefined;
	for (const rule of settings.ringColorRules) {
		if (rule.value.trim() === value) {
			const c = rule.color?.trim();
			if (c) return c;
		}
	}
	return undefined;
}

function resolveImage(
	app: App,
	file: TFile,
	settings: RelationsSettings,
	cache: CachedMetadata | null,
): string | null {
	const fm = cache?.frontmatter;
	if (!fm) return null;
	const raw: unknown = fm[settings.imageProperty];
	if (raw == null) return null;

	const value: unknown = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (!v) return null;

	if (/^(https?:|data:)/i.test(v)) return v;

	const wikiMatch = v.match(/^\[\[([^\]]+)\]\]$/);
	const linkPath = wikiMatch ? stripAlias(wikiMatch[1]) : v;

	const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
	if (resolved instanceof TFile) {
		return app.vault.getResourcePath(resolved);
	}

	const direct = app.vault.getAbstractFileByPath(normalizePath(linkPath));
	if (direct instanceof TFile) {
		return app.vault.getResourcePath(direct);
	}

	return null;
}

function inScope(file: TFile, settings: RelationsSettings): boolean {
	if (settings.folderScopes.length === 0) return true;
	return settings.folderScopes.some((folder) => {
		const normalized = folder.endsWith("/") ? folder : folder + "/";
		return file.path.startsWith(normalized) || file.path === folder;
	});
}

function hasRequiredTag(cache: CachedMetadata, requiredTags: string[]): boolean {
	const tags = getAllTags(cache) ?? [];
	const normalized = tags.map((t) => t.replace(/^#/, "").toLowerCase());
	return requiredTags.some((req) => {
		const r = req.replace(/^#/, "").toLowerCase();
		return normalized.includes(r);
	});
}

export function extractLinkTargets(value: unknown): string[] {
	const parsed = extractParsedLinks(value);
	return parsed.map((p) => {
		// Return the target name with preserved case, not the alias
		// For "[[Arthur]]", displayName is "Arthur" → return "Arthur"
		// For "[[Arthur|King]]", baseName is "Arthur" → return "Arthur"
		return p.baseName || p.displayName;
	});
}

export function stripAlias(link: string): string {
	const pipeIdx = link.indexOf("|");
	if (pipeIdx >= 0) link = link.slice(0, pipeIdx);
	const hashIdx = link.indexOf("#");
	if (hashIdx >= 0) link = link.slice(0, hashIdx);
	return link.trim();
}

export function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
	const seen = new Set<string>();
	const out: GraphEdge[] = [];
	for (const e of edges) {
		let key: string;
		if (e.genealogy) {
			// A parent-child bond is one fact no matter how many notes declare
			// it or under which genealogy type name. After declares-child
			// normalization, "Varinka declares `parents: [[Amalayin]]`" and
			// "Amalayin declares `children: [[Varinka]]`" both arrive here as
			// Varinka→Amalayin — but with different type names, which the
			// per-type keys below would keep as two parallel edges (issue #21).
			// Key genealogy edges on the directed pair alone; first wins.
			key = `gen|${e.source}|${e.target}`;
		} else if (e.symmetric) {
			const [a, b] = [e.source, e.target].sort();
			key = `sym|${e.type}|${a}|${b}`;
		} else {
			key = `dir|${e.type}|${e.source}|${e.target}`;
		}
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out;
}