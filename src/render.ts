import { App, TFile, Menu } from "obsidian";
import cytoscape, { Core, ElementDefinition, LayoutOptions } from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import { RelationsGraph, RelationsSettings, GraphEdge } from "./types";
import { applyGenerationLayout } from "./family-tree";

type Stylesheet = cytoscape.StylesheetStyle;

let extensionsRegistered = false;
function ensureExtensions(): void {
	if (extensionsRegistered) return;
	cytoscape.use(fcose);
	cytoscape.use(dagre);
	extensionsRegistered = true;
}

export interface RenderOptions {
	app: App;
	settings: RelationsSettings;
	container: HTMLElement;
	graph: RelationsGraph;
	highlightId?: string;
	useTreeLayout?: boolean;
	familyGraph?: boolean;      // generation-aligned positioning + Cytoscape edges,
	                            // edge styles differentiated by relationship type
	                            // (marriage solid, informal partnership dotted,
	                            // parent→child arrowed). Active-note focused.
	interactive?: boolean;
	compact?: boolean;
	zoomMultiplier?: number;    // applied AFTER fit; >1 zooms in, <1 zooms out. Default 1.
	showLabels?: boolean;       // show the note name under each node. Defaults to the
	                            // showNodeLabels setting; a code-block can override it.
	spacing?: number;           // family-graph spacing multiplier (0.2–3.0)
	presetPositions?: Record<string, { x: number; y: number }>;  // locked layout positions
}

interface ThemeColors {
	textNormal: string;
	textMuted: string;
	textAccent: string;
	textOnAccent: string;
	bgPrimary: string;
	bgSecondary: string;
	bgModBorder: string;
	interactiveAccent: string;
}

/**
 * Read a CSS variable from `host` and return a Cytoscape-safe color string.
 *
 * Cytoscape's color parser is strict — it accepts `#rrggbb`, `#rgb`, `rgb(r,g,b)`,
 * `rgba(r,g,b,a)`, named colors, and old-style `hsl(h,s,l)`. It chokes on:
 *   - empty / missing values
 *   - chained `var(--x)` (which `getPropertyValue` may return literally)
 *   - modern color syntaxes like `rgb(255 255 255 / 0.9)` or `hsl(0deg 0% 100% / .9)`
 *   - `oklch(...)` and similar
 *
 * To be safe, we round-trip every value through a hidden DOM element. The browser
 * resolves the variable, computes the final color, and returns it as
 * `rgb(r, g, b)` or `rgba(r, g, b, a)` — both of which Cytoscape accepts.
 */
