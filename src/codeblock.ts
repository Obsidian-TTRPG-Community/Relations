import { App, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, parseYaml, setIcon, TFile } from "obsidian";
import { Core } from "cytoscape";
import { RelationsSettings, PositionStore } from "./types";
import { buildFullGraph, buildLocalGraph, buildFamilyNeighborhood } from "./graph";
import { renderGraph } from "./render";
import type { GraphCache } from "./graph-cache";

export type EmbedSize = "mini" | "small" | "large";

interface CodeBlockOptions {
	size: EmbedSize;
	depth: number;
	center?: string;
	scope?: "local" | "full";
	tree?: boolean;
	familyGraph?: boolean;  // family view: generation-aligned positioning + Cytoscape
	                        // edges differentiated by relationship type (marriage solid,
	                        // informal partnership dotted, parent→child arrowed).
	                        // Centered on the active/host note's family neighbourhood.
	zoom?: number;
	height?: string;          // overrides the size's default height; e.g. "800px", "60vh"
	labels?: boolean;         // show note name under each node; overrides the global
	                          // showNodeLabels setting for this block only
	spacing?: number;         // family-graph node spacing multiplier (0.2–3.0)
	id?: string;              // stable block identifier for layout locking
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
		private store: PositionStore | null,
	) {
		super(containerEl);
	}

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

	private async ensureBlockId(): Promise<string | null> {
		if (this.options.id) return this.options.id;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return null;
		const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return null;

		const id = generateBlockId();
		const content = (await this.app.vault.read(file)).split("\n");
		const lineIdx = info.lineStart;
		if (lineIdx < 0 || lineIdx >= content.length) return null;

		const line = content[lineIdx];
		const prefixMatch = line.match(/^(\s*(?:>\s?)*)/);
		const prefix = prefixMatch ? prefixMatch[1] : "";
		const fencePart = line.slice(prefix.length);
		if (!/^`{3,}.*\brelations\b/.test(fencePart) && !/^`{3,}\s*npc-graph\b/.test(fencePart)) return null;

		content.splice(lineIdx + 1, 0, `${prefix}id: ${id}`);
		await this.app.vault.modify(file, content.join("\n"));
		this.options.id = id;
		return id;
	}

	private addLockControl(host: HTMLElement): void {
		const group = host.createDiv({ cls: "relations-lock-group" });
		const lockBtn = group.createEl("button", { cls: "relations-lock-btn" });
		const resetBtn = group.createEl("button", { cls: "relations-lock-btn relations-reset-btn" });
		setIcon(resetBtn, "rotate-ccw");
		resetBtn.setAttribute("aria-label", "Reset to automatic layout");

		const updateUI = () => {
			lockBtn.toggleClass("is-locked", this.locked);
			setIcon(lockBtn, this.locked ? "save" : "lock");
			lockBtn.setAttribute("aria-label", this.locked ? "Save current positions" : "Lock layout in place");
			resetBtn.toggleClass("is-hidden", !this.locked);
			resetBtn.toggleClass("is-locked", this.locked);
		};
		updateUI();

		const savePositions = async (): Promise<{ autoAddedId: boolean } | null> => {
			if (!this.store || !this.cy) return null;
			let id = this.options.id;
			let autoAddedId = false;
			if (!id) {
				id = await this.ensureBlockId() ?? undefined;
				if (!id) {
					new Notice("Couldn't auto-add an id to this code block. Add one manually to lock it:\n\n```relations\nid: my-graph\n```", 9000);
					return null;
				}
				autoAddedId = true;
			}
			const positions: Record<string, { x: number; y: number }> = {};
			this.cy.nodes().forEach((n) => {
				const pos = n.position();
				positions[n.id()] = { x: pos.x, y: pos.y };
			});
			await this.store.set(id, { locked: true, positions });
			return { autoAddedId };
		};

		lockBtn.addEventListener("click", async () => {
			const wasLocked = this.locked;
			const result = await savePositions();
			if (result) {
				this.locked = true;
				updateUI();
				if (result.autoAddedId) {
					new Notice("Layout locked. Added an id to the code block so it persists across refreshes.");
				} else {
					new Notice(wasLocked ? "Layout updated." : "Layout locked. Positions will persist across refreshes.");
				}
			}
		});

		resetBtn.addEventListener("click", async () => {
			if (!this.store || !this.options.id) return;
			await this.store.clear(this.options.id);
			this.locked = false;
			this.render();
			new Notice("Layout reset — back to automatic layout.");
		});
	}

	private render(): void {
		this.cy?.destroy();
		this.cy = null;
		const el = this.containerEl;
		el.empty();

		const insideCallout = isInsideCallout(el);
		let effectiveSize = this.options.size;
		if (insideCallout && !this.options.sizeExplicit) {
			effectiveSize = "mini";
		}

		const effectiveDepth = effectiveSize === "mini" ? 1 : this.options.depth;

		el.addClass("relations-embed");
		el.addClass(`is-${effectiveSize}`);
		if (insideCallout) el.addClass("in-callout");

		if (this.options.height) {
			el.style.height = this.options.height;
			el.style.minHeight = this.options.height;
		}

		const canvas = el.createDiv({ cls: "relations-embed-canvas" });

		const hostPath = this.options.center ?? this.sourcePath;
		const hostFile = resolveHostFile(this.app, hostPath, this.sourcePath);

		let graph;
		let highlightId: string | undefined;

		const useFamilyNeighbourhood = this.options.familyGraph && this.options.scope !== "full";

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

		const saved = this.options.id && this.store ? this.store.get(this.options.id) : null;
		this.locked = !!(saved && saved.locked);
		const presetPositions = this.locked && saved ? saved.positions : undefined;

		this.cy = renderGraph({
			app: this.app,
			settings: this.settings,
			container: canvas,
			graph,
			highlightId,
			useTreeLayout: this.options.tree,
			familyGraph: this.options.familyGraph,
			compact: effectiveSize === "mini",
			zoomMultiplier: this.options.zoom,
			showLabels: this.options.labels,
			spacing: this.options.spacing,
			presetPositions,
		});

		if (effectiveSize !== "mini") this.addLockControl(el);

		if (effectiveSize !== "mini" && this.settings.showLegend) {
			const usedTypes = new Set(graph.edges.map((e) => e.type));
			const visibleTypes = this.settings.relationshipTypes.filter((t) => usedTypes.has(t.name));
			if (visibleTypes.length > 0) {
				const legend = el.createDiv({ cls: "relations-legend" });
				renderLegend(legend, visibleTypes);
			}
		}
	}
}

