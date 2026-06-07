import { App, TFile, Menu } from "obsidian";
import cytoscape, { Core, ElementDefinition, LayoutOptions } from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import { RelationsGraph, RelationsSettings, GraphEdge, RelationshipType, EdgeLabelStore, edgeLabelKey } from "./types";
import { applyGenerationLayout } from "./family-tree";
import { drawFamilyConnectors, OverlayLabelHooks } from "./family-connectors";
import { setupNodeBadges } from "./node-badges";

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
	familyMode?: "graph" | "tree";
	                            // Family view, active-note focused, generation-aligned.
	                            // "graph": Cytoscape edges differentiated by relationship
	                            //   type (marriage solid, informal partnership dotted,
	                            //   parent→child arrowed) — the original graph-style view.
	                            // "tree": orthogonal SVG connectors (vertical drops +
	                            //   sibling distribution bars) for a true family-tree look.
	interactive?: boolean;
	compact?: boolean;
	zoomMultiplier?: number;    // applied AFTER fit; >1 zooms in, <1 zooms out. Default 1.
	showLabels?: boolean;       // show the note name under each node. Defaults to the
	                            // showNodeLabels setting; a code-block can override it.
	spacing?: number;           // family-graph spacing multiplier (0.2–3.0)
	presetPositions?: Record<string, { x: number; y: number }>;  // locked layout positions
	labelStore?: EdgeLabelStore | null;
	                            // When provided, edge labels are loaded from and saved to this
	                            // store. Double-clicking an edge opens an inline editor.
	editableLabels?: boolean;   // gate the double-click editor. Defaults to false. Set true in
	                            // contexts with enough room (non-mini embeds, side panel).
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
	probe.className = "relations-color-probe";
	probe.style.color = `var(${varName}, ${fallback})`;
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
	probe.className = "relations-label-probe";
	probe.style.fontSize = `${fontSize}px`;
	// fontFamily inherits from host — same as what Cytoscape will use to render.
	// Other probe styles (position, visibility, off-screen left, white-space,
	// font-weight) live in styles.css under .relations-label-probe.
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
	const { app, settings, container, graph, highlightId, useTreeLayout, compact, familyMode } = opts;
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
	// Family modes (graph + tree): keep only genealogy + pair edges (same as the
	//   side-panel filters), AND synthesize "informal partnership" edges between
	//   any two people who share a child but have no declared pair edge between
	//   them. Without this synthesis, an unmarried couple's relationship is only
	//   readable by tracing two arrows down to a shared kid — an explicit dotted
	//   line between them makes it instantly visible. Both family modes filter and
	//   synthesize identically; they differ only in how connectors are drawn.
	//
	// Other modes: pass the graph through unchanged.
	// Genealogy edges in our data go child→parent — the child's note declares
	// its parents in frontmatter, and the data model mirrors that direction.
	// For rendering we always invert these so arrows visually run parent→child,
	// which is how genealogy charts are conventionally read. Pair edges stay
	// as-is — they're symmetric anyway.
	//
	// Inverting in EVERY mode (not just family modes) fixes a longstanding bug
	// where the standard graph view drew arrows child→parent — a child note
	// with `parent: "[[X]]"` appeared to "be the parent of" X, which is the
	// opposite of what users expect.
	const invertGenealogy = (e: GraphEdge): GraphEdge =>
		e.genealogy ? { ...e, source: e.target, target: e.source } : e;

	let effectiveGraph: RelationsGraph;
	if (familyMode) {
		const filteredRaw = graph.edges.filter((e) => e.genealogy || e.pair);
		const filtered: GraphEdge[] = filteredRaw.map(invertGenealogy);

		// Synthesize "informal partnership" edges between co-parents with no
		// declared pair edge. Extracted so the legend builder can detect the same
		// condition without duplicating the logic (see synthesizeInformalPartnerships).
		const synthesized = synthesizeInformalPartnerships(graph);
		effectiveGraph = { nodes: graph.nodes, edges: [...filtered, ...synthesized] };
	} else {
		// Non-family modes: keep all edges (allies, enemies, etc.), but still
		// invert genealogy so the arrow on a `parent` edge reads correctly.
		effectiveGraph = { nodes: graph.nodes, edges: graph.edges.map(invertGenealogy) };
	}

	const labelStore = opts.labelStore ?? null;
	// Resolve symmetry from the configured relationship types (falling back to
	// the edge's own flag). Used so symmetric pairs canonicalise the key
	// direction: an "enemy" label set from A's note shows up from B's view too.
	const typeIsSymmetric = (e: GraphEdge): boolean => {
		const t = settings.relationshipTypes.find((rt) => rt.name === e.type);
		if (t) return t.symmetric;
		return e.symmetric ?? true;
	};
	const lookupLabel = (e: GraphEdge): string => {
		if (!labelStore) return "";
		// Synthetic informal-partnership edges don't have a canonical relationship
		// type configured; labels on them aren't supported in this release.
		if (e.type === INFORMAL_PARTNERSHIP_TYPE) return "";
		// Genealogy edges have been inverted for display (source=parent,
		// target=child), but labels are keyed against the canonical raw
		// direction (source=child, target=parent — matching the frontmatter
		// declaration). Un-invert here so the storage key stays stable
		// regardless of which view rendered the label.
		const keySource = e.genealogy ? e.target : e.source;
		const keyTarget = e.genealogy ? e.source : e.target;
		return labelStore.getLabel(edgeLabelKey(keySource, e.type, keyTarget, typeIsSymmetric(e))) ?? "";
	};

	const elements = toCytoscape(effectiveGraph, highlightId, lookupLabel);
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
	// Family modes: skip layout (preset placeholder). Positions are computed by
	//   applyGenerationLayout after init — generation-aligned rows with parents
	//   above, partners on the same row, children below. Tree mode then overlays
	//   orthogonal SVG connectors; graph mode keeps Cytoscape's own type-
	//   differentiated edges (solid for marriage, dotted for informal, arrowed
	//   for genealogy).
	//
	// Otherwise: standard pickLayout.
	const hasPresets = !!opts.presetPositions && Object.keys(opts.presetPositions).length > 0;
	const initialLayout = (familyMode || hasPresets)
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
		if (missing.length > 0 && familyMode) {
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
	} else if (familyMode) {
		const spacing = opts.spacing ?? (compact ? 0.55 : 1);
		applyGenerationLayout(cy, graph, { spacing });
	}

	// Tree mode only: replace Cytoscape's bezier genealogy edges with orthogonal
	// SVG connectors for the classic family-tree look. Graph mode keeps the
	// Cytoscape edges (arrowed parent→child, relationship-typed line styles).
	if (familyMode === "tree") {
		// Wire label hooks so the overlay can read existing labels for display
		// and open the editor when a stem is double-clicked. Genealogy edges in
		// the raw graph go child→parent (the child's note declares its parents
		// in frontmatter) and are asymmetric, so the key direction is preserved.
		//
		// We resolve the genealogy type's name from one such edge — usually
		// "parent" but the user can rename it in settings. Same type name as
		// Cytoscape edges use elsewhere, so a "parent" label set in family-graph
		// mode shows up in family-tree mode (and vice versa).
		const genType = graph.edges.find((e) => e.genealogy)?.type ?? "parent";

		// overlayRedraw is the redraw function returned by drawFamilyConnectors.
		// The editor's onSave needs to call it because saving a label doesn't
		// move any nodes — so the overlay's position-driven redraw loop won't
		// fire on its own. Initialised to a no-op so the closure has something
		// safe to call before drawFamilyConnectors returns, then reassigned.
		let overlayRedraw: () => void = () => { /* no-op until set */ };

		const overlayHooks: OverlayLabelHooks | null = (labelStore && opts.editableLabels) ? {
			getGenealogyLabel: (child, parent) =>
				labelStore.getLabel(edgeLabelKey(child, genType, parent, false)) ?? "",
			editGenealogyLabel: (child, parent, clientX, clientY) => {
				const key = edgeLabelKey(child, genType, parent, false);
				openEdgeLabelEditor({
					container,
					clientX,
					clientY,
					current: labelStore.getLabel(key) ?? "",
					placeholder: 'e.g. "estranged"',
					onSave: async (value) => {
						await labelStore.setLabel(key, value);
						overlayRedraw();
					},
				});
			},
		} : null;

		overlayRedraw = drawFamilyConnectors(cy, graph, container, !!compact, overlayHooks);
	}

	// Node badges: DOM overlay drawing top-left icons, top-right icons, and
	// italic subtext under each node, driven by frontmatter. Runs in every
	// mode (basic graph, family-graph, family-tree). Respects the showLabels
	// flag — when labels are off, badges are off too, so "minimal portraits"
	// mode stays minimal. The returned redraw function is unused at the
	// moment because the overlay listens to its own Cytoscape events; if
	// future code needs to force a redraw (e.g. settings change without
	// node moves) it would call the returned function.
	setupNodeBadges(cy, container, showLabels);

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

	// Double-click an edge → open the inline label editor. Gated by
	// editableLabels (off in mini embeds). Synthetic informal-partnership
	// edges are skipped — they don't have a canonical configured type, so a
	// label key would be ambiguous.
	if (opts.editableLabels && labelStore) {
		cy.on("dblclick", "edge", (evt) => {
			const edge = evt.target;
			const type = edge.data("type") as string;
			if (type === INFORMAL_PARTNERSHIP_TYPE) return;
			const source = edge.data("source") as string;
			const target = edge.data("target") as string;
			const symmetric = edge.data("symmetric") === "true";
			const genealogy = edge.data("genealogy") === "true";
			// Genealogy edges have been inverted for display (source=parent,
			// target=child), but labels are keyed against the canonical raw
			// direction (source=child, target=parent — matching the frontmatter
			// declaration). Un-invert here to match the lookup in lookupLabel.
			const keySource = genealogy ? target : source;
			const keyTarget = genealogy ? source : target;
			const key = edgeLabelKey(keySource, type, keyTarget, symmetric);
			const current = labelStore.getLabel(key) ?? "";

			const orig = evt.originalEvent as MouseEvent;
			openEdgeLabelEditor({
				container,
				clientX: orig.clientX,
				clientY: orig.clientY,
				current,
				placeholder: 'e.g. "hates them 75%"',
				onSave: async (value) => {
					await labelStore.setLabel(key, value);
					edge.data("userLabel", value);
					if (value) edge.addClass("has-label");
					else edge.removeClass("has-label");
				},
			});
		});
	}

	return cy;
}

