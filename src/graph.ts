import { App, TFile, CachedMetadata, getAllTags, normalizePath } from "obsidian";
import {
	RelationsGraph,
	GraphNode,
	GraphEdge,
	RelationsSettings,
	RelationshipType,
} from "./types";
import { GraphCache } from "./graph-cache";

/**
 * Build the full relationship graph by scanning every markdown file in scope.
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
): RelationsGraph {
	if (cache) {
		const hit = cache.get(settings);
		if (hit) return hit;
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

		for (const key of Object.keys(fm)) {
			const type = typeMap.get(key.toLowerCase());
			if (!type) continue;

			const targets = extractLinkTargets(fm[key]);
			for (const target of targets) {
				const resolved = app.metadataCache.getFirstLinkpathDest(target, file.path);
				if (!resolved) continue;
				if (resolved.path === file.path) continue;
				if (!inScope(resolved, settings)) continue;

				rawEdges.push({
					source: file.path,
					target: resolved.path,
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

	const nodes: GraphNode[] = [];
	for (const path of notePaths) {
		const f = app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) continue;
		const node = buildNode(app, f, settings);
		if (node) nodes.push(node);
	}

	const edges = dedupeEdges(rawEdges.filter(
		(e) => notePaths.has(e.source) && notePaths.has(e.target),
	));

	const result = { nodes, edges };
	if (cache) cache.set(settings, result);
	return result;
}

/**
 * Build a graph centered on a single file, expanding outward by `depth` hops.
 * BFS over the full graph's edge set.
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
): RelationsGraph {
	const full = buildFullGraph(app, settings, cache);
	if (depth < 0) depth = 0;
	if (!full.nodes.some((n) => n.id === centerPath)) {
		// Center note isn't connected — return just it (if it exists) so the view can show "no relationships yet"
		const f = app.vault.getAbstractFileByPath(centerPath);
		if (f instanceof TFile) {
			const node = buildNode(app, f, settings);
			return { nodes: node ? [node] : [], edges: [] };
		}
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
	const edges = full.edges.filter(
		(e) => includedPaths.has(e.source) && includedPaths.has(e.target),
	);

	return { nodes, edges };
}

/**
 * Build a graph containing only the genealogy/partner neighbourhood of a focus
 * note: ancestors (transitively up the parent chain), descendants (transitively
 * down through children of children), and partners of anyone in that set.
 *
 * Used by family-graph mode. Without this, family-graph would show every
 * connected person in the vault — fine for "show me the whole dynasty" but
 * overwhelming when the user is looking at one character and just wants to see
 * who's their parent, who's their kid, and who their partners are.
 *
 * Allies, enemies, mentors etc. are dropped — those don't contribute to the
 * who-had-children-with-whom view that family-graph is for.
 */
export function buildFamilyNeighborhood(
	app: App,
	settings: RelationsSettings,
	focusPath: string,
	cache: GraphCache | null = null,
): RelationsGraph {
	const full = buildFullGraph(app, settings, cache);

	// If the focus note doesn't appear in the graph at all, return just it.
	if (!full.nodes.some((n) => n.id === focusPath)) {
		const f = app.vault.getAbstractFileByPath(focusPath);
		if (f instanceof TFile) {
			const node = buildNode(app, f, settings);
			return { nodes: node ? [node] : [], edges: [] };
		}
		return { nodes: [], edges: [] };
	}

	// Build genealogy adjacency in both directions:
	//   childrenOf[parent] = list of children declared with that parent
	//   parentsOf[child]   = list of parents
	// Conventionally, our edges go child->parent (the child note declares its
	// parents), so genealogy edge.source = child, edge.target = parent.
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

	// Walk ancestors up.
	const included = new Set<string>([focusPath]);
	const ancestorQueue = [focusPath];
	while (ancestorQueue.length > 0) {
		const cur = ancestorQueue.shift()!;
		const parents = parentsOf.get(cur);
		if (!parents) continue;
		for (const p of parents) {
			if (included.has(p)) continue;
			included.add(p);
			ancestorQueue.push(p);
		}
	}
	// Walk descendants down.
	const descendantQueue = [focusPath];
	while (descendantQueue.length > 0) {
		const cur = descendantQueue.shift()!;
		const children = childrenOf.get(cur);
		if (!children) continue;
		for (const c of children) {
			if (included.has(c)) continue;
			included.add(c);
			descendantQueue.push(c);
		}
	}

	// Pull in co-parents — anyone who shares a child with someone we've already
	// included. This catches partners that aren't ancestors/descendants of the
	// focus, e.g. Arthur's partner Morgause when the focus is Arthur (Morgause
	// isn't anyone's ancestor in Arthur's line, but she's the mother of his
	// child and so should appear).
	const focusFamily = new Set(included);  // snapshot before adding co-parents
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

	// Pull in declared partners (pair edges) of anyone in the family — covers
	// childless marriages like Arthur+Guinevere.
	for (const personId of [...included]) {
		const partners = partnersOf.get(personId);
		if (!partners) continue;
		for (const p of partners) included.add(p);
	}

	const nodes = full.nodes.filter((n) => included.has(n.id));
	// Only keep genealogy + pair edges, and only those whose endpoints are both
	// in the neighbourhood. Other relationship types (ally, enemy, etc.) are
	// dropped — family-graph mode doesn't show them.
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
	return {
		id: file.path,
		label: file.basename,
		tags,
		image,
	};
}

/**
 * Resolve the portrait image for a node.
 * Accepts:
 *   - "[[portrait.png]]"   wikilink to a vault image
 *   - "portrait.png"       vault path (relative or absolute)
 *   - "https://..."        external URL
 *   - "data:image/..."     data URL
 * Returns a resource URL Cytoscape can load, or null.
 */
function resolveImage(
	app: App,
	file: TFile,
	settings: RelationsSettings,
	cache: CachedMetadata | null,
): string | null {
	const fm = cache?.frontmatter;
	if (!fm) return null;
	const raw = fm[settings.imageProperty];
	if (raw == null) return null;

	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (!v) return null;

	// External URL or data URL — pass through
	if (/^(https?:|data:)/i.test(v)) return v;

	// Wikilink form: [[file.png]] or [[file.png|alt]]
	const wikiMatch = v.match(/^\[\[([^\]]+)\]\]$/);
	const linkPath = wikiMatch ? stripAlias(wikiMatch[1]) : v;

	// Resolve via Obsidian's link resolver (handles relative paths)
	const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
	if (resolved instanceof TFile) {
		return app.vault.getResourcePath(resolved);
	}

	// Fallback: try as a literal vault path
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
	if (value == null) return [];
	if (Array.isArray(value)) {
		return value.flatMap((v) => extractLinkTargets(v));
	}
	if (typeof value !== "string") return [];

	const s = value.trim();
	if (!s) return [];

	const wikiRegex = /\[\[([^\]]+)\]\]/g;
	const matches = [...s.matchAll(wikiRegex)];
	if (matches.length > 0) {
		return matches.map((m) => stripAlias(m[1]));
	}

	if (s.includes(",")) {
		return s.split(",").map((part) => stripAlias(part.trim())).filter(Boolean);
	}

	return [stripAlias(s)];
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
		if (e.symmetric) {
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
