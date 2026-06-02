import { App, MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile, setIcon, Notice } from "obsidian";
import { Core } from "cytoscape";
import { RelationsSettings, PositionStore, LockedLayout, EdgeLabelStore } from "./types";
import { buildFullGraph, buildLocalGraph, buildFamilyNeighborhood } from "./graph";
import { renderGraph, hasInformalPartnership, INFORMAL_PARTNERSHIP_LEGEND } from "./render";
import type { GraphCache } from "./graph-cache";

export type EmbedSize = "mini" | "small" | "large";

interface CodeBlockOptions {
	size: EmbedSize;
	depth: number;
	center?: string;
	scope?: "local" | "full";
	tree?: boolean;
	familyTree?: boolean;   // classical chart view: generation-aligned positioning +
	                        // orthogonal SVG connectors (right-angle drops, sibling bars,
	                        // dashed bars for co-parents without declared marriage).
	                        // Spouse-lockstep drag enabled.
	familyGraph?: boolean;  // graph-style family view: generation-aligned positioning +
	                        // Cytoscape edges differentiated by relationship type
	                        // (marriage solid, informal partnership dotted, parent→child
	                        // arrowed). If BOTH family-tree and family-graph are set,
	                        // family-tree wins.
	zoom?: number;
	height?: string;          // overrides the size's default height; e.g. "800px", "60vh"
	labels?: boolean;         // show note name under each node; overrides the global
	                          // showNodeLabels setting for this block only
	spacing?: number;         // family node spacing multiplier (both modes). <1 tightens
	                          // (shorter edges, larger nodes after fit), >1 loosens.
	id?: string;              // stable identifier for this block. Required to lock node
	                          // positions — positions are saved in plugin data keyed by this.
}

const DEFAULTS: CodeBlockOptions = {
	size: "small",
	depth: 1,
	scope: "local",
};

/**
 * MarkdownRenderChild lets Obsidian manage lifecycle — onunload runs when the rendered
 * block is removed (note closed, switched to edit mode, etc.) so we can dispose Cytoscape.
 */
/**
 * Stores the code block needs from the plugin. Both halves come from the same
 * plugin instance (`RelationsPlugin` implements both interfaces), but passing
 * them as a single object keeps the constructor and processor signature stable
 * if we add more stores later.
 */
export interface BlockStores {
	positions: PositionStore;
	labels: EdgeLabelStore;
}

class RelationsBlockChild extends MarkdownRenderChild {
	private cy: Core | null = null;
	private locked = false;
	constructor(
		containerEl: HTMLElement,
		private app: App,
		private settings: RelationsSettings,
		private options: ParsedOptions,
		private ctx: MarkdownPostProcessorContext,
		private cache: GraphCache | null,
		private stores: BlockStores | null,
	) {
		super(containerEl);
	}

	/** Convenience: the note path this block lives in. */
	private get sourcePath(): string {
		return this.ctx.sourcePath;
	}

	onload(): void {
		this.render();
	}

	onunload(): void {
		this.cy?.destroy();
		this.cy = null;
	}

