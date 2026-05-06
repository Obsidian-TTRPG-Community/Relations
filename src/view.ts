import { ItemView, WorkspaceLeaf, TFile, debounce } from "obsidian";
import { Core } from "cytoscape";
import type RelationsPlugin from "./main";
import { VIEW_TYPE_RELATIONS, GraphMode, RelationsGraph } from "./types";
import { renderGraph } from "./render";
import { buildFullGraph, buildLocalGraph } from "./graph";

export class RelationsView extends ItemView {
	private plugin: RelationsPlugin;
	private cy: Core | null = null;
	private canvas: HTMLElement | null = null;
	private legendEl: HTMLElement | null = null;
	private modeBtnFull: HTMLButtonElement | null = null;
	private modeBtnLocal: HTMLButtonElement | null = null;
	private depthInput: HTMLInputElement | null = null;
	private familyTreeBtn: HTMLButtonElement | null = null;
	private subtitleEl: HTMLElement | null = null;
	private mode: GraphMode = "full";
	private currentLocalDepth = 2;

	// Track active file so we re-render when the user navigates between notes
	private debouncedRender = debounce(() => this.render(), 150, true);

	constructor(leaf: WorkspaceLeaf, plugin: RelationsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentLocalDepth = plugin.settings.localGraphDepth;
	}

	getViewType(): string { return VIEW_TYPE_RELATIONS; }
	getDisplayText(): string { return "Relations"; }
	getIcon(): string { return "users"; }

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("relations-root");

		// Toolbar
		const toolbar = root.createDiv({ cls: "relations-toolbar" });

		const modeGroup = toolbar.createDiv({ cls: "relations-mode-toggle" });
		this.modeBtnFull = modeGroup.createEl("button", { text: "Full" });
		this.modeBtnLocal = modeGroup.createEl("button", { text: "Active note" });
		this.modeBtnFull.addEventListener("click", () => this.setMode("full"));
		this.modeBtnLocal.addEventListener("click", () => this.setMode("local"));

		// Depth control (only meaningful in local mode)
		const depthWrap = toolbar.createDiv({ cls: "relations-depth-wrap" });
		depthWrap.createEl("label", { text: "Depth:", cls: "relations-depth-label" });
		this.depthInput = depthWrap.createEl("input", { type: "number" });
		this.depthInput.min = "1";
		this.depthInput.max = "6";
		this.depthInput.value = String(this.currentLocalDepth);
		this.depthInput.addEventListener("change", () => {
			const v = parseInt(this.depthInput!.value, 10);
			if (!isNaN(v) && v > 0 && v <= 6) {
				this.currentLocalDepth = v;
				if (this.mode === "local") this.render();
			}
		});

		const spacer = toolbar.createDiv({ cls: "relations-spacer" });
		spacer.style.flex = "1";

		// Family-tree mode toggle. Persists in plugin settings so it's sticky across
		// reloads. When on, the dagre + spouse-pair + children-under-midpoint layout
		// is used instead of fcose force-directed.
		this.familyTreeBtn = toolbar.createEl("button", { text: "Family tree" });
		this.familyTreeBtn.title = "Toggle family-tree layout";
		this.familyTreeBtn.addEventListener("click", async () => {
			this.plugin.settings.familyTree = !this.plugin.settings.familyTree;
			await this.plugin.saveSettings();
			this.updateFamilyTreeButton();
			this.render();
		});
		this.updateFamilyTreeButton();

		const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
		refreshBtn.addEventListener("click", () => this.render());
		const fitBtn = toolbar.createEl("button", { text: "Fit" });
		fitBtn.addEventListener("click", () => this.cy?.fit(undefined, 40));

		this.subtitleEl = root.createDiv({ cls: "relations-subtitle" });
		this.canvas = root.createDiv({ cls: "relations-canvas" });
		this.legendEl = root.createDiv({ cls: "relations-legend" });

