import { Core } from "cytoscape";
import { RelationsGraph } from "./types";
import { computeEffectiveParents } from "./family-parenting";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FamilyGroup {
	parents: string[];
	children: string[];
}

/**
 * Hooks for rendering and editing inline labels on overlay connectors.
 *
 * The overlay doesn't import the EdgeLabelStore or the editor UI directly —
 * those live in render.ts, where the key derivation and editor function are
 * already plumbed for the Cytoscape edges. The overlay just asks the hooks
 * for the current label text on a child→parent stem, and calls the hook to
 * open the editor when the user double-clicks.
 *
 * For a child with multiple parents, the overlay shows one combined label
 * per stem (each parent edge can carry a separate label; concatenated with
 * " / " if both do). Double-click edits whichever parent edge currently
 * holds the label; if neither does, the editor opens for the first parent.
 */
export interface OverlayLabelHooks {
	getGenealogyLabel(child: string, parent: string): string;
	editGenealogyLabel(child: string, parent: string, clientX: number, clientY: number): void;
}

/**
 * Orthogonal SVG connector overlay for family-graph mode.
 * Replaces Cytoscape's bezier genealogy edges with right-angle paths and
 * adds spouse-lockstep drag. Call after `applyGenerationLayout`.
 *
 * Returns a `redraw` function the caller can invoke when a label is saved
 * (since label changes don't move any nodes, the position-driven redraw
 * loop won't fire on its own). Callers without labels can ignore it.
 */
export function drawFamilyConnectors(
	cy: Core,
	graph: RelationsGraph,
	container: HTMLElement,
	compact: boolean,
	labelHooks: OverlayLabelHooks | null = null,
): () => void {
	cy.edges(".genealogy").style("opacity", 0);

	const groups = buildFamilyGroups(graph);
	const pairAdj = buildPairAdjacency(graph);
	const g = createOverlay(container);
	// All connectors share one color — per-genealogy-type differentiation not yet supported.
	const stroke = graph.edges.find((e) => e.genealogy)?.color || "#888888";
	const width = compact ? 1.5 : 2.5;
	const fontSize = compact ? 9 : 11;

	function redraw(): void {
		while (g.firstChild) g.removeChild(g.firstChild);
		for (const [, group] of groups) {
			drawGroup(g, cy, group, stroke, width, fontSize, labelHooks);
		}
	}

	redraw();
	syncViewport(cy, g);
	onPositionChange(cy, redraw);
	enableSpouseDrag(cy, pairAdj);

	return redraw;
}

/** Group children by their shared parent-set from genealogy edges.
 *  Expects the ORIGINAL graph (child→parent: e.source=child, e.target=parent).
 *  render.ts inverts edges for Cytoscape display — this must see them pre-inversion.
 *
 *  Uses computeEffectiveParents to handle the affair-child case: when a child's
 *  two parents include one with a different spouse, the spouse-having parent is
 *  dropped from the layout's parent set so the child renders as the lover's
 *  single-parent child. See family-parenting.ts for the full rule. */
