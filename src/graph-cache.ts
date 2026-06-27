import { RelationsGraph, RelationsSettings } from "./types";

/**
 * Caches the result of buildFullGraph between calls so that:
 *  - multiple embedded code blocks on the same page reuse one scan
 *  - the side-panel view doesn't rescan the vault on every depth/mode toggle
 *  - buildLocalGraph (which calls buildFullGraph internally) becomes cheap to call repeatedly
 *
 * The cache is invalidated on:
 *  - any vault file change picked up by metadataCache (frontmatter edits, file
 *    creation/deletion/rename) — the plugin's main.ts wires `invalidate()` to
 *    the same event handlers it uses to refresh views
 *  - any settings change that affects graph construction — detected via a hash
 *    of the structurally relevant subset of settings (types, scopes, tags, image
 *    property). Cosmetic-only settings like showLegend or layout don't bust it.
 *
 * Holding a cached graph is safe because:
 *  - it's plain data (no DOM refs), so it doesn't leak Cytoscape instances
 *  - it's a single ~few-hundred-KB object even for vaults with thousands of
 *    notes, comparable to a single open document
 */
export class GraphCache {
	private cached: RelationsGraph | null = null;
	private cachedHash: string | null = null;

	/**
	 * Returns the cached graph if the structural hash matches, else null.
	 * Caller is expected to rebuild and store via `set` on miss.
	 */
	get(settings: RelationsSettings): RelationsGraph | null {
		const hash = hashSettings(settings);
		if (this.cached && this.cachedHash === hash) return this.cached;
		return null;
	}

	set(settings: RelationsSettings, graph: RelationsGraph): void {
		this.cached = graph;
		this.cachedHash = hashSettings(settings);
	}

	/** Drop the cache. Call when files change. */
	invalidate(): void {
		this.cached = null;
		this.cachedHash = null;
	}
}

/**
 * Hash the structurally-relevant subset of settings — anything that affects which
 * notes/edges end up in the graph. Cosmetic settings (legend visibility, layout
 * algorithm) are deliberately excluded so a legend toggle doesn't force a full
 * vault rescan.
 *
 * JSON.stringify is good enough here — these values are all plain objects/strings/
 * booleans and the cost is small relative to the rescan it avoids.
 */
function hashSettings(s: RelationsSettings): string {
	return JSON.stringify({
		types: s.relationshipTypes.map((t) => ({
			n: t.name,
			s: t.symmetric,
			p: t.pair,
			t: t.treeLayout,
			g: t.genealogy,
			// color and lineStyle are cosmetic — they don't affect what edges exist,
			// only how they're drawn. Excluding them means recolouring a type doesn't
			// trigger a vault rescan.
		})),
		image: s.imageProperty,
		folders: s.folderScopes,
		tags: s.requiredTags,
		// Ring color settings DO affect node content (each node's ringColor field is
		// baked at build time), so changes to the property name or rules must
		// invalidate the cache. The color values themselves matter here unlike
		// relationshipTypes.color: there's no separate stylesheet path that reads
		// the rules at render time, so a color edit needs a rebuild.
		ringProp: s.ringColorProperty,
		ringRules: s.ringColorRules,
		// Badge property names directly affect each node's content (badge
		// strings are baked into nodes during buildNode), so changes here
		// must invalidate. The badge content per-node isn't in the hash
		// because it derives from frontmatter — file-change events already
		// invalidate the cache when frontmatter changes.
		tlIcon: s.topLeftIconProperty,
		trIcon: s.topRightIconProperty,
		blIcon: s.bottomLeftIconProperty,
		brIcon: s.bottomRightIconProperty,
		subtext: s.subtextProperty,
	});
}