/**
 * Floating text input that lets the user add or edit a short label on an
 * edge. Absolutely-positioned inside the embed container so it tracks with
 * scroll and resize. Saved on Enter or blur; cancelled with Escape. Empty
 * input on save removes the label.
 */
function openEdgeLabelEditor(opts: {
	container: HTMLElement;
	clientX: number;
	clientY: number;
	current: string;
	placeholder: string;
	onSave: (value: string) => Promise<void> | void;
}): void {
	// Remove any prior editor before opening a new one — defensive in case a
	// double-click fires while one's already open.
	opts.container.querySelectorAll(".relations-edge-label-editor").forEach((el) => el.remove());

	const containerRect = opts.container.getBoundingClientRect();
	const input = document.createElement("input");
	input.type = "text";
	input.className = "relations-edge-label-editor";
	input.value = opts.current;
	input.placeholder = opts.placeholder;
	input.maxLength = 80;
	// position: absolute and transform: translate(-50%, -50%) come from the
	// CSS class. Dynamic left/top below are template-literal assignments,
	// which the no-static-styles-assignment rule permits.
	input.style.left = `${opts.clientX - containerRect.left}px`;
	input.style.top = `${opts.clientY - containerRect.top}px`;

	let committed = false;
	const commit = async () => {
		if (committed) return;
		committed = true;
		try {
			await opts.onSave(input.value);
		} finally {
			input.remove();
		}
	};
	const cancel = () => {
		if (committed) return;
		committed = true;
		input.remove();
	};

	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			void commit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
		// Don't let Obsidian's global hotkeys fire while typing in the editor.
		e.stopPropagation();
	});
	input.addEventListener("blur", () => { void commit(); });

	opts.container.appendChild(input);
	input.focus();
	input.select();
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

