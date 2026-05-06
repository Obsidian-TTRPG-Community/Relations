import { App, TFile, Menu } from "obsidian";
import cytoscape, { Core, ElementDefinition, LayoutOptions } from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import { RelationsGraph, RelationsSettings } from "./types";
import { applyFamilyTreeLayout } from "./family-tree";

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
	familyTree?: boolean;       // dagre + spouse pairing + children-under-midpoint
	interactive?: boolean;
	compact?: boolean;
	zoomMultiplier?: number;    // applied AFTER fit; >1 zooms in, <1 zooms out. Default 1.
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

export function renderGraph(opts: RenderOptions): Core {
	ensureExtensions();
	const { app, settings, container, graph, highlightId, useTreeLayout, compact, familyTree } = opts;
	const interactive = opts.interactive !== false;
	// Default zoom multiplier: mini gets 1.4x so the graph "comes forward" and fills
	// the small canvas. Other sizes default to 1.0 (just the natural fit).
	const zoomMultiplier = typeof opts.zoomMultiplier === "number" && isFinite(opts.zoomMultiplier) && opts.zoomMultiplier > 0
		? opts.zoomMultiplier
		: (compact ? 1.4 : 1.0);
	// fit() padding scales with size — mini wants tight packing, larger views breathe more.
	const fitPadding = compact ? 6 : 30;

	const elements = toCytoscape(graph, highlightId);
	const theme = resolveTheme(container);

	// In familyTree mode we run the layout ourselves after init; passing `preset` here
	// avoids running a normal layout that would just be overwritten.
	const initialLayout = familyTree
		? ({ name: "preset" } as cytoscape.LayoutOptions)
		: pickLayout(settings, useTreeLayout, graph, !!compact);

	const cy = cytoscape({
		container,
		elements,
		style: buildStyle(theme, !!compact),
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

	if (familyTree) {
		// Lazy import: applyFamilyTreeLayout is only needed when this mode is active,
		// and putting the require here lets the bundler still tree-shake when it isn't.
		// (Won't actually tree-shake here because we always import the module above
		// in CommonJS bundling, but the cost is minimal.)
		applyFamilyTreeLayout(cy, graph);
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
		// Apply a class for any non-solid line style. Solid is the default.
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
function buildStyle(theme: ThemeColors, compact: boolean): Stylesheet[] {
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
				"label": "data(label)",
				"color": theme.textNormal,
				"font-size": fontSize,
				"font-weight": 500,
				"text-valign": "bottom",
				"text-halign": "center",
				"text-margin-y": labelMargin,
				"text-background-color": theme.bgPrimary,
				"text-background-opacity": 0.95,
				"text-background-padding": labelPadding,
				"text-background-shape": "roundrectangle",
				"text-border-color": theme.bgModBorder,
				"text-border-width": 1,
				"text-border-opacity": 1,
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
): LayoutOptions {
	const useTree = forceTree || settings.layout === "dagre";
	if (useTree) {
		return {
			name: "dagre",
			rankDir: "TB",
			nodeSep: compact ? 20 : 40,
			rankSep: compact ? 40 : 80,
			animate: true,
		} as unknown as LayoutOptions;
	}

	if (settings.layout === "cose") {
		return { name: "cose", animate: true, padding: compact ? 8 : 30 };
	}

	const fcoseOpts: Record<string, unknown> = {
		name: "fcose",
		animate: true,
		randomize: graph.nodes.length > 1,
		// Compact: nodes pull together harder, edges are shorter, padding is tight.
		// We push these further than v0.4 so the mini canvas fills properly without
		// relying entirely on a post-fit zoom multiplier.
		nodeRepulsion: compact ? 800 : 5000,
		idealEdgeLength: (edge: cytoscape.EdgeSingular): number => {
			if (edge.data("pair") === "true") return compact ? 18 : 35;
			return compact ? 42 : 110;
		},
		edgeElasticity: (edge: cytoscape.EdgeSingular): number => {
			return edge.data("pair") === "true" ? 0.9 : 0.45;
		},
		padding: compact ? 6 : 30,
		nodeSeparation: compact ? 30 : 90,
	};
	return fcoseOpts as unknown as LayoutOptions;
}
