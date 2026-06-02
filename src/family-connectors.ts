import { Core } from "cytoscape";
import { RelationsGraph } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FamilyGroup {
	parents: string[];
	children: string[];
}

/**
 * Orthogonal SVG connector overlay for family-tree mode.
 *
 * Replaces Cytoscape's bezier genealogy edges with right-angle paths (vertical
 * drops from each parent pair, horizontal distribution bars across siblings,
 * stems down to each child) and adds spouse-lockstep drag so grabbing one
 * partner moves the other in formation.
 *
 * Also draws **dashed horizontal bars** between co-parents who share a child
 * but have no declared marriage between them ("informal partnerships"). This
 * follows the classical-chart convention: solid bars indicate declared
 * marriage (drawn by Cytoscape as the pair edge), dashed bars indicate
 * inferred co-parenting without a formal union.
 *
 * Call after `applyGenerationLayout` has positioned the nodes.
 *
 * @param informalPartnerships  list of `[a, b]` node-id pairs to render with a
 *                              dashed bar. Empty list = none.
 */
/**
 * Hooks for rendering and editing inline labels on overlay connectors.
 *
 * The overlay doesn't know about the EdgeLabelStore or the editor UI directly —
 * it just asks `getGenealogyLabel`/`getInformalLabel` for the current text to
 * draw, and calls `editGenealogyLabel`/`editInformalLabel` when the user
 * double-clicks an overlay text element. render.ts wires both halves.
 */
export interface OverlayLabelHooks {
	getGenealogyLabel(child: string, parent: string): string;
	getInformalLabel(a: string, b: string): string;
	editGenealogyLabel(child: string, parent: string, clientX: number, clientY: number): void;
	editInformalLabel(a: string, b: string, clientX: number, clientY: number): void;
}

export function drawFamilyConnectors(
	cy: Core,
	graph: RelationsGraph,
	container: HTMLElement,
	compact: boolean,
	informalPartnerships: Array<[string, string]> = [],
	labelHooks: OverlayLabelHooks | null = null,
): void {
	cy.edges(".genealogy").style("opacity", 0);

	const groups = buildFamilyGroups(graph);
	// Build pair adjacency including informal partnerships, so dragging one
	// informal co-parent moves the other in lockstep too — consistent with how
	// declared spouses behave.
	const pairAdj = buildPairAdjacency(graph, informalPartnerships);
	const g = createOverlay(container);
	const stroke = graph.edges.find((e) => e.genealogy)?.color || "#888888";
	const width = compact ? 1.5 : 2.5;
	const fontSize = compact ? 9 : 11;

	function redraw(): void {
		while (g.firstChild) g.removeChild(g.firstChild);
		// Family-unit connectors (drops, sibling bars, child stems).
		for (const [, group] of groups) {
			drawGroup(g, cy, group, stroke, width, fontSize, labelHooks);
		}
		// Informal-partnership dashed bars. Drawn after the family connectors so
		// they sit on top in case of any visual overlap.
		for (const [a, b] of informalPartnerships) {
			drawInformalPartnership(g, cy, a, b, stroke, width, fontSize, labelHooks);
		}
	}

	redraw();
	syncViewport(cy, g);
	onPositionChange(cy, redraw);
	enableSpouseDrag(cy, pairAdj);
}

/** Group children by their shared parent-set from genealogy edges. */
function buildFamilyGroups(graph: RelationsGraph): Map<string, FamilyGroup> {
	const parentsOf = new Map<string, string[]>();
	for (const e of graph.edges) {
		if (!e.genealogy) continue;
		if (!parentsOf.has(e.source)) parentsOf.set(e.source, []);
		parentsOf.get(e.source)!.push(e.target);
	}

	const groups = new Map<string, FamilyGroup>();
	for (const [child, parents] of parentsOf) {
		const sorted = [...parents].sort();
		const key = sorted.join("|");
		if (!groups.has(key)) {
			groups.set(key, { parents: sorted, children: [] });
		}
		groups.get(key)!.children.push(child);
	}
	return groups;
}

/**
 * Symmetric adjacency map of pair connections — declared (spouse-flag) plus
 * informal (inferred co-parents). Used by spouse-lockstep drag so both kinds
 * of partner relationships move together when grabbed.
 */
function buildPairAdjacency(
	graph: RelationsGraph,
	informalPartnerships: Array<[string, string]>,
): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	const addPair = (a: string, b: string) => {
		if (!adj.has(a)) adj.set(a, new Set());
		if (!adj.has(b)) adj.set(b, new Set());
		adj.get(a)!.add(b);
		adj.get(b)!.add(a);
	};
	for (const e of graph.edges) {
		if (e.pair) addPair(e.source, e.target);
	}
	for (const [a, b] of informalPartnerships) {
		addPair(a, b);
	}
	return adj;
}