function buildFamilyGroups(graph: RelationsGraph): Map<string, FamilyGroup> {
	const parentsOf = computeEffectiveParents(graph);

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

/** Symmetric adjacency map of pair (spouse/partner) connections. */
function buildPairAdjacency(
	graph: RelationsGraph,
): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	for (const e of graph.edges) {
		if (!e.pair) continue;
		if (!adj.has(e.source)) adj.set(e.source, new Set());
		if (!adj.has(e.target)) adj.set(e.target, new Set());
		adj.get(e.source)!.add(e.target);
		adj.get(e.target)!.add(e.source);
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
	// Keep child id alongside its position+radius so labels can be looked up
	// per-edge. Discarded position-only mapping made labels impossible.
	const childData = group.children
		.map((id) => ({ id, ele: cy.getElementById(id) }))
		.filter((c) => c.ele.length > 0)
		.map((c) => ({ id: c.id, pos: c.ele.position(), r: c.ele.width() / 2 }));

	if (parentEles.length === 0 || childData.length === 0) return;

	const parentPos = parentEles.map((e) => e.position());
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

	// Render the per-child stem + (if a label exists) a label, plus an
	// invisible hit zone wide enough to be double-clickable.
	const renderChildStem = (
		childId: string,
		childPos: { x: number; y: number },
		childR: number,
		stemPathD: string,
		stemTopY: number,
		stemBotY: number,
	) => {
		addPath(g, stemPathD, stroke, strokeWidth);
		if (!labelHooks) return;

		// Position the label at the midpoint of the stem's vertical extent.
		// stemTopY is where the stem meets the bar/drop; stemBotY is the top
		// of the child node circle.
		const labelX = childPos.x;
		const labelY = stemTopY + (stemBotY - stemTopY) * 0.5;

		const parents = group.parents;
		const labels = parents.map((p) => labelHooks.getGenealogyLabel(childId, p)).filter((s) => s);
		if (labels.length > 0) {
			addTextLabel(g, labels.join(" / "), labelX, labelY, fontSize, (evt) => {
				const editTarget = parents.find((p) => labelHooks.getGenealogyLabel(childId, p)) ?? parents[0];
				labelHooks.editGenealogyLabel(childId, editTarget, evt.clientX, evt.clientY);
			});
		}

		// Hit zone — invisible thick stroke along the stem so users can
		// double-click the connector (even when no label exists) to open
		// the editor. Edits the first parent that has a label, else the
		// leftmost-listed parent.
		addHitZone(g, stemPathD, (evt) => {
			const editTarget = parents.find((p) => labelHooks.getGenealogyLabel(childId, p)) ?? parents[0];
			labelHooks.editGenealogyLabel(childId, editTarget, evt.clientX, evt.clientY);
		});
	};

	if (childData.length === 1) {
		const c = childData[0];
		const stemBotY = c.pos.y - c.r;
		const stemD = Math.abs(c.pos.x - midX) < 2
			? `M${midX},${dropY} V${stemBotY}`
			: `M${midX},${dropY} H${c.pos.x} V${stemBotY}`;
		renderChildStem(c.id, c.pos, c.r, stemD, dropY, stemBotY);
		return;
	}

	const sortedX = [...childData].map((c) => c.pos.x).sort((a, b) => a - b);
	const barLeft = Math.min(sortedX[0], midX);
	const barRight = Math.max(sortedX[sortedX.length - 1], midX);

	addPath(g, `M${barLeft},${dropY} H${barRight}`, stroke, strokeWidth);

	for (const c of childData) {
		const stemBotY = c.pos.y - c.r;
		const stemD = `M${c.pos.x},${dropY} V${stemBotY}`;
		renderChildStem(c.id, c.pos, c.r, stemD, dropY, stemBotY);
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

function addPath(
	parent: SVGGElement,
	d: string,
	stroke: string,
	strokeWidth: number,
): void {
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", d);
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", stroke);
	path.setAttribute("stroke-width", String(strokeWidth));
	path.setAttribute("stroke-linecap", "square");
	parent.appendChild(path);
}

/**
 * Render a short text label centred on (x, y). Includes a background pill
 * behind the text so the connector line doesn't crash through the characters.
 * The label is double-clickable for editing.
 *
 * The parent SVG has pointer-events:none so the canvas underneath stays
 * interactive — we explicitly opt this group back in.
 */
function addTextLabel(
	parent: SVGGElement,
	text: string,
	x: number,
	y: number,
	fontSize: number,
	onDblclick: (evt: MouseEvent) => void,
): void {
	const group = document.createElementNS(SVG_NS, "g");
	group.classList.add("family-connector-label");
	// cursor: pointer and pointer-events: auto are in styles.css under
	// .family-connector-label.

	// SVG has no text-measurement API without a render pass, so we estimate
	// width from character count. 0.6em per char is a reasonable average for
	// typical UI fonts, and the pill expands to a sensible minimum so single
	// digits ("3") don't get a tiny pill.
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

/**
 * Append an invisible thick-stroke path covering the same shape as a stem,
 * so users can double-click the connector line (even with no label) to open
 * the editor. The 14px stroke width gives a clickable target wider than the
 * visible 2.5px line.
 */
function addHitZone(
	parent: SVGGElement,
	d: string,
	onDblclick: (evt: MouseEvent) => void,
): void {
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", d);
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", "transparent");
	path.setAttribute("stroke-width", "14");
	path.classList.add("relations-family-connector-hit-path");
	// cursor: pointer and pointer-events: stroke (only the stroke catches
	// clicks, not the empty fill area) come from the CSS class.
	path.addEventListener("dblclick", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onDblclick(e as MouseEvent);
	});
	parent.appendChild(path);
}