	private render(): void {
		const el = this.containerEl;
		// Tear down any previous Cytoscape instance before wiping the DOM — re-render
		// (e.g. on unlock) would otherwise leak the old instance and its listeners.
		this.cy?.destroy();
		this.cy = null;
		el.empty();

		// Auto-detect: any callout ancestor (ITS infobox, plain callouts, fas-infobox, etc.)
		// gets the compact rendering treatment. The user can still override by explicitly
		// setting size: small or size: large, but if they didn't set a size at all and
		// the block is inside a callout, we promote them to mini.
		const insideCallout = isInsideCallout(el);
		let effectiveSize = this.options.size;
		if (insideCallout && !this.options.sizeExplicit) {
			effectiveSize = "mini";
		}

		// In mini mode, depth is always 1 — the canvas isn't big enough to show more
		// usefully, and the user explicitly asked for "direct neighbors only".
		const effectiveDepth = effectiveSize === "mini" ? 1 : this.options.depth;

		el.addClass("relations-embed");
		el.addClass(`is-${effectiveSize}`);
		if (insideCallout) el.addClass("in-callout");

		// Custom height overrides the size class. Both `height` and `min-height` get
		// set so the size class's min-height (which would otherwise enforce a floor
		// taller than what the user asked for) doesn't override us.
		if (this.options.height) {
			el.style.height = this.options.height;
			el.style.minHeight = this.options.height;
		}

		const canvas = el.createDiv({ cls: "relations-embed-canvas" });

		const hostPath = this.options.center ?? this.sourcePath;
		const hostFile = resolveHostFile(this.app, hostPath, this.sourcePath);

		let graph;
		let highlightId: string | undefined;

		// Either family mode focuses on the host note specifically — same logic as
		// the side-panel view: ignore scope/depth, build the host's family
		// neighbourhood. `scope: full` still works as an opt-out for users who
		// want the entire vault's family in one block.
		const isFamilyView = !!(this.options.familyTree || this.options.familyGraph);
		const useFamilyNeighbourhood = isFamilyView && this.options.scope !== "full";

		if (useFamilyNeighbourhood) {
			if (!hostFile) {
				canvas.createDiv({ cls: "relations-empty", text: "Could not resolve host note for family view." });
				return;
			}
			graph = buildFamilyNeighborhood(this.app, this.settings, hostFile.path, this.cache);
			highlightId = hostFile.path;
		} else if (this.options.scope === "full") {
			graph = buildFullGraph(this.app, this.settings, this.cache);
		} else {
			if (!hostFile) {
				canvas.createDiv({ cls: "relations-empty", text: "Could not resolve host note for local graph." });
				return;
			}
			graph = buildLocalGraph(this.app, this.settings, hostFile.path, effectiveDepth, this.cache);
			highlightId = hostFile.path;
		}

		if (graph.nodes.length === 0) {
			canvas.createDiv({
				cls: "relations-empty",
				text: this.options.scope === "full"
					? "No connected notes found in vault."
					: "No relationships within the chosen depth.",
			});
			return;
		}

		// Locked-layout restore. If this block has an `id` and a saved locked layout,
		// load the positions and tell the renderer to use them as a preset (skipping
		// the auto-layout). The lock button (added below) lets the user toggle this.
		const saved = this.options.id && this.stores?.positions ? this.stores?.positions.get(this.options.id) : null;
		this.locked = !!(saved && saved.locked);
		const presetPositions = this.locked && saved ? saved.positions : undefined;

		this.cy = renderGraph({
			app: this.app,
			settings: this.settings,
			container: canvas,
			graph,
			highlightId,
			useTreeLayout: this.options.tree,
			familyTree: this.options.familyTree,
			familyGraph: this.options.familyGraph,
			compact: effectiveSize === "mini",
			zoomMultiplier: this.options.zoom,
			showLabels: this.options.labels,
			spacing: this.options.spacing,
			presetPositions,
			labelStore: this.stores?.labels ?? null,
			// Don't allow editing labels in mini embeds — no room for the editor,
			// and double-click in tiny graphs is more likely to be an accident.
			editableLabels: effectiveSize !== "mini",
		});

		// Lock control — only shown when not in mini mode (no room in an infobox)
		// and when the block has an id (positions can't be keyed without one). The
		// button lives in the corner of the embed and toggles locked state.
		if (effectiveSize !== "mini") {
			this.addLockControl(el);
		}

		// Legend — every size except mini, and only when settings.showLegend is on.
		// We only show entries for types that actually appear in the rendered graph,
		// so a graph with two relationship types doesn't display nine swatches.
		//
		// In either family mode, the renderer synthesises an "informal partnership"
		// edge between any two people who share a child but have no declared
		// marriage. That edge has a synthetic type that's not in settings, so the
		// filter above would drop it. We append the legend pseudo-type explicitly
		// when the graph contains at least one such pair, so the legend strip
		// names what the user is actually seeing on the canvas.
		if (effectiveSize !== "mini" && this.settings.showLegend) {
			const usedTypes = new Set(graph.edges.map((e) => e.type));
			const visibleTypes = this.settings.relationshipTypes.filter((t) => usedTypes.has(t.name));
			const isFamilyView = !!(this.options.familyTree || this.options.familyGraph);
			if (isFamilyView && hasInformalPartnership(graph)) {
				visibleTypes.push(INFORMAL_PARTNERSHIP_LEGEND);
			}
			if (visibleTypes.length > 0) {
				const legend = el.createDiv({ cls: "relations-legend" });
				renderLegend(legend, visibleTypes);
			}
		}
	}