function toCytoscape(
	graph: RelationsGraph,
	highlightId?: string,
	lookupLabel?: (e: GraphEdge) => string,
): ElementDefinition[] {
	const out: ElementDefinition[] = [];
	for (const n of graph.nodes) {
		const data: Record<string, unknown> = {
			id: n.id,
			label: n.label,
			image: n.image ?? "",
			hasImage: n.image ? "true" : "false",
			highlight: highlightId && n.id === highlightId ? "true" : "false",
		};
		// ringColor is set ONLY when a rule matched, so the selector
		// `node[ringColor]` (presence test) correctly distinguishes styled
		// nodes from default-ring nodes. We don't fall back to an empty
		// string here because Cytoscape's selectors can't reliably compare
		// against empty strings (see issue #1735) — using presence instead
		// avoids that whole class of bug.
		if (n.ringColor) data.ringColor = n.ringColor;
		// Badge content used by the node-badges DOM overlay. Stored on the
		// Cytoscape node data so the overlay can look up content via
		// `node.data('topLeftIcon')` without maintaining a parallel lookup map.
		// Nothing in the stylesheet reads these — they're consumed entirely
		// by the overlay layer.
		if (n.topLeftIcon) data.topLeftIcon = n.topLeftIcon;
		if (n.topRightIcon) data.topRightIcon = n.topRightIcon;
		if (n.subtext) data.subtext = n.subtext;
		out.push({ data });
	}
	for (const e of graph.edges) {
		const classes: string[] = [];
		if (e.pair) classes.push("pair");
		if (e.genealogy) classes.push("genealogy");
		if (e.lineStyle && e.lineStyle !== "solid") {
			classes.push(`ls-${e.lineStyle}`);
		}
		// userLabel: short inline label set via double-click. Cytoscape renders
		// nothing for an empty string. has-label class gates the label styling
		// so unlabelled edges don't allocate background pills.
		const userLabel = lookupLabel ? lookupLabel(e) : "";
		if (userLabel) classes.push("has-label");
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
				userLabel,
				symmetric: e.symmetric ? "true" : "false",
				// genealogy flag exposed so the dblclick label handler knows to
				// un-invert the direction when deriving the label storage key —
				// see lookupLabel above for the matching logic.
				genealogy: e.genealogy ? "true" : "false",
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
		// Per-note ring color override. Driven by frontmatter through the
		// ringColorProperty + ringColorRules settings. The presence selector
		// `node[ringColor]` matches nodes whose data has a truthy ringColor —
		// we only set the field when a rule matched, so this cleanly excludes
		// unconfigured nodes.
		//
		// Selector ordering for the ring-color / highlight / selected
		// interactions is deliberate:
		//   1. base node — default thin grey border
		//   2. node[ringColor] — coloured ring for nodes with a rule match
		//   3. node[highlight = 'true'] — focus highlight (no rule match)
		//      uses the theme accent color and the larger size
		//   4. node:selected — interactive selection color
		//   5. node[ringColor][highlight = 'true'] — focus + ring color:
		//      ring color wins (decorative color is what the user configured),
		//      but the focus's larger size still applies
		//   6. node[ringColor]:selected — selection + ring color: same idea
		// This makes the ring colour the most-specific rule when it matters,
		// so it isn't silently lost on the very note the user is reading.
		{
			selector: "node[ringColor]",
			style: {
				"border-color": "data(ringColor)",
				"border-width": 6,
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
			selector: "node[ringColor][highlight = 'true']",
			style: {
				// Ring color wins on the focus node so the user can still see
				// the value they configured. Keep the focus-larger size so
				// "this is the active note" remains visible from layout alone.
				"border-color": "data(ringColor)",
				"border-width": 6,
				"width": nodeSizeFocus,
				"height": nodeSizeFocus,
			},
		},
		{
			selector: "node[ringColor]:selected",
			style: {
				"border-color": "data(ringColor)",
				"border-width": 6,
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
			// User-set inline label (e.g. "hates them 75%"). Only edges with
			// has-label class get the label drawn — keeps the default look clean.
			selector: "edge.has-label",
			style: {
				"label": "data(userLabel)",
				"font-size": compact ? 9 : 11,
				"font-weight": 500,
				"color": theme.textNormal,
				"text-background-color": theme.bgPrimary,
				"text-background-opacity": 0.9,
				"text-background-padding": "2px",
				"text-background-shape": "roundrectangle",
				"text-border-color": theme.bgModBorder,
				"text-border-width": 1,
				"text-border-opacity": 0.6,
				"text-rotation": "autorotate",
				"text-events": "yes",
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

/** Synthetic edge type tag for informal-partnership connectors (not a configured type). */
export const INFORMAL_PARTNERSHIP_TYPE = "__informal_partnership";

/**
 * Legend representation of the synthesized informal-partnership line. Family-graph
 * mode draws a dotted grey connector between co-parents who share a child but have
 * no declared spouse/pair edge; since it isn't one of the user's configured
 * relationship types it would otherwise be absent from the legend. `pair` is false
 * here so the legend label omits the ⚭ marriage glyph — this is the unmarried case.
 */
export const INFORMAL_PARTNERSHIP_LEGEND: RelationshipType = {
	name: "informal partnership",
	color: "#888888",
	symmetric: true,
	pair: false,
	treeLayout: false,
	lineStyle: "dotted",
	genealogy: false,
};

/**
 * Compute the synthetic "informal partnership" edges for family-graph mode: a dotted
 * grey connector between each pair of co-parents (people sharing a child via genealogy
 * edges) who have no declared pair edge between them. Operates on the raw graph; safe
 * to call independently of rendering (the legend builder uses it to decide whether to
 * show the informal-partnership entry).
 */
export function synthesizeInformalPartnerships(graph: RelationsGraph): GraphEdge[] {
	// Group parents by child. Raw genealogy edges run child→parent (source=child).
	const parentsByChild = new Map<string, string[]>();
	for (const e of graph.edges) {
		if (!e.genealogy) continue;
		if (!parentsByChild.has(e.source)) parentsByChild.set(e.source, []);
		parentsByChild.get(e.source)!.push(e.target);
	}
	const declaredPairs = new Set<string>();
	for (const e of graph.edges) {
		if (!e.pair) continue;
		declaredPairs.add(pairKey(e.source, e.target));
	}
	const synthesized: GraphEdge[] = [];
	const seen = new Set<string>();
	for (const parents of parentsByChild.values()) {
		for (let i = 0; i < parents.length; i++) {
			for (let j = i + 1; j < parents.length; j++) {
				const k = pairKey(parents[i], parents[j]);
				if (declaredPairs.has(k) || seen.has(k)) continue;
				seen.add(k);
				synthesized.push({
					source: parents[i],
					target: parents[j],
					type: INFORMAL_PARTNERSHIP_TYPE,  // synthetic; not a real configured type
					color: "#888888",                  // muted grey to read as "implied, not declared"
					symmetric: true,
					pair: true,
					lineStyle: "dotted",
					genealogy: false,
				});
			}
		}
	}
	return synthesized;
}
