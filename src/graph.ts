import { App, TFile, CachedMetadata, getAllTags, normalizePath } from "obsidian";
import {
	RelationsGraph,
	GraphNode,
	GraphEdge,
	RelationsSettings,
	RelationshipType,
} from "./types";

/**
 * Build the full relationship graph by scanning every markdown file in scope.
 */
export function buildFullGraph(
	app: App,
	settings: RelationsSettings,
): RelationsGraph {
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

	return { nodes, edges };
}

/**
 * Build a graph centered on a single file, expanding outward by `depth` hops.
 * BFS over the full graph's edge set.
 */
export function buildLocalGraph(
	app: App,
	settings: RelationsSettings,
	centerPath: string,
	depth: number,
): RelationsGraph {
	const full = buildFullGraph(app, settings);
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

// ---------- helpers ----------

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

function extractLinkTargets(value: unknown): string[] {
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

function stripAlias(link: string): string {
	const pipeIdx = link.indexOf("|");
	if (pipeIdx >= 0) link = link.slice(0, pipeIdx);
	const hashIdx = link.indexOf("#");
	if (hashIdx >= 0) link = link.slice(0, hashIdx);
	return link.trim();
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
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