	/**
	 * Ensure this block has an `id`, generating and writing one into the note's
	 * code-block source if it's missing. Returns the id, or null if we couldn't
	 * locate/modify the block.
	 *
	 * We edit the note (rather than only storing the id in plugin data) so the id
	 * is visible and portable — it travels with the note if synced or shared, and
	 * the user can see why their layout is pinned. The id is inserted as a new
	 * `id:` line just inside the code fence.
	 */
	private async ensureBlockId(): Promise<string | null> {
		if (this.options.id) return this.options.id;

		// Locate the block in the source note. getSectionInfo gives us the line
		// range of the rendered element within its file.
		const section = this.ctx.getSectionInfo(this.containerEl);
		if (!section) return null;

		const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return null;

		const id = generateBlockId();

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		// section.lineStart is the fence line (```relations). section.lineEnd is the
		// closing fence. We insert the id line right after the opening fence so it
		// sits with the other options.
		const fenceLine = section.lineStart;
		if (fenceLine < 0 || fenceLine >= lines.length) return null;

		// Detect any callout/blockquote prefix on the fence line (e.g. "> " for a
		// block inside a callout) so we can mirror it on the inserted id line and
		// keep the markdown valid.
		const fenceText = lines[fenceLine];
		const prefixMatch = fenceText.match(/^(\s*(?:>\s?)*)/);
		const prefix = prefixMatch ? prefixMatch[1] : "";
		const fenceBody = fenceText.slice(prefix.length);

		// Guard: make sure the fence line actually looks like our block's opening
		// fence before editing, so we never corrupt an unexpected location.
		if (!/^`{3,}.*\brelations\b/.test(fenceBody) && !/^`{3,}\s*npc-graph\b/.test(fenceBody)) {
			return null;
		}
		lines.splice(fenceLine + 1, 0, `${prefix}id: ${id}`);
		await this.app.vault.modify(file, lines.join("\n"));

		// Reflect it locally so subsequent saves in this session use the same id
		// even before the note re-renders.
		this.options.id = id;
		return id;
	}

	/**
	 * Add the lock controls to the embed corner.
	 *
	 * Two actions:
	 *  - **Lock / Save** (primary button): snapshots the current node positions and
	 *    saves them to plugin data (keyed by the block's `id`). When unlocked this
	 *    locks the layout; when already locked it re-saves — so you can drag a few
	 *    nodes and press it again to capture the new arrangement WITHOUT resetting
	 *    everything else. No full re-render, no auto-layout, no flicker.
	 *  - **Reset** (secondary button, only shown when locked): clears the saved
	 *    positions and re-renders with the automatic layout.
	 *
	 * Dragging is always available — nodes are grabbable whether locked or not. The
	 * difference locking makes is whether those positions persist across refreshes.
	 *
	 * If the block has no `id`, the first lock auto-generates one and writes it into
	 * the code block so the layout can be keyed reliably.
	 */
	private addLockControl(el: HTMLElement): void {
		const group = el.createDiv({ cls: "relations-lock-group" });

		// Primary button — lock (when unlocked) or save updates (when locked).
		const lockBtn = group.createEl("button", { cls: "relations-lock-btn" });
		// Secondary button — reset to auto-layout. Only meaningful when locked.
		const resetBtn = group.createEl("button", { cls: "relations-lock-btn relations-reset-btn" });
		setIcon(resetBtn, "rotate-ccw");
		resetBtn.setAttribute("aria-label", "Reset to automatic layout");

		const syncButtons = () => {
			lockBtn.toggleClass("is-locked", this.locked);
			setIcon(lockBtn, this.locked ? "save" : "lock");
			lockBtn.setAttribute(
				"aria-label",
				this.locked ? "Save current positions" : "Lock layout in place",
			);
			// Reset only applies once something is locked. The is-locked class keeps
			// it visible (not just on hover) alongside the save button; is-hidden
			// removes it entirely when unlocked.
			resetBtn.toggleClass("is-hidden", !this.locked);
			resetBtn.toggleClass("is-locked", this.locked);
		};
		syncButtons();

		// Snapshot current node positions into the store under this block's id.
		// If the block has no id yet, generate one and write it into the code block
		// source first (so the id is visible and portable in the note). Returns a
		// result describing what happened, or null if we genuinely can't proceed.
		const saveCurrentPositions = async (): Promise<{ autoAddedId: boolean } | null> => {
			if (!this.stores?.positions || !this.cy) return null;

			let blockId: string | null | undefined = this.options.id;
			let autoAddedId = false;
			if (!blockId) {
				blockId = await this.ensureBlockId();
				if (!blockId) {
					new Notice(
						"Couldn't auto-add an id to this code block. Add one manually to lock it:\n\n```relations\nid: my-graph\n```",
						9000,
					);
					return null;
				}
				autoAddedId = true;
			}

			const positions: Record<string, { x: number; y: number }> = {};
			this.cy.nodes().forEach((n) => {
				const p = n.position();
				positions[n.id()] = { x: p.x, y: p.y };
			});
			const layout: LockedLayout = { locked: true, positions };
			await this.stores?.positions.set(blockId, layout);
			return { autoAddedId };
		};

		lockBtn.addEventListener("click", async () => {
			const wasLocked = this.locked;
			const result = await saveCurrentPositions();
			if (!result) return;
			// Saving while unlocked transitions to locked; saving while already
			// locked just updates the stored positions in place. Either way we do
			// NOT re-render here — the nodes are already where the user dragged them.
			// (Note: if an id was auto-added, writing it to the note triggers a
			// re-render anyway, which comes up locked with these saved positions.)
			this.locked = true;
			syncButtons();
			if (result.autoAddedId) {
				new Notice("Layout locked. Added an id to the code block so it persists across refreshes.");
			} else {
				new Notice(wasLocked ? "Layout updated." : "Layout locked. Positions will persist across refreshes.");
			}
		});

		resetBtn.addEventListener("click", async () => {
			if (!this.stores?.positions || !this.options.id) return;
			await this.stores?.positions.clear(this.options.id);
			this.locked = false;
			// Reset genuinely returns to auto-layout, so a full re-render is wanted.
			this.render();
			new Notice("Layout reset — back to automatic layout.");
		});
	}
}

