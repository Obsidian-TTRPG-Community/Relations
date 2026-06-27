import { Core, NodeSingular } from "cytoscape";

/**
 * Node badges: small DOM overlays pinned to each node's corners and below it,
 * driven by frontmatter through configurable property names (top-left,
 * top-right, bottom-left and bottom-right corner icons, plus subtext).
 *
 * Why DOM overlay rather than the Cytoscape stylesheet:
 *   - Cytoscape gives one label and one background image per node. Three
 *     independently positioned badge slots can't be expressed in that model
 *     without compromise. A DOM layer above the canvas can position anything
 *     anywhere and supports any text styling (italics for subtext, etc.).
 *   - DOM emoji rendering is reliable; canvas-based emoji rendering can be
 *     inconsistent across browsers and platforms.
 *
 * Trade-offs we accept:
 *   - The overlay must redraw on every pan/zoom/node-move event to stay
 *     pinned. We use requestAnimationFrame coalescing inside the redraw
 *     handler to avoid thrashing when many events fire close together.
 *   - DOM nodes don't scale with Cytoscape's zoom. Badges stay constant
 *     screen-size as the user zooms in or out. This is what we want for
 *     readability — emojis at 8px aren't useful — but it does mean the
 *     visual relationship between badge and node changes with zoom.
 *
 * Empty content is the explicit "skip this slot" signal. A node with no
 * corner icons and no subtext gets no DOM nodes at all, keeping the overlay
 * minimal even on large graphs where most nodes have no badges.
 */

/**
 * Set up the badge overlay layer on top of an existing Cytoscape instance.
 * Returns a redraw function the caller can invoke when something has changed
 * that isn't a viewport event (e.g. the host note for the highlight changed,
 * or a different `showLabels` setting is being applied).
 *
 * Pass `enabled = false` to disable the overlay entirely. The overlay's DOM
 * gets emptied and event listeners removed; callers swapping modes can call
 * this with the appropriate enabled state without reinstantiating.
 */
