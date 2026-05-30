import { Plugin, WorkspaceLeaf, debounce, MarkdownPostProcessorContext, Editor, MarkdownView } from "obsidian";
import {
	RelationsSettings,
	DEFAULT_SETTINGS,
	VIEW_TYPE_RELATIONS,
	RELATIONS_CODE_BLOCKS,
	PositionStore,
	LockedLayout,
} from "./types";
import { RelationsView } from "./view";
import { RelationsSettingTab } from "./settings";
import { processRelationsBlock } from "./codeblock";
import { GraphCache } from "./graph-cache";

export default class RelationsPlugin extends Plugin implements PositionStore {
	settings!: RelationsSettings;
	graphCache: GraphCache = new GraphCache();
	private lockedLayouts: Record<string, LockedLayout> = {};

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

		// Insert a bare relations block at the cursor. Empty body — the host note's
		// frontmatter and plugin defaults supply everything needed for a useful render.
		this.addCommand({
			id: "insert-relations-block",
			name: "Insert relations code block",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				insertCodeBlock(editor, "```relations\n```\n");
			},
		});

		// Same idea but with every option present and commented. Useful as a discovery
		// aid — users can uncomment and edit the lines they want without consulting docs.
		this.addCommand({
			id: "insert-relations-block-full",
			name: "Insert relations code block (with all options)",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const block =
					"```relations\n" +
					"# size: small         # mini | small | large\n" +
					"# depth: 1            # hops from this note (local scope)\n" +
					"# scope: local        # local | full\n" +
					"# tree: false         # generic top-down dagre layout\n" +
					"# family-graph: false # focused family view: parents above, partners level, children below\n" +
					"# zoom: 1.0           # zoom multiplier; mini defaults to 1.4\n" +
					"# height: 400px       # override embed height. px, em, rem, vh, vw, %\n" +
					"# spacing: 1.0        # family-graph node spacing; <1 tighter, >1 looser\n" +
					"# labels: true        # show note names under nodes\n" +
					"# id: my-graph        # stable id; required to lock node positions in place\n" +
					"# center: \"[[Other Note]]\"  # focus a different note\n" +
					"```\n";
				insertCodeBlock(editor, block);
			},
		});

		this.addSettingTab(new RelationsSettingTab(this.app, this));

		// Register both `relations` (canonical) and `npc-graph` (legacy alias).
		// Existing notes with ```npc-graph blocks continue to work after upgrade.
		for (const lang of RELATIONS_CODE_BLOCKS) {
			this.registerMarkdownCodeBlockProcessor(
				lang,
				(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
					processRelationsBlock(this.app, this.settings, source, el, ctx, this.graphCache, this);
				},
			);
		}

		// File changes invalidate the cached graph and trigger a (debounced) view refresh.
		// Cache invalidation is immediate so the next render — debounced or not —
		// picks up the change.
		const debouncedRefresh = debounce(() => this.refreshGraphView(), 400, true);
		const onChange = () => {
			this.graphCache.invalidate();
			debouncedRefresh();
		};
		this.registerEvent(this.app.metadataCache.on("changed", onChange));
		this.registerEvent(this.app.metadataCache.on("resolved", onChange));
		this.registerEvent(this.app.vault.on("rename", onChange));
		this.registerEvent(this.app.vault.on("delete", onChange));
		this.registerEvent(this.app.vault.on("create", onChange));
	}

	onunload(): void { /* views detach automatically */ }

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.lockedLayouts = loaded && typeof loaded.lockedLayouts === "object" && loaded.lockedLayouts || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		delete (this.settings as unknown as Record<string, unknown>).lockedLayouts;
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
				// existing users with a parent type still get a sensible family-graph view.
				genealogy: partial.genealogy ?? (t.name.toLowerCase() === "parent"),
			};
		});
		if (!this.settings.imageProperty) this.settings.imageProperty = DEFAULT_SETTINGS.imageProperty;
		if (typeof this.settings.localGraphDepth !== "number") {
			this.settings.localGraphDepth = DEFAULT_SETTINGS.localGraphDepth;
		}
		if (typeof this.settings.animateLayout !== "boolean") {
			this.settings.animateLayout = DEFAULT_SETTINGS.animateLayout;
		}
		if (typeof this.settings.showNodeLabels !== "boolean") {
			this.settings.showNodeLabels = DEFAULT_SETTINGS.showNodeLabels;
		}
	}

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.saveData({ ...this.settings, lockedLayouts: this.lockedLayouts });
	}

	get(blockId: string): LockedLayout | null {
		return this.lockedLayouts[blockId] ?? null;
	}

	async set(blockId: string, layout: LockedLayout): Promise<void> {
		this.lockedLayouts[blockId] = layout;
		await this.persist();
	}

	async clear(blockId: string): Promise<void> {
		delete this.lockedLayouts[blockId];
		await this.persist();
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

/**
 * Insert a code block at the editor cursor (or replace the selection).
 *
 * Handles three cases the naive `replaceSelection` doesn't:
 *  - cursor mid-line: prepend "\n" so the fence starts on its own line
 *  - cursor with text after it on the same line: append "\n" so trailing text
 *    drops to a new line below the closing fence (otherwise it gets glued to it
 *    and breaks markdown parsing)
 *  - selection across multiple lines: just replace it cleanly
 *
 * After insertion, the cursor is placed inside the block on the line after the
 * opening fence — the user's natural next step is typing options.
 */
function insertCodeBlock(editor: Editor, block: string): void {
	const hasSelection = editor.somethingSelected();
	if (hasSelection) {
		editor.replaceSelection(block);
		return;
	}

	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const beforeCursor = line.slice(0, cursor.ch);
	const afterCursor = line.slice(cursor.ch);

	// Build the insert string with leading/trailing newlines as needed.
	let toInsert = block;
	if (beforeCursor.trim().length > 0) {
		// There's content before us on this line — push the block to a new line.
		toInsert = "\n" + toInsert;
	}
	if (afterCursor.trim().length > 0) {
		// Trailing content would otherwise glue onto the closing fence's line.
		// Block already ends with \n, so just need to make sure its own newline
		// sits between the fence and the trailing text. The block string we pass
		// already ends in \n; the trailing text falls below naturally.
	}

	editor.replaceRange(toInsert, cursor);

	// Move the cursor to the line just after the opening fence so the user can
	// immediately type options. The opening fence is the first line of the block
	// (or second if we prepended "\n"). We count from the original cursor position.
	const fenceOffsetLines = (toInsert.startsWith("\n") ? 1 : 0) + 1;
	const targetLine = cursor.line + fenceOffsetLines;
	editor.setCursor({ line: targetLine, ch: 0 });
	editor.focus();
}