function readColor(host: HTMLElement, varName: string, fallback: string): string {
	const probe = document.createElement("div");
	probe.style.color = `var(${varName}, ${fallback})`;
	probe.style.display = "none";
	host.appendChild(probe);
	let resolved = "";
	try {
		resolved = getComputedStyle(probe).color;
	} finally {
		probe.remove();
	}
	if (!resolved) return fallback;
	// `getComputedStyle().color` always returns rgb()/rgba() in any browser engine.
	// But guard against an empty/odd return just in case.
	if (!/^rgba?\(/.test(resolved)) return fallback;
	return resolved;
}

function resolveTheme(host: HTMLElement): ThemeColors {
	return {
		textNormal:        readColor(host, "--text-normal",                "#dcddde"),
		textMuted:         readColor(host, "--text-muted",                 "#999999"),
		textAccent:        readColor(host, "--text-accent",                "#7f6df2"),
		textOnAccent:      readColor(host, "--text-on-accent",             "#ffffff"),
		bgPrimary:         readColor(host, "--background-primary",         "#202020"),
		bgSecondary:       readColor(host, "--background-secondary",       "#161616"),
		bgModBorder:       readColor(host, "--background-modifier-border", "#363636"),
		interactiveAccent: readColor(host, "--interactive-accent",         "#7f6df2"),
	};
}

/**
 * Measure pixel widths of node labels so the layout can space nodes proportionally
 * to their label sizes. Without this, long names ("Drakmir Axen, erster Sohn von
 * Mornak") visually overlap their neighbours because the layout treats every node as
 * a fixed-width unit.
 *
 * Cytoscape doesn't expose a label measurement API for canvas-rendered text, so we
 * render each label into a hidden probe span styled to match the node stylesheet's
 * font/size. The browser's text measurement will be very close to what Cytoscape's
 * canvas renderer produces — within a pixel or two, plenty for layout purposes.
 *
 * Returns a Map of node-id → measured width in pixels. Always at least 1px.
 * Measuring 1000 labels takes a few ms; a single probe is reused for all nodes.
 */
function measureLabelWidths(
	host: HTMLElement,
	graph: RelationsGraph,
	compact: boolean,
): Map<string, number> {
	const result = new Map<string, number>();
	const fontSize = compact ? 10 : 13;

	const probe = host.ownerDocument.createElement("span");
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.left = "-99999px";
	probe.style.top = "0";
	probe.style.whiteSpace = "nowrap";
	probe.style.fontSize = `${fontSize}px`;
	probe.style.fontWeight = "500";
	// fontFamily inherits from host — same as what Cytoscape will use to render.
	host.appendChild(probe);

	try {
		for (const n of graph.nodes) {
			probe.textContent = n.label;
			result.set(n.id, Math.max(1, probe.offsetWidth));
		}
	} finally {
		probe.remove();
	}

	return result;
}

export function renderGraph(opts: RenderOptions): Core {
	ensureExtensions();
	const { app, settings, container, graph, highlightId, useTreeLayout, compact, familyGraph } = opts;
	// Label visibility: explicit per-call override wins, else fall back to the
	// global setting (default true for back-compat with vaults predating this option).
	const showLabels = opts.showLabels ?? settings.showNodeLabels ?? true;
	const interactive = opts.interactive !== false;
	// Default zoom multiplier: mini gets 1.4x so the graph "comes forward" and fills
	// the small canvas. Other sizes default to 1.0 (just the natural fit).
	const zoomMultiplier = typeof opts.zoomMultiplier === "number" && isFinite(opts.zoomMultiplier) && opts.zoomMultiplier > 0
		? opts.zoomMultiplier
		: (compact ? 1.4 : 1.0);
	// fit() padding scales with size — mini wants tight packing, larger views breathe more.
	const fitPadding = compact ? 6 : 30;

	// Edge filtering and synthesis varies by mode:
	//
	// familyGraph (graph-style family): keep only genealogy + pair edges (same as
	//   the side-panel filters), AND synthesize "informal partnership" edges
	//   between any two people who share a child but have no declared pair edge
	//   between them. Without this synthesis, an unmarried couple's relationship
	//   is only readable by tracing two arrows down to a shared kid — explicit
	//   dotted line between them makes it instantly visible.
	//
	// Other modes: pass the graph through unchanged.
	let effectiveGraph: RelationsGraph;
	if (familyGraph) {
		const filteredRaw = graph.edges.filter((e) => e.genealogy || e.pair);

		// Genealogy edges in our data go child→parent (the child's note declares
		// its parents in frontmatter). For the family-graph view we invert these
		// so arrows visually run parent→child, which is how genealogy charts are
		// conventionally read. Pair edges stay as-is — they're symmetric anyway.
		const filtered: GraphEdge[] = filteredRaw.map((e) => {
			if (!e.genealogy) return e;
			return { ...e, source: e.target, target: e.source };
		});

		// Find shared-children co-parents that aren't already in a pair edge.
		// Walk genealogy edges (now parent->child after inversion) and group by
		// child id (= edge.target).
		const parentSets = new Map<string, string[]>();
		for (const e of filtered) {
			if (!e.genealogy) continue;
			if (!parentSets.has(e.target)) parentSets.set(e.target, []);
			parentSets.get(e.target)!.push(e.source);
		}
		const declaredPairs = new Set<string>();
		for (const e of filtered) {
			if (!e.pair) continue;
			declaredPairs.add(pairKey(e.source, e.target));
		}
		// For each child with two+ parents, emit a synthetic informal-partnership
		// edge between each pair of co-parents that don't already have one.
		const synthesized: GraphEdge[] = [];
		const synthesizedKeys = new Set<string>();
		for (const parents of parentSets.values()) {
			for (let i = 0; i < parents.length; i++) {
				for (let j = i + 1; j < parents.length; j++) {
					const a = parents[i];
					const b = parents[j];
					const k = pairKey(a, b);
					if (declaredPairs.has(k)) continue;
					if (synthesizedKeys.has(k)) continue;
					synthesizedKeys.add(k);
					synthesized.push({
						source: a,
						target: b,
						type: "__informal_partnership",  // synthetic; not a real configured type
						color: "#888888",                  // muted grey to read as "implied, not declared"
						symmetric: true,
						pair: true,
						lineStyle: "dotted",
						genealogy: false,
					});
				}
			}
		}
		effectiveGraph = { nodes: graph.nodes, edges: [...filtered, ...synthesized] };
	} else {
		effectiveGraph = graph;
	}

	const elements = toCytoscape(effectiveGraph, highlightId);
	const theme = resolveTheme(container);

	// Measure node label widths up-front so layouts can space nodes proportionally
	// When labels are shown, measure their widths so layouts can space nodes
	// proportionally — without this, vaults with long descriptive names ("Drakmir
	// Axen, erster Sohn von Mornak") get overlapping labels because every node is
	// treated as the same width. When labels are hidden there's nothing to
	// measure, so we use an empty map and the layout packs nodes by circle size.
	const labelWidths = showLabels
		? measureLabelWidths(container, effectiveGraph, !!compact)
		: new Map<string, number>();
	// Stash on node data so the family-graph layout (which reads from the cy instance,
	// not from `graph`) can access it cheaply via `node.data("labelWidth")`.
	for (const el of elements) {
		const id = (el.data as { id?: string }).id;
		if (id !== undefined && labelWidths.has(id)) {
			(el.data as Record<string, unknown>).labelWidth = labelWidths.get(id);
		}
	}

	// Pick the layout. Two cases:
	//
	// familyGraph: skip layout (preset placeholder). Positions are computed by
	//   applyGenerationLayout after init — generation-aligned rows with parents
	//   above, partners on the same row, children below. Cytoscape draws its
	//   own type-differentiated edges (solid for marriage, dotted for informal,
	//   arrowed for genealogy).
	//
	// Otherwise: standard pickLayout.
	const hasPresets = !!opts.presetPositions && Object.keys(opts.presetPositions).length > 0;
	const initialLayout = (familyGraph || hasPresets)
		? ({ name: "preset" } as cytoscape.LayoutOptions)
		: pickLayout(settings, useTreeLayout, effectiveGraph, !!compact, labelWidths);

	const cy = cytoscape({
		container,
		elements,
		style: buildStyle(theme, !!compact, showLabels),
		layout: initialLayout,
		minZoom: 0.1,
		maxZoom: 4,
		// Pan, zoom, drag — explicit because defaults differ across versions.
		userPanningEnabled: interactive,
		userZoomingEnabled: interactive,
		panningEnabled: interactive,
		zoomingEnabled: interactive,
		// Node selection/grab. autoungrabify=false means nodes ARE grabbable.
		autoungrabify: false,
		autounselectify: false,
		boxSelectionEnabled: false,
		// Don't lock nodes during layout animation — otherwise drag during the first
		// few hundred ms after init silently fails.
		autolock: false,
	});

	if (hasPresets) {
		const preset = opts.presetPositions!;
		const missing: string[] = [];
		cy.nodes().forEach((node) => {
			const saved = preset[node.id()];
			if (saved) {
				node.position({ x: saved.x, y: saved.y });
			} else {
				missing.push(node.id());
			}
		});
		if (missing.length > 0 && familyGraph) {
			const spacing = opts.spacing ?? (compact ? 0.55 : 1);
			applyGenerationLayout(cy, graph, { spacing });
			cy.nodes().forEach((node) => {
				const saved = preset[node.id()];
				if (saved) node.position({ x: saved.x, y: saved.y });
			});
		} else if (missing.length > 0) {
			const xs = Object.values(preset).map((p) => p.x);
			const ys = Object.values(preset).map((p) => p.y);
			const startX = xs.length ? Math.max(...xs) + 120 : 0;
			const startY = ys.length ? Math.min(...ys) : 0;
			missing.forEach((id, idx) => {
				cy.getElementById(id).position({ x: startX, y: startY + idx * 80 });
			});
		}
	} else if (familyGraph) {
		const spacing = opts.spacing ?? (compact ? 0.55 : 1);
		applyGenerationLayout(cy, graph, { spacing });
	}

	// Apply per-node image styles after init. We do this here (not in the stylesheet
	// via `data(image)`) because nodes without a resolvable image must NOT have a
	// background-image at all — otherwise Cytoscape attempts to parse an empty URL
	// and throws.
	cy.nodes().forEach((node) => {
		const img = node.data("image") as string;
		if (img && typeof img === "string") {
			node.style({
				"background-image": img,
				"background-fit": "cover",
				"background-clip": "node",
			});
		}
		// Belt-and-braces: ensure each node is grabbable even if defaults shift.
		node.grabify();
	});

	// Cytoscape caches the canvas's screen position internally. When ANY of these happen,
	// the cached position becomes stale and clicks/drags map to wrong coordinates:
	//   - the page scrolls
	//   - the window resizes
	//   - a sibling element above this canvas changes size (e.g. another graph block
	//     finishing its layout animation pushes the next block down)
	// On a note with multiple embedded graphs, the second and third blocks are the most
	// affected because they sit below the first one and shift around as it settles.
	// Calling cy.resize() invalidates Cytoscape's cached rect — cheap, safe to call often.
	const invalidate = () => cy.resize();

	// Container size or position changes
	if (typeof ResizeObserver !== "undefined") {
		let fittedOnce = false;
		const ro = new ResizeObserver(() => {
			const r = container.getBoundingClientRect();
			if (r.width > 1 && r.height > 1) {
				cy.resize();
				if (!fittedOnce) {
					cy.fit(undefined, fitPadding);
					// "Come forward" — zoom past the natural fit. We multiply rather
					// than setting an absolute zoom so the effect is consistent across
					// graphs of different sizes/density. The center stays put because
					// fit() already centered it.
					if (zoomMultiplier !== 1) {
						cy.zoom({
							level: cy.zoom() * zoomMultiplier,
							renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
						});
					}
					fittedOnce = true;
				}
			}
		});
		ro.observe(container);
		// Also watch the body — sibling changes that push our container around
		// don't trigger our own ResizeObserver.
		ro.observe(document.body);
		cy.on("destroy", () => ro.disconnect());
	}

	// Page scrolling. We listen on the scrolling ancestor (Obsidian's reading-mode
	// scroller), falling back to window.
	const scrollParent = findScrollParent(container);
	const onScroll = () => invalidate();
	scrollParent.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", invalidate);
	cy.on("destroy", () => {
		scrollParent.removeEventListener("scroll", onScroll);
		window.removeEventListener("resize", invalidate);
	});

	// Belt-and-braces: when the layout finishes animating, refresh the renderer.
	cy.on("layoutstop", () => cy.resize());

	// And whenever the user moves their mouse into this canvas, make sure the
	// renderer's idea of "where am I on screen" matches reality. This single
	// mouseenter listener fixes the most common failure mode — clicking on
	// embedded graph #2 or #3 while the page was scrolled.
	const onMouseEnter = () => cy.resize();
	container.addEventListener("mouseenter", onMouseEnter);
	cy.on("destroy", () => container.removeEventListener("mouseenter", onMouseEnter));

	cy.on("tap", "node", async (evt) => {
		const path = evt.target.id() as string;
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await app.workspace.getLeaf(false).openFile(file);
		}
	});

	cy.on("cxttap", "node", (evt) => {
		const path = evt.target.id() as string;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const orig = evt.originalEvent as MouseEvent;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Open").setIcon("file").onClick(async () => {
			await app.workspace.getLeaf(false).openFile(file);
		}));
		menu.addItem((i) => i.setTitle("Open in new tab").setIcon("plus").onClick(async () => {
			await app.workspace.getLeaf("tab").openFile(file);
		}));
		menu.addItem((i) => i.setTitle("Open in new pane").setIcon("separator-vertical").onClick(async () => {
			await app.workspace.getLeaf("split").openFile(file);
		}));
		menu.showAtMouseEvent(orig);
	});

	return cy;
}