/**
 * Build a legend strip of relationship types into `host`. Used by both code blocks
 * and the side-panel view (re-exported for view.ts to consume).
 */
/**
 * Render a legend listing relationship types with their color swatches and flags.
 * Writes legend items as children of `host`. The caller is responsible for any
 * outer container styling (e.g. `host.toggleClass("is-hidden", …)`).
 *
 * If `clear` is true, the host is emptied first — useful for re-rendering when
 * settings change. Code-block usage typically passes `false` because the host
 * is freshly created.
 */
export function renderLegend(
	host: HTMLElement,
	types: import("./types").RelationshipType[],
	clear = false,
): void {
	if (clear) host.empty();
	for (const t of types) {
		const item = host.createDiv({ cls: "relations-legend-item" });
		const swatch = item.createSpan({ cls: `relations-legend-swatch is-${t.lineStyle}` });
		// For dashed/dotted/double swatches, the visual is built with borders and
		// pseudo-elements in CSS — the color comes from a CSS custom property so a
		// single rule can reference it for foreground/background.
		swatch.style.setProperty("--swatch-color", t.color);
		let label = t.name;
		if (!t.symmetric) label += " →";
		if (t.pair) label += " ⚭";
		if (t.treeLayout) label += " ⊥";
		item.createSpan({ text: label });
	}
}

/**
 * Walk up the DOM looking for a callout ancestor. Obsidian wraps callouts in
 *   <div class="callout" data-callout="infobox">…</div>
 * and ITS / fas-infobox both use this same wrapper class. Other 3rd-party callouts
 * also use it, so this catches every callout-style host the plugin might land in.
 */
function isInsideCallout(el: HTMLElement): boolean {
	// Element.closest matches the receiver too, but the embed div itself is never
	// the callout — it's a child of one if anything — so this is fine.
	return el.closest(".callout") !== null;
}

/**
 * Generate a short, reasonably-unique block id like `rel-7f3a9c2b`. Used when a
 * user locks a block that doesn't have an id yet. Not cryptographic — just needs
 * to avoid collisions within a vault, which 8 hex chars (~4 billion values)
 * comfortably does for hand-authored notes.
 */
function generateBlockId(): string {
	const rand = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
	return `rel-${rand}`;
}

export function processRelationsBlock(
	app: App,
	settings: RelationsSettings,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	cache: GraphCache | null = null,
	stores: BlockStores | null = null,
): void {
	const options = parseOptions(source);
	const child = new RelationsBlockChild(el, app, settings, options, ctx, cache, stores);
	ctx.addChild(child);
}

interface ParsedOptions extends CodeBlockOptions {
	sizeExplicit: boolean;
}