export function setupNodeBadges(
	cy: Core,
	container: HTMLElement,
	enabled: boolean,
): () => void {
	// Find or create the overlay container. The host element is the same
	// container Cytoscape renders into — we lay our own absolute-positioned
	// div over it so badges sit on top of the canvas.
	let overlay = container.querySelector<HTMLDivElement>(
		":scope > .relations-node-badges",
	);
	if (!overlay) {
		overlay = activeDocument.createElement("div");
		overlay.className = "relations-node-badges";
		// Layout, positioning, z-index, pointer-events, overflow all live in
		// styles.css under .relations-node-badges.

		// Cytoscape's container needs to be positioned for our absolute
		// overlay to land in the right coordinate space. We add a class
		// that sets position: relative if the container isn't already
		// positioned. The class is idempotent — adding twice is safe.
		const cs = window.getComputedStyle(container);
		if (cs.position === "static") {
			container.classList.add("relations-cy-container");
		}
		container.appendChild(overlay);
	}

	if (!enabled) {
		overlay.empty();
		return () => {
			/* disabled mode — no-op redraw */
		};
	}

	// One badge-group div per node id. We reuse divs across redraws to avoid
	// the GC churn of recreating every frame; only content changes touch DOM.
	const groups = new Map<string, BadgeGroup>();

	function ensureGroup(nodeId: string): BadgeGroup {
		const existing = groups.get(nodeId);
		if (existing) return existing;
		const el = activeDocument.createElement("div");
		el.className = "relations-node-badge-group";
		// Group's position/pointer-events/initial left+top live in styles.css
		// under .relations-node-badge-group. Per-frame left/top are set
		// dynamically via template-literal assignments in positionGroup().

		const tl = makeBadgeSpan("top-left");
		const tr = makeBadgeSpan("top-right");
		const bl = makeBadgeSpan("bottom-left");
		const br = makeBadgeSpan("bottom-right");
		const sub = makeSubtextSpan();

		el.appendChild(tl);
		el.appendChild(tr);
		el.appendChild(bl);
		el.appendChild(br);
		el.appendChild(sub);
		overlay!.appendChild(el);

		const group: BadgeGroup = { el, tl, tr, bl, br, sub, lastContent: "" };
		groups.set(nodeId, group);
		return group;
	}

	function redraw() {
		if (!overlay) return;
		const seen = new Set<string>();
		// Read zoom once per frame so every badge in this pass uses the same
		// value. Cytoscape's zoom is stable during a frame but accessing it
		// per-node would be wasteful.
		const zoom = cy.zoom();
		cy.nodes().forEach((node) => {
			const tlText = (node.data("topLeftIcon") as string) || "";
			const trText = (node.data("topRightIcon") as string) || "";
			const blText = (node.data("bottomLeftIcon") as string) || "";
			const brText = (node.data("bottomRightIcon") as string) || "";
			const subText = (node.data("subtext") as string) || "";
			// Skip nodes with no content entirely — no DOM allocated for them.
			if (!tlText && !trText && !blText && !brText && !subText) {
				const stale = groups.get(node.id());
				if (stale) {
					stale.el.remove();
					groups.delete(node.id());
				}
				return;
			}
			seen.add(node.id());
			const g = ensureGroup(node.id());

			// Update text only if changed — avoid touching DOM when nothing
			// substantive moved between frames.
			const contentSig = `${tlText}|${trText}|${blText}|${brText}|${subText}`;
			if (g.lastContent !== contentSig) {
				g.tl.textContent = tlText;
				g.tr.textContent = trText;
				g.bl.textContent = blText;
				g.br.textContent = brText;
				g.sub.textContent = subText;
				// Show/hide each individually based on content.
				g.tl.style.display = tlText ? "inline-block" : "none";
				g.tr.style.display = trText ? "inline-block" : "none";
				g.bl.style.display = blText ? "inline-block" : "none";
				g.br.style.display = brText ? "inline-block" : "none";
				g.sub.style.display = subText ? "block" : "none";
				g.lastContent = contentSig;
			}

			positionGroup(g, node, zoom, !!(blText || brText));
		});

		// GC any groups whose nodes are no longer in the graph (e.g. after a
		// scope change replaced the elements).
		for (const [id, group] of groups) {
			if (!seen.has(id)) {
				group.el.remove();
				groups.delete(id);
			}
		}
	}

	// Coalesce repeated redraw triggers (pan + zoom + position fire together
	// during layout settle) into one rAF tick. Without this we'd do dozens
	// of redraw passes during a single layout animation frame.
	let rafScheduled = false;
	function scheduleRedraw() {
		if (rafScheduled) return;
		rafScheduled = true;
		window.requestAnimationFrame(() => {
			rafScheduled = false;
			redraw();
		});
	}

	cy.on("pan zoom resize render", scheduleRedraw);
	cy.on("position", "node", scheduleRedraw);
	cy.on("add remove", "node", scheduleRedraw);
	cy.on("data", "node", scheduleRedraw);
	// Layout completion isn't a position event for every node — explicitly
	// listen for it so badges settle into final position when a layout finishes.
	cy.on("layoutstop", scheduleRedraw);

	// Initial paint.
	scheduleRedraw();

	return scheduleRedraw;
}

interface BadgeGroup {
	el: HTMLDivElement;
	tl: HTMLSpanElement;  // top-left icon
	tr: HTMLSpanElement;  // top-right icon
	bl: HTMLSpanElement;  // bottom-left icon
	br: HTMLSpanElement;  // bottom-right icon
	sub: HTMLSpanElement; // subtext below the node
	lastContent: string;  // signature of last-rendered text content (cheap dirty check)
}

function makeBadgeSpan(
	corner: "top-left" | "top-right" | "bottom-left" | "bottom-right",
): HTMLSpanElement {
	const el = activeDocument.createElement("span");
	el.className = `relations-node-badge relations-node-badge-${corner}`;
	// All static styling (position, padding, border, font, colors,
	// transform-origin per corner) lives in styles.css under
	// .relations-node-badge and .relations-node-badge-top-left /
	// .relations-node-badge-top-right.
	return el;
}

function makeSubtextSpan(): HTMLSpanElement {
	const el = activeDocument.createElement("span");
	el.className = "relations-node-badge relations-node-subtext";
	// Static styling lives in styles.css under .relations-node-subtext.
	// Per-frame left/top/transform are set in positionGroup() via template-
	// literal assignments which the static-styles lint rule permits.
	return el;
}

