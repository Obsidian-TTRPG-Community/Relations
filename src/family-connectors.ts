import { Core } from "cytoscape";
import { RelationsGraph } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

interface FamilyGroup {
	parents: string[];
	children: string[];
}

/**
 * Orthogonal SVG connector overlay for family-graph mode.
 * Replaces Cytoscape's bezier genealogy edges with right-angle paths and
 * adds spouse-lockstep drag. Call after `applyGenerationLayout`.
 */
export function drawFamilyConnectors(
	cy: Core,
	graph: RelationsGraph,
	container: HTMLElement,
	compact: boolean,
): void {
	cy.edges(".genealogy").style("opacity", 0);

	const groups = buildFamilyGroups(graph);
	const pairAdj = buildPairAdjacency(graph);
	const g = createOverlay(container);
	// All connectors share one color — per-genealogy-type differentiation not yet supported.
	const stroke = graph.edges.find((e) => e.genealogy)?.color || "#888888";
	const width = compact ? 1.5 : 2.5;

	function redraw(): void {
		while (g.firstChild) g.removeChild(g.firstChild);
		for (const [, group] of groups) {
			drawGroup(g, cy, group, stroke, width);
		}
	}

	redraw();
	syncViewport(cy, g);
	onPositionChange(cy, redraw);
	enableSpouseDrag(cy, pairAdj);
}

/** Group children by their shared parent-set from genealogy edges.
 *  Expects the ORIGINAL graph (child→parent: e.source=child, e.target=parent).
 *  render.ts inverts edges for Cytoscape display — this must see them pre-inversion. */
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
): void {
	const parentEles = group.parents
		.map((id) => cy.getElementById(id))
		.filter((e) => e.length > 0);
	const childEles = group.children
		.map((id) => cy.getElementById(id))
		.filter((e) => e.length > 0);

	if (parentEles.length === 0 || childEles.length === 0) return;

	const parentPos = parentEles.map((e) => e.position());
	const childPos = childEles.map((e) => e.position());
	const parentR = Math.max(...parentEles.map((e) => e.width() / 2));
	const childR = Math.max(...childEles.map((e) => e.width() / 2));

	const midX = parentPos.reduce((s, p) => s + p.x, 0) / parentPos.length;
	const maxParentY = Math.max(...parentPos.map((p) => p.y));
	const minChildY = Math.min(...childPos.map((p) => p.y));

	const gapTop = maxParentY + parentR;
	const gapBot = Math.max(minChildY - childR, gapTop + 20);
	const dropY = gapTop + (gapBot - gapTop) * 0.3;

	// Two-parent: drop from the pair-edge midpoint. Single: from node bottom.
	const dropStartY =
		parentPos.length === 2
			? (parentPos[0].y + parentPos[1].y) / 2
			: gapTop;

	addPath(g, `M${midX},${dropStartY} V${dropY}`, stroke, strokeWidth);

	if (childPos.length === 1) {
		const cx = childPos[0].x;
		const cy_ = childPos[0].y;
		if (Math.abs(cx - midX) < 2) {
			addPath(g, `M${midX},${dropY} V${cy_ - childR}`, stroke, strokeWidth);
		} else {
			addPath(g, `M${midX},${dropY} H${cx} V${cy_ - childR}`, stroke, strokeWidth);
		}
		return;
	}

	const sorted = [...childPos].sort((a, b) => a.x - b.x);
	const barLeft = Math.min(sorted[0].x, midX);
	const barRight = Math.max(sorted[sorted.length - 1].x, midX);

	addPath(g, `M${barLeft},${dropY} H${barRight}`, stroke, strokeWidth);

	for (const cp of childPos) {
		addPath(g, `M${cp.x},${dropY} V${cp.y - childR}`, stroke, strokeWidth);
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