function generateBlockId(): string {
	return `rel-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
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

export function processRelationsBlock(
	app: App,
	settings: RelationsSettings,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	cache: GraphCache | null = null,
	store: PositionStore | null = null,
): void {
	const options = parseOptions(source);
	const child = new RelationsBlockChild(el, app, settings, options, ctx, cache, store);
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
	// "family-graph" enables the family view: active-note focused, generation-aligned,
	// edges styled by relationship type (marriage solid, informal partnership dotted,
	// parent→child arrowed). Accept kebab-case (preferred) and camelCase aliases.
	const familyGraph = parsed["family-graph"] === true || parsed["familyGraph"] === true;
	const center = typeof parsed["center"] === "string" ? (parsed["center"] as string) : undefined;

	// labels: explicit true/false hides or shows note names for this block,
	// overriding the global setting. Undefined = inherit the setting.
	const labels = typeof parsed["labels"] === "boolean" ? (parsed["labels"] as boolean) : undefined;

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

	// Spacing: family-graph node spacing multiplier. Accept number or string, clamp to 0.2–3.0.
	let spacing: number | undefined;
	const rawSpacing = parsed["spacing"];
	if (typeof rawSpacing === "number" && isFinite(rawSpacing)) {
		spacing = Math.max(0.2, Math.min(3, rawSpacing));
	} else if (typeof rawSpacing === "string") {
		const sp = parseFloat(rawSpacing.trim());
		if (isFinite(sp)) spacing = Math.max(0.2, Math.min(3, sp));
	}

	// Block id: stable identifier for layout locking. Accept string or number.
	const rawId = parsed["id"];
	const id = typeof rawId === "string" && rawId.trim()
		? rawId.trim()
		: typeof rawId === "number"
			? String(rawId)
			: undefined;

	return { ...DEFAULTS, size, depth, scope, tree, familyGraph, center, zoom, height, labels, spacing, id, sizeExplicit };
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