/** Create (or replace) the SVG overlay element inside the container. */
function createOverlay(container: HTMLElement): SVGGElement {
	container.querySelector("svg.family-connectors-svg")?.remove();

	const svg = document.createElementNS(SVG_NS, "svg");
	svg.classList.add("family-connectors-svg");
	Object.assign(svg.style, {
		position: "absolute",
		top: "0",
		left: "0",
		width: "100%",
		height: "100%",
		pointerEvents: "none",
		overflow: "visible",
	});
	container.appendChild(svg);

	const g = document.createElementNS(SVG_NS, "g");
	svg.appendChild(g);
	return g;
}

/** Draw orthogonal connectors for one parent-set → children unit. */
function drawGroup(
	g: SVGGElement,
	cy: Core,
	group: FamilyGroup,
	stroke: string,
	strokeWidth: number,
	fontSize: number,
	labelHooks: OverlayLabelHooks | null,
): void {
	const parentEles = group.parents
		.map((id) => cy.getElementById(id))
		.filter((e) => e.length > 0);
	const childEles = group.children
		.map((id) => ({ id, ele: cy.getElementById(id) }))
		.filter((e) => e.ele.length > 0);

	if (parentEles.length === 0 || childEles.length === 0) return;

	const parentPos = parentEles.map((e) => e.position());
	// Keep child ids alongside positions so we can look up per-edge labels.
	const childData = childEles.map((c) => ({ id: c.id, pos: c.ele.position(), r: c.ele.width() / 2 }));
	const parentR = Math.max(...parentEles.map((e) => e.width() / 2));
	const childRMax = Math.max(...childData.map((c) => c.r));

	const midX = parentPos.reduce((s, p) => s + p.x, 0) / parentPos.length;
	const maxParentY = Math.max(...parentPos.map((p) => p.y));
	const minChildY = Math.min(...childData.map((c) => c.pos.y));

	const gapTop = maxParentY + parentR;
	const gapBot = Math.max(minChildY - childRMax, gapTop + 20);
	const dropY = gapTop + (gapBot - gapTop) * 0.3;

	// Two-parent: drop from the pair-edge midpoint. Single: from node bottom.
	const dropStartY =
		parentPos.length === 2
			? (parentPos[0].y + parentPos[1].y) / 2
			: gapTop;

	addPath(g, `M${midX},${dropStartY} V${dropY}`, stroke, strokeWidth);

	// Helper to add a clickable hit-zone path on top of (or in place of) a
	// visible path. Each stem gets one so users can double-click the line to
	// edit the label, even when there's no existing label text to click on.
	// The hit-zone is invisible but receives pointer events on its stroke.
	const addHitZone = (d: string, onDblclick: (evt: MouseEvent) => void) => {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", d);
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", "transparent");
		path.setAttribute("stroke-width", "14");
		path.style.cursor = "pointer";
		path.style.pointerEvents = "stroke";
		path.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			onDblclick(e as MouseEvent);
		});
		g.appendChild(path);
	};

	// Helper to render a label for one child's stem. Each child has one
	// parent→child edge per parent in the unit, but a single visible stem. We
	// place a combined label there if any parent→child edge has a saved label
	// (concatenated with " / " if multiple). Double-clicking the label opens
	// the editor for whichever parent currently holds the label.
	const renderChildLabel = (childId: string, stemX: number, stemY1: number, stemY2: number) => {
		if (!labelHooks) return;
		const parents = group.parents;
		const labels = parents.map((p) => labelHooks.getGenealogyLabel(childId, p)).filter((s) => s);
		if (labels.length === 0) return;
		const text = labels.join(" / ");
		const midY = stemY1 + (stemY2 - stemY1) * 0.5;
		addTextLabel(g, text, stemX, midY, stroke, fontSize, (evt) => {
			const editTarget = parents.find((p) => labelHooks.getGenealogyLabel(childId, p)) ?? parents[0];
			labelHooks.editGenealogyLabel(childId, editTarget, evt.clientX, evt.clientY);
		});
	};

	// Add a hit-zone over the stem so users can double-click it (label or no
	// label) to open the editor. We bind to the leftmost parent for new labels.
	const addStemHitZone = (childId: string, d: string) => {
		if (!labelHooks) return;
		addHitZone(d, (evt) => {
			const parents = group.parents;
			const editTarget = parents.find((p) => labelHooks.getGenealogyLabel(childId, p)) ?? parents[0];
			labelHooks.editGenealogyLabel(childId, editTarget, evt.clientX, evt.clientY);
		});
	};

	if (childData.length === 1) {
		const c = childData[0];
		const stemTopY = dropY;
		const stemBotY = c.pos.y - c.r;
		const stemD = Math.abs(c.pos.x - midX) < 2
			? `M${midX},${dropY} V${stemBotY}`
			: `M${midX},${dropY} H${c.pos.x} V${stemBotY}`;
		addPath(g, stemD, stroke, strokeWidth);
		addStemHitZone(c.id, stemD);
		renderChildLabel(c.id, c.pos.x, stemTopY, stemBotY);
		return;
	}

	const sortedX = [...childData].map((c) => c.pos.x).sort((a, b) => a - b);
	const barLeft = Math.min(sortedX[0], midX);
	const barRight = Math.max(sortedX[sortedX.length - 1], midX);

	addPath(g, `M${barLeft},${dropY} H${barRight}`, stroke, strokeWidth);

	for (const c of childData) {
		const stemBotY = c.pos.y - c.r;
		const stemD = `M${c.pos.x},${dropY} V${stemBotY}`;
		addPath(g, stemD, stroke, strokeWidth);
		addStemHitZone(c.id, stemD);
		renderChildLabel(c.id, c.pos.x, dropY, stemBotY);
	}
}

