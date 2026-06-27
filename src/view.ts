import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import { Core } from "cytoscape";
import type RelationsPlugin from "./main";
import { VIEW_TYPE_RELATIONS, GraphMode, RelationsGraph } from "./types";
import { renderGraph } from "./render";
import { buildFullGraph, buildLocalGraph, filterGraphByTypes } from "./graph";
import { renderLegend } from "./codeblock";
import { renderFilterPanel } from "./filter-panel";

export class RelationsView extends ItemView {
	private plugin: RelationsPlugin;
	private cy: Core | null = null;
	private canvas: HTMLElement | null = null;
	private legendEl: HTMLElement | null = null;
	private filterEl: HTMLElement | null = null;
	private filterBtn: HTMLButtonElement | null = null;
	private filterOpen = false;
	private filterExpanded: Set<string> = new Set();
	private modeBtnFull: HTMLButtonElement | null = null;
	private modeBtnLocal: HTMLButtonElement | null = null;
	private depthInput: HTMLInputElement | null = null;
	private labelsBtn: HTMLButtonElement | null = null;
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

		// Toolbar spacer pushes subsequent buttons to the right. The element
		// itself is what matters; we don't need a reference to it because its
		// styling (flex: 1) is class-driven via styles.css under .relations-spacer.
		toolbar.createDiv({ cls: "relations-spacer" });

		const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
		refreshBtn.addEventListener("click", () => this.render());
		const fitBtn = toolbar.createEl("button", { text: "Fit" });
		fitBtn.addEventListener("click", () => this.cy?.fit(undefined, 40));

		// Labels toggle — flips the global showNodeLabels setting and re-renders.
		// Sticky across reloads since it writes to settings.
		this.labelsBtn = toolbar.createEl("button", { text: "Labels" });
		this.labelsBtn.title = "Show or hide note names under nodes";
		this.labelsBtn.addEventListener("click", () => {
			void (async () => {
				this.plugin.settings.showNodeLabels = !this.plugin.settings.showNodeLabels;
				await this.plugin.saveSettings();
				this.updateLabelsButton();
				this.render();
			})();
		});
		this.updateLabelsButton();

		// Filter toggle — opens a collapsible panel for turning relationship types
		// (and whole groups) on and off. Selections persist via settings.
		this.filterBtn = toolbar.createEl("button", { text: "Filter" });
		this.filterBtn.title = "Filter which relationship types are shown";
		this.filterBtn.addEventListener("click", () => {
			this.filterOpen = !this.filterOpen;
			this.updateFilterButton();
			this.renderFilter();
		});
		this.updateFilterButton();

		this.subtitleEl = root.createDiv({ cls: "relations-subtitle" });
		this.filterEl = root.createDiv({ cls: "relations-filter-panel" });
		this.canvas = root.createDiv({ cls: "relations-canvas" });
		this.legendEl = root.createDiv({ cls: "relations-legend" });
		this.renderFilter();

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

	private updateLabelsButton(): void {
		this.labelsBtn?.toggleClass("is-active", this.plugin.settings.showNodeLabels !== false);
	}

	private updateFilterButton(): void {
		// Active when the panel is open OR a filter is in effect, so the user has a
		// visible cue that some types are hidden even with the panel collapsed.
		const filtering = this.plugin.settings.disabledTypes.length > 0;
		this.filterBtn?.toggleClass("is-active", this.filterOpen || filtering);
	}

	private renderFilter(): void {
		if (!this.filterEl) return;
		this.filterEl.toggleClass("is-hidden", !this.filterOpen);
		if (!this.filterOpen) {
			this.filterEl.empty();
			return;
		}
		renderFilterPanel(this.filterEl, this.plugin.settings, {
			expanded: this.filterExpanded,
			onChange: () => {
				void this.plugin.saveSettings();
				this.updateFilterButton();
				this.render();
				this.renderFilter();
			},
		});
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
			graph = buildLocalGraph(this.app, this.plugin.settings, active.path, this.currentLocalDepth, this.plugin.graphCache);
			highlightId = active.path;
		} else {
			graph = buildFullGraph(this.app, this.plugin.settings, this.plugin.graphCache);
		}

		// Apply the type filter before measuring/rendering, so node counts, layout
		// and the subtitle reflect only what's actually shown. The active note
		// (local mode) is kept even if filtering would otherwise isolate it.
		graph = filterGraphByTypes(
			graph,
			new Set(this.plugin.settings.disabledTypes),
			highlightId,
		);

		if (this.mode === "local") {
			const active = this.app.workspace.getActiveFile();
			this.setSubtitle(`Showing ${graph.nodes.length} node${graph.nodes.length === 1 ? "" : "s"} within ${this.currentLocalDepth} hop${this.currentLocalDepth === 1 ? "" : "s"} of ${active?.basename ?? ""}`);
			useTree = shouldUseTreeLayout(graph, this.plugin.settings);
		} else {
			this.setSubtitle(`Showing ${graph.nodes.length} note${graph.nodes.length === 1 ? "" : "s"} across the vault`);
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
			labelStore: this.plugin,
			editableLabels: true,
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
		this.legendEl.toggleClass("is-hidden", !this.plugin.settings.showLegend);
		if (!this.plugin.settings.showLegend) {
			this.legendEl.empty();
			return;
		}
		// `clear: true` so re-renders (after settings change) don't accumulate items.
		renderLegend(this.legendEl, this.plugin.settings.relationshipTypes, true);
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