		// Re-render when active file changes (only matters in local mode)
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.mode === "local") this.debouncedRender();
			}),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				if (this.mode === "local") this.debouncedRender();
			}),
		);

		this.updateModeButtons();
		this.render();
	}

	async onClose(): Promise<void> {
		this.cy?.destroy();
		this.cy = null;
	}

	setMode(mode: GraphMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.updateModeButtons();
		this.render();
	}

	private updateModeButtons(): void {
		this.modeBtnFull?.toggleClass("is-active", this.mode === "full");
		this.modeBtnLocal?.toggleClass("is-active", this.mode === "local");
		// Hide depth in full mode
		const depthWrap = this.depthInput?.parentElement;
		if (depthWrap) {
			depthWrap.style.display = this.mode === "local" ? "" : "none";
		}
	}

	private updateFamilyTreeButton(): void {
		this.familyTreeBtn?.toggleClass("is-active", this.plugin.settings.familyTree);
	}

	render(): void {
		if (!this.canvas) return;

		let graph: RelationsGraph;
		let highlightId: string | undefined;
		let useTree = false;

		if (this.mode === "local") {
			const active = this.app.workspace.getActiveFile();
			if (!active) {
				this.showEmpty("No active note. Open a note to see its relationships.");
				return;
			}
			graph = buildLocalGraph(this.app, this.plugin.settings, active.path, this.currentLocalDepth);
			highlightId = active.path;
			this.setSubtitle(`Showing ${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"} within ${this.currentLocalDepth} hop${this.currentLocalDepth === 1 ? "" : "s"} of ${active.basename}`);
			useTree = shouldUseTreeLayout(graph, this.plugin.settings);
		} else {
			graph = buildFullGraph(this.app, this.plugin.settings);
			this.setSubtitle(`Showing ${graph.nodes.length} note${graph.nodes.length === 1 ? "" : "s"} across the vault`);
			useTree = false; // full graph stays force-directed by default
		}

		this.cy?.destroy();

		if (graph.nodes.length === 0) {
			this.showEmpty(this.mode === "local"
				? "This note isn't connected, or has no relationships within the chosen depth."
				: "No relationships found yet. Add a relationship property (like `ally:` or `family:`) to a note's frontmatter pointing to another note.");
			this.renderLegend();
			return;
		}

		// Clear empty state if any
		this.canvas.empty();

		this.cy = renderGraph({
			app: this.app,
			settings: this.plugin.settings,
			container: this.canvas,
			graph,
			highlightId,
			useTreeLayout: useTree,
			familyTree: this.plugin.settings.familyTree,
		});

		this.renderLegend();
	}

	private showEmpty(message: string): void {
		if (!this.canvas) return;
		this.canvas.empty();
		this.cy?.destroy();
		this.cy = null;
		this.canvas.createDiv({ cls: "relations-empty", text: message });
	}

	private setSubtitle(text: string): void {
		if (this.subtitleEl) this.subtitleEl.setText(text);
	}

	private renderLegend(): void {
		if (!this.legendEl) return;
		this.legendEl.empty();
		this.legendEl.toggleClass("is-hidden", !this.plugin.settings.showLegend);
		if (!this.plugin.settings.showLegend) return;

		for (const t of this.plugin.settings.relationshipTypes) {
			const item = this.legendEl.createDiv({ cls: "relations-legend-item" });
			const swatch = item.createSpan({ cls: `relations-legend-swatch is-${t.lineStyle}` });
			// For dashed/dotted/double, the visual is built with borders and pseudo-elements
			// in CSS — the color comes from a CSS custom property so a single rule can
			// reference it for foreground/background as needed.
			swatch.style.setProperty("--swatch-color", t.color);
			let label = t.name;
			if (!t.symmetric) label += " →";
			if (t.pair) label += " ⚭";
			if (t.treeLayout) label += " ⊥";
			item.createSpan({ text: label });
		}
	}
}

/**
 * Switch to tree layout when the local graph is dominated by tree-flagged edges
 * (e.g. you're looking at a family-heavy note).
 */
function shouldUseTreeLayout(graph: RelationsGraph, settings: import("./types").RelationsSettings): boolean {
	if (graph.edges.length === 0) return false;
	const treeTypes = new Set(
		settings.relationshipTypes.filter((t) => t.treeLayout).map((t) => t.name),
	);
	if (treeTypes.size === 0) return false;
	const treeEdges = graph.edges.filter((e) => treeTypes.has(e.type)).length;
	return treeEdges / graph.edges.length >= 0.6;
}