/**
 * Position a badge group relative to its node's rendered position, scaled
 * uniformly with Cytoscape's current zoom level so badges remain
 * proportional to the portrait at every zoom.
 *
 * Approach: each badge has its natural (zoom = 1) size defined in CSS — font,
 * padding, border radius. At redraw time we apply `transform: scale(z)` with
 * a corner-specific `transform-origin` so the badge anchors to the node
 * corner regardless of how big the scaled badge becomes.
 *
 * To make the anchor math simple, we position the badges using the CSS
 * properties that match the desired anchor:
 *   - Top-left icon: positioned via `right`/`bottom` from the group origin,
 *     so its bottom-right corner sits at the node's top-left. transform-origin
 *     100% 100% then scales away from that corner upward-and-leftward.
 *   - Top-right icon: positioned via `left`/`bottom` (mirror).
 *   - Subtext: positioned via `left` (centred manually with translateX(-50%)),
 *     transform-origin 50% 0% so scaling expands downward from the top edge.
 *
 * Cytoscape's `renderedPosition()` and `renderedWidth/Height()` already give
 * us zoom-correct viewport coordinates, so the node-corner positions don't
 * need additional scaling — only the badge's own visual size does, via the
 * scale transform.
 */
function positionGroup(
	group: BadgeGroup,
	node: NodeSingular,
	zoom: number,
	hasBottomBadge: boolean,
): void {
	const pos = node.renderedPosition();
	const w = node.renderedWidth();
	const h = node.renderedHeight();
	const halfW = w / 2;
	const halfH = h / 2;

	// Group origin sits at the node centre in screen pixels.
	group.el.style.left = `${pos.x}px`;
	group.el.style.top = `${pos.y}px`;

	// Anchor badges to the ring itself (the visible edge of the circular node)
	// rather than to the bounding-box corner. The ring at the top-left
	// diagonal sits at (-radius·cos45°, -radius·sin45°) from the node centre,
	// which is closer in than the bounding box corner. With this anchoring
	// the badge's inner corner touches the ring at 45°, the body extends
	// out-and-up without floating away from the node.
	//
	// SQRT_HALF ≈ 0.7071 is cos(45°) = sin(45°), the projection of the
	// radius onto each axis at the diagonal.
	const radius = halfW; // node is a circle: width == height
	const SQRT_HALF = 0.7071067811865476;
	const ringX = radius * SQRT_HALF;
	const ringY = radius * SQRT_HALF;

	// Top-left icon: positioned via `right`/`bottom` so its bottom-right
	// corner sits at (-ringX, -ringY) from group origin — exactly on the
	// ring at the top-left diagonal. transform-origin (100% 100%) and the
	// `left: auto; top: auto` overrides come from the CSS class
	// .relations-node-badge-top-left.
	group.tl.style.right = `${ringX}px`;
	group.tl.style.bottom = `${ringY}px`;
	group.tl.style.transform = `scale(${zoom})`;

	// Top-right icon: mirror — bottom-LEFT corner sits at (ringX, -ringY).
	// transform-origin (0% 100%) and `right: auto; top: auto` overrides come
	// from .relations-node-badge-top-right.
	group.tr.style.left = `${ringX}px`;
	group.tr.style.bottom = `${ringY}px`;
	group.tr.style.transform = `scale(${zoom})`;

	// Bottom-left icon: vertical mirror of top-left. Its TOP-RIGHT corner sits
	// at (-ringX, +ringY), on the ring at the bottom-left diagonal. Positioned
	// via `right`/`top`; transform-origin (100% 0%) and the `left: auto;
	// bottom: auto` overrides come from .relations-node-badge-bottom-left.
	group.bl.style.right = `${ringX}px`;
	group.bl.style.top = `${ringY}px`;
	group.bl.style.transform = `scale(${zoom})`;

	// Bottom-right icon: mirror — its TOP-LEFT corner sits at (ringX, +ringY).
	// transform-origin (0% 0%) and `right: auto; bottom: auto` overrides come
	// from .relations-node-badge-bottom-right.
	group.br.style.left = `${ringX}px`;
	group.br.style.top = `${ringY}px`;
	group.br.style.transform = `scale(${zoom})`;

	// Subtext: centred horizontally beneath the node. Positioned via the
	// bottom of the bounding box (halfH below centre) plus a gap that
	// scales with zoom. The default 24px clears the Cytoscape label pill that
	// renders the note name. When bottom-corner badges are present the name
	// label is pushed lower (see render.ts node[hasBottomBadge]), so the
	// subtext needs a correspondingly larger gap to sit below it rather than
	// on top of it. transform-origin (50% 0%) lives in the CSS class so
	// static-styles lint is happy; translateX(-50%) centres horizontally after
	// scaling and is combined with the per-frame scale in one transform here.
	const subGap = (hasBottomBadge ? 34 : 24) * zoom;
	group.sub.style.left = `0px`;
	group.sub.style.top = `${halfH + subGap}px`;
	group.sub.style.transform = `translateX(-50%) scale(${zoom})`;
}