/** Keep the SVG group transform in sync with Cytoscape's viewport. */
function syncViewport(cy: Core, g: SVGGElement): void {
	function sync(): void {
		const pan = cy.pan();
		const zoom = cy.zoom();
		g.setAttribute(
			"transform",
			`translate(${pan.x},${pan.y}) scale(${zoom})`,
		);
	}
	cy.on("pan zoom resize", sync);
	sync();
}

/** Redraw connectors when any node moves, coalesced to one repaint per frame. */
function onPositionChange(cy: Core, redraw: () => void): void {
	let scheduled = false;
	cy.on("position", "node", () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			redraw();
		});
	});
}

/** Move pair-connected partners in lockstep when a node is dragged. */
function enableSpouseDrag(
	cy: Core,
	pairAdj: Map<string, Set<string>>,
): void {
	let partners: Array<{ id: string; offsetX: number; offsetY: number }> = [];

	cy.on("grab", "node", (evt) => {
		const node = evt.target;
		const neighbors = pairAdj.get(node.id() as string);
		if (!neighbors?.size) {
			partners = [];
			return;
		}
		const np = node.position();
		partners = [];
		for (const pid of neighbors) {
			const partner = cy.getElementById(pid);
			if (!partner.length) continue;
			const pp = partner.position();
			partners.push({
				id: pid,
				offsetX: pp.x - np.x,
				offsetY: pp.y - np.y,
			});
		}
	});

	cy.on("drag", "node", (evt) => {
		if (partners.length === 0) return;
		const np = evt.target.position();
		for (const p of partners) {
			cy.getElementById(p.id).position({
				x: np.x + p.offsetX,
				y: np.y + p.offsetY,
			});
		}
	});

	cy.on("free", "node", () => {
		partners = [];
	});
}

/**
 * Draw a dashed horizontal bar between two co-parents who share a child but
 * have no declared marriage. The bar sits at the average Y of the two nodes,
 * spanning from one centre to the other. Following classical-chart convention:
 * solid bar = declared marriage (rendered by Cytoscape as the pair edge),
 * dashed bar = informal partnership (rendered here).
 *
 * If the nodes are on noticeably different Y levels (e.g. one was dragged), we
 * use a small bent path so the bar still reads as connecting the pair without
 * crossing diagonally through other elements.
 */