/**
 * Walk up from `el` looking for the nearest scrolling ancestor. Cytoscape's hit
 * detection caches the canvas's screen position, so we need to invalidate that
 * cache whenever the canvas moves on screen — and the most common reason for
 * that is the user scrolling Obsidian's reading-mode container.
 */
function findScrollParent(el: HTMLElement): HTMLElement | Window {
	let cur: HTMLElement | null = el.parentElement;
	while (cur && cur !== document.body) {
		const overflow = getComputedStyle(cur).overflowY;
		if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
			return cur;
		}
		cur = cur.parentElement;
	}
	return window;
}

function toCytoscape(graph: RelationsGraph, highlightId?: string): ElementDefinition[] {
	const out: ElementDefinition[] = [];
	for (const n of graph.nodes) {
		out.push({
			data: {
				id: n.id,
				label: n.label,
				image: n.image ?? "",
				hasImage: n.image ? "true" : "false",
				highlight: highlightId && n.id === highlightId ? "true" : "false",
			},
		});
	}
	for (const e of graph.edges) {
		const classes: string[] = [];
		if (e.pair) classes.push("pair");
		if (e.genealogy) classes.push("genealogy");
		if (e.lineStyle && e.lineStyle !== "solid") {
			classes.push(`ls-${e.lineStyle}`);
		}
		out.push({
			data: {
				id: `${e.source}__${e.type}__${e.target}`,
				source: e.source,
				target: e.target,
				color: e.color || "#888888",
				type: e.type,
				directed: e.symmetric ? "false" : "true",
				pair: e.pair ? "true" : "false",
				lineStyle: e.lineStyle ?? "solid",
			},
			classes: classes.join(" "),
		});
	}
	return out;
}