function parseOptions(source: string): ParsedOptions {
	let parsed: Record<string, unknown> = {};
	try {
		const raw = parseYaml(source);
		if (raw && typeof raw === "object") {
			parsed = raw as Record<string, unknown>;
		}
	} catch {
		// Allow malformed/empty blocks
	}

	const rawSize = parsed["size"];
	const sizeExplicit =
		rawSize === "mini" || rawSize === "small" || rawSize === "large";
	const size: EmbedSize = sizeExplicit ? (rawSize as EmbedSize) : "small";

	let depth = parsed["depth"] as number | undefined;
	if (typeof depth !== "number" || isNaN(depth)) {
		depth = size === "large" ? 3 : 1;
	}
	depth = Math.max(0, Math.min(6, Math.floor(depth)));

	const scope = parsed["scope"] === "full" ? "full" : "local";
	const tree = parsed["tree"] === true;
	// Family modes — both opt-in via kebab- or camelCase. If a user sets both,
	// family-tree (the classical orthogonal chart) wins over family-graph (the
	// curved graph-style view): we leave the value of the loser untouched here,
	// but the renderer treats familyTree as overriding familyGraph downstream.
	const familyTreeRaw = parsed["family-tree"] === true || parsed["familyTree"] === true;
	const familyGraphRaw = parsed["family-graph"] === true || parsed["familyGraph"] === true;
	const familyTree = familyTreeRaw;
	const familyGraph = familyGraphRaw && !familyTreeRaw;
	const center = typeof parsed["center"] === "string" ? (parsed["center"] as string) : undefined;

	// labels: explicit true/false hides or shows note names for this block,
	// overriding the global setting. Undefined = inherit the setting.
	const labels = typeof parsed["labels"] === "boolean" ? (parsed["labels"] as boolean) : undefined;
	// id: a stable identifier used to key saved (locked) positions. Trimmed; empty
	// strings are treated as absent.
	const idRaw = parsed["id"];
	const id = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim()
		: (typeof idRaw === "number" ? String(idRaw) : undefined);

	// spacing: a multiplier on family-graph node spacing. Accept a number; clamp
	// to the same range the layout enforces so the parsed value matches behaviour.
	let spacing: number | undefined;
	const rawSpacing = parsed["spacing"];
	if (typeof rawSpacing === "number" && isFinite(rawSpacing)) {
		spacing = Math.max(0.2, Math.min(3, rawSpacing));
	} else if (typeof rawSpacing === "string") {
		const n = parseFloat(rawSpacing.trim());
		if (isFinite(n)) spacing = Math.max(0.2, Math.min(3, n));
	}

	// Zoom: accept a number (1.4) or a string ending in "%" ("140%"). Out-of-range
	// values are clamped to a sensible window — going past 5x mostly hurts.
	let zoom: number | undefined;
	const rawZoom = parsed["zoom"];
	if (typeof rawZoom === "number" && isFinite(rawZoom)) {
		zoom = rawZoom;
	} else if (typeof rawZoom === "string") {
		const s = rawZoom.trim();
		const pct = s.endsWith("%") ? parseFloat(s.slice(0, -1)) / 100 : parseFloat(s);
		if (isFinite(pct)) zoom = pct;
	}
	if (zoom !== undefined) {
		zoom = Math.max(0.1, Math.min(5, zoom));
	}

	// Height: accept a number (pixels) or a CSS-style string ("800px", "60vh", "50%").
	// Plain numbers get "px" appended. Strings are validated to match a known unit
	// pattern — if the user types nonsense, we fall back to the size default.
	let height: string | undefined;
	const rawHeight = parsed["height"];
	if (typeof rawHeight === "number" && isFinite(rawHeight) && rawHeight > 0) {
		height = `${Math.floor(rawHeight)}px`;
	} else if (typeof rawHeight === "string") {
		const s = rawHeight.trim();
		if (/^\d+(\.\d+)?(px|em|rem|vh|vw|%)$/.test(s)) {
			height = s;
		} else if (/^\d+(\.\d+)?$/.test(s)) {
			// Bare number as string — treat as pixels.
			height = `${parseFloat(s)}px`;
		}
	}

	return { ...DEFAULTS, size, depth, scope, tree, familyTree, familyGraph, center, zoom, height, labels, spacing, id, sizeExplicit };
}

function resolveHostFile(app: App, hostPath: string, sourcePath: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(hostPath);
	if (direct instanceof TFile) return direct;

	const stripped = hostPath.replace(/^\[\[|\]\]$/g, "");
	const resolved = app.metadataCache.getFirstLinkpathDest(stripped, sourcePath);
	if (resolved instanceof TFile) return resolved;

	const source = app.vault.getAbstractFileByPath(sourcePath);
	if (source instanceof TFile) return source;

	return null;
}