function drawInformalPartnership(
	g: SVGGElement,
	cy: Core,
	aId: string,
	bId: string,
	stroke: string,
	strokeWidth: number,
	fontSize: number,
	labelHooks: OverlayLabelHooks | null,
): void {
	const a = cy.getElementById(aId);
	const b = cy.getElementById(bId);
	if (!a.length || !b.length) return;

	const ap = a.position();
	const bp = b.position();
	const ar = a.width() / 2;
	const br = b.width() / 2;

	// Sort left-to-right so the bar runs in a consistent direction.
	const [leftPos, leftR, rightPos, rightR] =
		ap.x <= bp.x ? [ap, ar, bp, br] : [bp, br, ap, ar];

	// Edge-to-edge horizontal extent so the bar stops at the node circumference
	// rather than disappearing inside the portraits.
	const x1 = leftPos.x + leftR;
	const x2 = rightPos.x - rightR;
	if (x2 <= x1) return;  // nodes overlap or are touching — nothing to draw

	let pathD: string;
	let labelX: number;
	let labelY: number;
	if (Math.abs(leftPos.y - rightPos.y) < 4) {
		// Same Y: straight horizontal dashed bar.
		const y = (leftPos.y + rightPos.y) / 2;
		pathD = `M${x1},${y} H${x2}`;
		labelX = (x1 + x2) / 2;
		labelY = y;
	} else {
		// Different Y: small bent path that hugs the midpoint between the two nodes.
		const midY = (leftPos.y + rightPos.y) / 2;
		pathD = `M${x1},${leftPos.y} V${midY} H${x2} V${rightPos.y}`;
		labelX = (x1 + x2) / 2;
		labelY = midY;
	}

	addPath(g, pathD, stroke, strokeWidth, true);

	// Hit zone for editing — covers the same path with a wider, transparent
	// stroke so double-clicking the bar opens the label editor.
	if (labelHooks) {
		const hit = document.createElementNS(SVG_NS, "path");
		hit.setAttribute("d", pathD);
		hit.setAttribute("fill", "none");
		hit.setAttribute("stroke", "transparent");
		hit.setAttribute("stroke-width", "14");
		hit.style.cursor = "pointer";
		hit.style.pointerEvents = "stroke";
		hit.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			labelHooks.editInformalLabel(aId, bId, e.clientX, e.clientY);
		});
		g.appendChild(hit);

		// Existing label, if any.
		const text = labelHooks.getInformalLabel(aId, bId);
		if (text) {
			addTextLabel(g, text, labelX, labelY, stroke, fontSize, (evt) => {
				labelHooks.editInformalLabel(aId, bId, evt.clientX, evt.clientY);
			});
		}
	}
}

function addPath(
	parent: SVGGElement,
	d: string,
	stroke: string,
	strokeWidth: number,
	dashed = false,
): void {
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", d);
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", stroke);
	path.setAttribute("stroke-width", String(strokeWidth));
	path.setAttribute("stroke-linecap", "square");
	if (dashed) {
		// Dash pattern scaled to stroke width so it reads clearly at any size.
		const dashLen = Math.max(4, strokeWidth * 3);
		path.setAttribute("stroke-dasharray", `${dashLen} ${dashLen * 0.7}`);
	}
	parent.appendChild(path);
}

/**
 * Render a text label centred on (x, y) inside the overlay. Includes a
 * background rectangle that sits behind the text so the connector line doesn't
 * crash through the characters. The label is double-clickable for editing.
 *
 * Text doesn't inherit the parent SVG's pointer-events:none — we explicitly
 * enable pointer events on the text and background so they receive the click.
 */
function addTextLabel(
	parent: SVGGElement,
	text: string,
	x: number,
	y: number,
	color: string,
	fontSize: number,
	onDblclick: (evt: MouseEvent) => void,
): void {
	const group = document.createElementNS(SVG_NS, "g");
	group.classList.add("family-connector-label");
	group.style.cursor = "pointer";
	group.style.pointerEvents = "auto";

	// Rough text width estimate based on character count and font size — SVG
	// doesn't expose a measurement API without a render pass. 0.6em per char
	// is a reasonable average for typical UI fonts.
	const charW = fontSize * 0.6;
	const padX = 4;
	const padY = 2;
	const w = Math.max(20, text.length * charW + padX * 2);
	const h = fontSize + padY * 2;

	const bg = document.createElementNS(SVG_NS, "rect");
	bg.setAttribute("x", String(x - w / 2));
	bg.setAttribute("y", String(y - h / 2));
	bg.setAttribute("width", String(w));
	bg.setAttribute("height", String(h));
	bg.setAttribute("rx", "3");
	bg.setAttribute("ry", "3");
	bg.setAttribute("fill", "var(--background-primary)");
	bg.setAttribute("fill-opacity", "0.92");
	bg.setAttribute("stroke", "var(--background-modifier-border)");
	bg.setAttribute("stroke-width", "1");
	group.appendChild(bg);

	const t = document.createElementNS(SVG_NS, "text");
	t.setAttribute("x", String(x));
	t.setAttribute("y", String(y));
	t.setAttribute("text-anchor", "middle");
	t.setAttribute("dominant-baseline", "central");
	t.setAttribute("font-size", String(fontSize));
	t.setAttribute("font-weight", "500");
	t.setAttribute("fill", "var(--text-normal)");
	t.textContent = text;
	group.appendChild(t);

	group.addEventListener("dblclick", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onDblclick(e as MouseEvent);
	});

	parent.appendChild(group);
}