/**
 * Stylesheet uses only concrete color strings (resolved via readColor). No data() image
 * mapping — that's applied per-node after init.
 */
function buildStyle(theme: ThemeColors, compact: boolean, showLabels: boolean): Stylesheet[] {
	// Compact mode shrinks every dimension so a useful graph fits in ~140px tall by ~240px wide.
	const nodeSize        = compact ? 32 : 60;
	const nodeSizeFocus   = compact ? 40 : 72;
	const fontSize        = compact ? 10 : 13;
	const labelMargin     = compact ? 4  : 8;
	const labelPadding    = compact ? "2px" : "4px";

	return [
		{
			selector: "node",
			style: {
				"background-color": theme.interactiveAccent,
				// Empty label hides the text while keeping the node itself. We omit
				// the label entirely (rather than setting visibility) so there's no
				// reserved space or background pill where the text would be.
				"label": showLabels ? "data(label)" : "",
				"color": theme.textNormal,
				"font-size": fontSize,
				"font-weight": 500,
				"text-valign": "bottom",
				"text-halign": "center",
				"text-margin-y": labelMargin,
				"text-background-color": theme.bgPrimary,
				"text-background-opacity": showLabels ? 0.95 : 0,
				"text-background-padding": labelPadding,
				"text-background-shape": "roundrectangle",
				"text-border-color": theme.bgModBorder,
				"text-border-width": showLabels ? 1 : 0,
				"text-border-opacity": showLabels ? 1 : 0,
				"width": nodeSize,
				"height": nodeSize,
				"border-width": 2,
				"border-color": theme.bgModBorder,
				"shape": "ellipse",
			},
		},
		{
			selector: "node[highlight = 'true']",
			style: {
				"border-width": 4,
				"border-color": theme.textAccent,
				"width": nodeSizeFocus,
				"height": nodeSizeFocus,
			},
		},
		{
			selector: "node:selected",
			style: {
				"border-width": 3,
				"border-color": theme.textAccent,
			},
		},
		{
			selector: "edge",
			style: {
				"width": 2.5,
				"line-color": "data(color)",
				"line-style": "solid",
				"curve-style": "bezier",
				"opacity": 0.85,
			},
		},
		{
			selector: "edge[directed = 'true']",
			style: {
				"target-arrow-color": "data(color)",
				"target-arrow-shape": "triangle",
				"arrow-scale": 1.3,
			},
		},
		{
			selector: "edge.ls-dashed",
			style: {
				"line-style": "dashed",
				"line-dash-pattern": [8, 4],
			},
		},
		{
			selector: "edge.ls-dotted",
			style: {
				"line-style": "dotted",
				"line-dash-pattern": [2, 4],
			},
		},
		{
			// For "double": render a thicker line in the edge color, with an inner
			// stripe in the canvas background color produced by line-outline-* in
			// reverse. The trick: make the inner line bg-colored and put the actual
			// edge color on the outline. This produces two visible parallel lines
			// (top and bottom edges of the outlined band).
			selector: "edge.ls-double",
			style: {
				"width": 6,
				"line-color": theme.bgPrimary,
				"line-outline-width": 1.5,
				"line-outline-color": "data(color)",
			},
		},
		{
			selector: "edge.pair",
			style: {
				"width": 5,
				"curve-style": "straight",
				"opacity": 1,
			},
		},
		{
			// Pair + double together — bump up the outline so the railroad-track
			// effect stays readable on the heavier pair line.
			selector: "edge.pair.ls-double",
			style: {
				"width": 9,
				"line-outline-width": 2,
			},
		},
		{
			selector: "edge:selected",
			style: { "width": 4, "opacity": 1 },
		},
	];
}


