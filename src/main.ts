import { Plugin, WorkspaceLeaf, debounce, MarkdownPostProcessorContext } from "obsidian";
import {
	RelationsSettings,
	DEFAULT_SETTINGS,
	VIEW_TYPE_RELATIONS,
	RELATIONS_CODE_BLOCKS,
} from "./types";
import { RelationsView } from "./view";
import { RelationsSettingTab } from "./settings";
import { processRelationsBlock } from "./codeblock";

export default class RelationsPlugin extends Plugin {
	settings!: RelationsSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_RELATIONS,
			(leaf: WorkspaceLeaf) => new RelationsView(leaf, this),
		);

		this.addRibbonIcon("users", "Open Relations graph", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-relations-graph",
			name: "Open Relations graph",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "refresh-relations-graph",
			name: "Refresh Relations graph",
			callback: () => this.refreshGraphView(),
		});

		this.addSettingTab(new RelationsSettingTab(this.app, this));

		// Register both `relations` (canonical) and `npc-graph` (legacy alias).
		// Existing notes with ```npc-graph blocks continue to work after upgrade.
		for (const lang of RELATIONS_CODE_BLOCKS) {
			this.registerMarkdownCodeBlockProcessor(
				lang,
				(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
					processRelationsBlock(this.app, this.settings, source, el, ctx);
				},
			);
		}

		const debouncedRefresh = debounce(() => this.refreshGraphView(), 400, true);
		this.registerEvent(this.app.metadataCache.on("changed", debouncedRefresh));
		this.registerEvent(this.app.metadataCache.on("resolved", debouncedRefresh));
		this.registerEvent(this.app.vault.on("rename", debouncedRefresh));
		this.registerEvent(this.app.vault.on("delete", debouncedRefresh));
	}

	onunload(): void { /* views detach automatically */ }

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (!Array.isArray(this.settings.relationshipTypes) || this.settings.relationshipTypes.length === 0) {
			this.settings.relationshipTypes = DEFAULT_SETTINGS.relationshipTypes;
		}
		// Migration: older settings might be missing the new per-type flags.
		this.settings.relationshipTypes = this.settings.relationshipTypes.map((t) => {
			const partial = t as Partial<typeof t>;
			const validStyles = ["solid", "dashed", "dotted", "double"] as const;
			const ls = partial.lineStyle as typeof validStyles[number] | undefined;
			return {
				name: t.name,
				color: t.color,
				symmetric: t.symmetric ?? true,
				pair: partial.pair ?? false,
				treeLayout: partial.treeLayout ?? false,
				lineStyle: ls && validStyles.includes(ls) ? ls : "solid",
				// genealogy default: only `parent` (case-insensitive) starts as true so
				// existing users with a parent type still get a sensible family-tree graph.
				genealogy: partial.genealogy ?? (t.name.toLowerCase() === "parent"),
			};
		});
		if (!this.settings.imageProperty) this.settings.imageProperty = DEFAULT_SETTINGS.imageProperty;
		if (typeof this.settings.localGraphDepth !== "number") {
			this.settings.localGraphDepth = DEFAULT_SETTINGS.localGraphDepth;
		}
		if (typeof this.settings.familyTree !== "boolean") {
			this.settings.familyTree = DEFAULT_SETTINGS.familyTree;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshGraphView(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATIONS)) {
			const view = leaf.view;
			if (view instanceof RelationsView) view.render();
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_RELATIONS);
		let leaf: WorkspaceLeaf | null;

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_RELATIONS, active: true });
		}

		workspace.revealLeaf(leaf);
	}
}