function pickLayout(
	settings: RelationsSettings,
	forceTree: boolean | undefined,
	graph: RelationsGraph,
	compact: boolean,
	labelWidths: Map<string, number>,
): LayoutOptions {
	// Average label width — used as a baseline so fcose's spacing scales with
	// however verbose this vault's names happen to be. Vaults with short names
	// (Arthur, Merlin) keep the tight default spacing; vaults with long names
	// (Drakmir Axen, erster Sohn von Mornak) get proportionally more breathing
	// room without manual configuration.
	const avgLabelWidth = averageLabelWidth(labelWidths);
	// Reference width: roughly the longest "short" name we expect by default
	// (e.g. "Guinevere" ≈ 70px at fontSize 13). Anything longer than this scales
	// up; anything shorter doesn't scale down (we don't want labels to crowd a
	// node circle just because everyone happens to be named Bob).
	const refWidth = compact ? 50 : 70;
	const widthScale = Math.max(1, avgLabelWidth / refWidth);

	const useTree = forceTree || settings.layout === "dagre";
	const animate = settings.animateLayout !== false;

	if (useTree) {
		// Dagre's nodeSep is the horizontal gap *between* nodes on the same rank.
		// Scaling it by widthScale means siblings with long names get spaced apart
		// far enough that their labels don't overlap.
		return {
			name: "dagre",
			rankDir: "TB",
			nodeSep: Math.round((compact ? 20 : 40) * widthScale),
			rankSep: compact ? 40 : 80,
			animate,
		} as unknown as LayoutOptions;
	}

	if (settings.layout === "cose") {
		return { name: "cose", animate, padding: compact ? 8 : 30 };
	}

	// fcose is per-node/per-edge functions, so we can use the actual label widths
	// of the specific endpoints rather than a global average. This is more accurate
	// than scaling everything by avgLabelWidth — a few long names won't push the
	// short-named majority needlessly far apart.
	const baseRepulsion = compact ? 800 : 5000;
	const baseEdgeLen = compact ? 42 : 110;
	const basePairLen = compact ? 18 : 35;

	const fcoseOpts: Record<string, unknown> = {
		name: "fcose",
		animate,
		randomize: graph.nodes.length > 1,
		// Repulsion as a function of the node — long-labeled nodes push others
		// further away. Cytoscape's fcose accepts `nodeRepulsion: (node) => number`.
		nodeRepulsion: (node: cytoscape.NodeSingular): number => {
			const w = (node.data("labelWidth") as number | undefined) ?? refWidth;
			const scale = Math.max(1, w / refWidth);
			return baseRepulsion * scale;
		},
		// Ideal edge length: the longer the endpoints' labels, the longer the
		// edge needs to be to avoid label overlap. We add a fixed fraction of the
		// summed label widths so extreme cases (two 250px labels next to each
		// other) get noticeably more space than typical (two 70px labels).
		idealEdgeLength: (edge: cytoscape.EdgeSingular): number => {
			const sourceW = (edge.source().data("labelWidth") as number | undefined) ?? refWidth;
			const targetW = (edge.target().data("labelWidth") as number | undefined) ?? refWidth;
			const labelPad = (sourceW + targetW) / 4;  // half of avg label width
			if (edge.data("pair") === "true") return basePairLen + labelPad * 0.4;
			return baseEdgeLen + labelPad;
		},
		edgeElasticity: (edge: cytoscape.EdgeSingular): number => {
			return edge.data("pair") === "true" ? 0.9 : 0.45;
		},
		padding: compact ? 6 : 30,
		nodeSeparation: Math.round((compact ? 30 : 90) * widthScale),
	};
	return fcoseOpts as unknown as LayoutOptions;
}

function averageLabelWidth(widths: Map<string, number>): number {
	if (widths.size === 0) return 0;
	let sum = 0;
	for (const w of widths.values()) sum += w;
	return sum / widths.size;
}

/** Normalised key for an unordered pair of node ids — used to detect already-declared
 * pair edges when synthesising informal-partnership edges between co-parents. */
function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}
