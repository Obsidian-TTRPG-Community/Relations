import { App, PluginSettingTab, Setting, ButtonComponent } from "obsidian";
import type RelationsPlugin from "./main";

export class RelationsSettingTab extends PluginSettingTab {
	private plugin: RelationsPlugin;

	constructor(app: App, plugin: RelationsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Rebuild the settings panel while preserving the user's scroll position.
	 *
	 * Default `display()` calls `containerEl.empty()` and re-creates every
	 * setting from scratch. Browsers reset scrollTop to 0 when the contents
	 * of a scrollable element are wiped, which jumps the user back to the
	 * top every time they click "add ring color rule" or remove a row. This
	 * wrapper captures the current scroll position from whichever ancestor
	 * is actually scrolling, runs display(), then restores it.
	 *
	 * Use this instead of `this.display()` after any in-place mutation that
	 * needs to redraw the panel (adds, removes, anything that changes the
	 * row list). The initial display() call (when the settings tab first
	 * opens) doesn't need this — there's nothing to restore.
	 */
	private redisplay(): void {
		const scrollContainer = findScrollContainer(this.containerEl);
		const savedScroll = scrollContainer ? scrollContainer.scrollTop : 0;
		this.display();
		if (scrollContainer) {
			// Restore on the next frame — display() completes synchronously but
			// the browser may not have laid out the new DOM yet, so writing
			// scrollTop immediately can be clamped. requestAnimationFrame ensures
			// the new content is measurable before we set the scroll position.
			window.requestAnimationFrame(() => {
				scrollContainer.scrollTop = savedScroll;
			});
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Obsidian displays the plugin name as the panel header automatically,
		// so we don't add a duplicate "Relations" heading here. The
		// no-problematic-settings-headings lint rule explicitly flags this.

		new Setting(containerEl)
			.setName("Portrait property")
			.setDesc("Frontmatter property name that holds the portrait image. Accepts a vault path, a wikilink like [[portrait.png]], or an external URL.")
			.addText((t) => t
				.setPlaceholder("npcimage")
				.setValue(this.plugin.settings.imageProperty)
				.onChange(async (v) => {
					this.plugin.settings.imageProperty = v.trim() || "npcimage";
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Folder scope")
			.setDesc("Comma-separated folder paths to scan. Leave empty to scan the whole vault.")
			.addText((t) => t
				.setPlaceholder("e.g. People, World/Characters")
				.setValue(this.plugin.settings.folderScopes.join(", "))
				.onChange(async (v) => {
					this.plugin.settings.folderScopes = v
						.split(",").map((s) => s.trim()).filter(Boolean);
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Required tags")
			.setDesc("Comma-separated tags. If set, only notes with one of these tags are included in the graph.")
			.addText((t) => t
				.setPlaceholder("e.g. character, person")
				.setValue(this.plugin.settings.requiredTags.join(", "))
				.onChange(async (v) => {
					this.plugin.settings.requiredTags = v
						.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Default layout")
			.setDesc("fcose is force-directed (default). dagre lays out top-down (good if your vault is genealogy-heavy).")
			.addDropdown((d) => d
				.addOption("fcose", "fcose (force-directed)")
				.addOption("cose", "cose (basic force-directed)")
				.addOption("dagre", "dagre (top-down tree)")
				.setValue(this.plugin.settings.layout)
				.onChange(async (v) => {
					this.plugin.settings.layout = v as "fcose" | "cose" | "dagre";
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Local graph depth")
			.setDesc("How many hops to expand from the active note in 'Active note' mode. Range 1–6.")
			.addSlider((s) => s
				.setLimits(1, 6, 1)
				.setValue(this.plugin.settings.localGraphDepth)
				.setDynamicTooltip()
				.onChange(async (v) => {
					this.plugin.settings.localGraphDepth = v;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Show legend")
			.addToggle((t) => t
				.setValue(this.plugin.settings.showLegend)
				.onChange(async (v) => {
					this.plugin.settings.showLegend = v;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Show node labels")
			.setDesc("Show the note name under each node. Turn off for a cleaner, portrait-only graph. Individual embedded graphs can override this with `labels: true` or `labels: false` in the code block.")
			.addToggle((t) => t
				.setValue(this.plugin.settings.showNodeLabels)
				.onChange(async (v) => {
					this.plugin.settings.showNodeLabels = v;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Animate layout")
			.setDesc("When on, nodes settle into place with a brief animation when a graph first opens. Turn off to have nodes appear in their final positions immediately — useful on slower hardware or if the animation feels distracting.")
			.addToggle((t) => t
				.setValue(this.plugin.settings.animateLayout)
				.onChange(async (v) => {
					this.plugin.settings.animateLayout = v;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl).setName("Connection types").setHeading();
		const help = containerEl.createDiv({ cls: "setting-item-description" });
		help.createEl("p", { text: "Each row is one relationship type, matched by frontmatter property name." });
		const helpList = help.createEl("ul", { cls: "relations-help-list" });
		const addHelpItem = (label: string, body: string): void => {
			const li = helpList.createEl("li");
			li.createEl("strong", { text: label });
			li.appendText(` — ${body}`);
		};
		addHelpItem("Group", "optional: cluster related types under a shared heading in the legend (e.g. put parent and family in a \"Family\" group). Leave blank for ungrouped.");
		addHelpItem("Sym", "symmetric: declaring on either note creates the relationship both ways.");
		addHelpItem("Pair", "pull paired nodes very close (e.g. spouse, partner).");
		addHelpItem("Tree", "when this type dominates a graph, lay it out top-down (e.g. family, parent).");
		// "Gen" item has a <code> tag — built specially.
		{
			const li = helpList.createEl("li");
			li.createEl("strong", { text: "Gen" });
			li.appendText(" — genealogy: this type counts as a bloodline edge in family-graph mode. Typically ");
			li.createEl("code", { text: "parent" });
			li.appendText(". Used to build generations and place children below their parents.");
		}
		addHelpItem("Line", `solid / dashed / dotted / double. Useful for marking "secret", "former", "rumored" or otherwise different-flavored relationships.`);

		const list = containerEl.createDiv();
		this.renderTypeList(list);

		new Setting(containerEl)
			.addButton((b: ButtonComponent) => b
				.setButtonText("Add relationship type")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.relationshipTypes.push({
						name: "newtype",
						color: "#999999",
						symmetric: true,
						pair: false,
						treeLayout: false,
						lineStyle: "solid",
						genealogy: false,
						group: "",
					});
					await this.plugin.saveSettings();
					this.redisplay();
					this.plugin.refreshGraphView();
				}));

		// -----------------------------------------------------------------
		// Ring Color section: property name + value→color rules. Drives the
		// outer ring on each node based on a single frontmatter property.
		// Whole section is optional: leave the property name blank to disable.
		// -----------------------------------------------------------------
		new Setting(containerEl).setName("Ring color").setHeading();
		const ringHelp = containerEl.createDiv({ cls: "setting-item-description" });
		ringHelp.createEl("p", {
			text: "Color the outer ring of a node based on a frontmatter property. Set a property name, then map specific values to colors. Notes whose value doesn't match any rule render with the default ring.",
		});
		{
			const p = ringHelp.createEl("p");
			p.appendText("Example: property ");
			p.createEl("code", { text: "feelings" });
			p.appendText(", rule ");
			p.createEl("code", { text: "enemy → red" });
			p.appendText(". A note with ");
			p.createEl("code", { text: "feelings: enemy" });
			p.appendText(" in its frontmatter renders with a red ring.");
		}

		new Setting(containerEl)
			.setName("Property name")
			.setDesc("Frontmatter property the rules below match against. Leave blank to disable ring color.")
			.addText((t) => t
				.setPlaceholder("e.g. feelings")
				.setValue(this.plugin.settings.ringColorProperty)
				.onChange(async (v) => {
					this.plugin.settings.ringColorProperty = v.trim();
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				}));

		const ringList = containerEl.createDiv();
		this.renderRingColorList(ringList);

		new Setting(containerEl)
			.addButton((b: ButtonComponent) => b
				.setButtonText("Add ring color rule")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.ringColorRules.push({
						value: "",
						color: "#ef4444",
					});
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.redisplay();
					this.plugin.refreshGraphView();
				}));

		// -----------------------------------------------------------------
		// Node Badges section: three independent frontmatter properties whose
		// values render as corner icons + italic subtext on each node. No
		// rules layer — whatever the user puts in the property is what shows
		// up (typically an emoji for the icon slots, short text for subtext).
		// Each slot is independently optional: leave a property name blank
		// to disable that slot.
		// -----------------------------------------------------------------
		new Setting(containerEl).setName("Node badges").setHeading();
		const badgeHelp = containerEl.createDiv({ cls: "setting-item-description" });
		badgeHelp.createEl("p", {
			text: "Show small badges around each node, driven by frontmatter properties. Each slot displays the value of the named property as-is — an emoji, an abbreviation, a short label, whatever the user types.",
		});
		{
			const p = badgeHelp.createEl("p");
			p.appendText("Notes without the configured property render no badge for that slot. Leave a property name blank to disable the slot entirely. Badges respect the global ");
			p.createEl("em", { text: "Show node labels" });
			p.appendText(" setting — turn labels off and badges turn off with them.");
		}

		new Setting(containerEl)
			.setName("Top-left icon property")
			.setDesc("Frontmatter property whose value renders as a badge in the top-left corner. Leave blank to disable.")
			.addText((t) => t
				.setPlaceholder("e.g. weapon")
				.setValue(this.plugin.settings.topLeftIconProperty)
				.onChange(async (v) => {
					this.plugin.settings.topLeftIconProperty = v.trim();
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Top-right icon property")
			.setDesc("Frontmatter property whose value renders as a badge in the top-right corner. Leave blank to disable.")
			.addText((t) => t
				.setPlaceholder("e.g. faction")
				.setValue(this.plugin.settings.topRightIconProperty)
				.onChange(async (v) => {
					this.plugin.settings.topRightIconProperty = v.trim();
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Subtext property")
			.setDesc("Frontmatter property whose value renders as italic subtext below the node. Leave blank to disable.")
			.addText((t) => t
				.setPlaceholder("e.g. title")
				.setValue(this.plugin.settings.subtextProperty)
				.onChange(async (v) => {
					this.plugin.settings.subtextProperty = v.trim();
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl).setName("Code block syntax").setHeading();
		const usage = containerEl.createEl("pre", { cls: "relations-help-pre" });
		usage.setText(
			"```relations\n" +
			"size: small         # mini | small | large (mini is auto-selected inside callouts)\n" +
			"depth: 1            # number of hops from this note (local scope; forced to 1 for mini)\n" +
			"scope: local        # local | full\n" +
			"tree: false         # generic top-down dagre layout\n" +
			"family-graph: false # focused family view: parents above, partners on the same row, children below\n" +
			"zoom: 1.0           # zoom multiplier applied after fit. mini defaults to 1.4. 1.5 = 150%, etc.\n" +
			"height: 800px       # override the size's default height. Accepts px, em, rem, vh, vw, %.\n" +
			"spacing: 1.0        # family-graph node spacing; <1 tighter (infoboxes), >1 looser\n" +
			"# id: my-graph      # stable id; required to lock node positions in place\n" +
			"# center: \"[[Other Note]]\"      # override the focus note\n" +
			"```",
		);
	}

	private renderTypeList(container: HTMLElement): void {
		container.empty();

		// Header row labels
		const header = container.createDiv({ cls: "relations-types-header" });
		header.createSpan({ text: "Name", cls: "relations-types-header-cell relations-types-header-name" });
		header.createSpan({ text: "Group", cls: "relations-types-header-cell relations-types-header-name" });
		header.createSpan({ text: "Color", cls: "relations-types-header-cell" });
		header.createSpan({ text: "Sym", cls: "relations-types-header-cell" });
		header.createSpan({ text: "Pair", cls: "relations-types-header-cell" });
		header.createSpan({ text: "Tree", cls: "relations-types-header-cell" });
		header.createSpan({ text: "Gen", cls: "relations-types-header-cell" });
		header.createSpan({ text: "Line", cls: "relations-types-header-cell" });
		header.createSpan({ text: "", cls: "relations-types-header-cell" });

		this.plugin.settings.relationshipTypes.forEach((rt, idx) => {
			const row = container.createDiv({ cls: "relations-types-row" });

			const nameInput = row.createEl("input", { type: "text", cls: "relations-types-name" });
			nameInput.value = rt.name;
			nameInput.placeholder = "name";
			nameInput.addEventListener("change", () => {
				void (async () => {
					this.plugin.settings.relationshipTypes[idx].name = nameInput.value.trim() || rt.name;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				})();
			});

			// Optional group label — clusters related types under a heading in the
			// legend. Blank means ungrouped. Cosmetic only; no graph rescan.
			const groupInput = row.createEl("input", { type: "text", cls: "relations-types-name" });
			groupInput.value = rt.group ?? "";
			groupInput.placeholder = "—";
			groupInput.title = "Optional: cluster related types under a heading in the legend";
			groupInput.addEventListener("change", () => {
				void (async () => {
					this.plugin.settings.relationshipTypes[idx].group = groupInput.value.trim();
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				})();
			});

			const colorInput = row.createEl("input", { type: "color", cls: "relations-types-color" });
			colorInput.value = rt.color;
			colorInput.addEventListener("change", () => {
				void (async () => {
					this.plugin.settings.relationshipTypes[idx].color = colorInput.value;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				})();
			});

			const makeCheckbox = (
				key: "symmetric" | "pair" | "treeLayout" | "genealogy",
				title: string,
			): HTMLInputElement => {
				const cb = row.createEl("input", { type: "checkbox", cls: "relations-types-cb" });
				cb.checked = rt[key];
				cb.title = title;
				cb.addEventListener("change", () => {
					void (async () => {
						this.plugin.settings.relationshipTypes[idx][key] = cb.checked;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphView();
					})();
				});
				return cb;
			};

			makeCheckbox("symmetric", "Symmetric — A→B implies B→A");
			makeCheckbox("pair",      "Pair — pull these nodes very close (e.g. spouse)");
			makeCheckbox("treeLayout","Tree — lay out top-down when this type dominates");
			makeCheckbox("genealogy", "Genealogy — bloodline edge for family-graph mode");

			// Line style dropdown
			const lineSelect = row.createEl("select", { cls: "relations-types-linestyle" });
			lineSelect.title = "Line style";
			for (const opt of ["solid", "dashed", "dotted", "double"] as const) {
				const o = lineSelect.createEl("option", { text: opt });
				o.value = opt;
				if (rt.lineStyle === opt) o.selected = true;
			}
			lineSelect.addEventListener("change", () => {
				void (async () => {
					const v = lineSelect.value as "solid" | "dashed" | "dotted" | "double";
					this.plugin.settings.relationshipTypes[idx].lineStyle = v;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
				})();
			});

			const removeBtn = row.createEl("button", { text: "✕", cls: "relations-types-remove" });
			removeBtn.title = "Remove";
			removeBtn.addEventListener("click", () => {
				void (async () => {
					this.plugin.settings.relationshipTypes.splice(idx, 1);
					await this.plugin.saveSettings();
					this.redisplay();
					this.plugin.refreshGraphView();
				})();
			});
		});
	}

	/**
	 * Render the ring-color rules as a small table of (value, color, remove)
	 * rows. Mirrors renderTypeList in structure and reuses its row styling, so
	 * the visual feel is consistent across the settings page. Editing any cell
	 * busts the graph cache (ring color is baked into nodes at build time) and
	 * triggers a re-render.
	 */
	private renderRingColorList(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.ringColorRules.length === 0) {
			const empty = container.createDiv({ cls: "setting-item-description" });
			empty.setText("No rules yet. Click \"Add ring color rule\" below to create one.");
			return;
		}

		const header = container.createDiv({ cls: "relations-types-header" });
		header.createSpan({ text: "Value", cls: "relations-types-header-cell relations-types-header-name" });
		header.createSpan({ text: "Color", cls: "relations-types-header-cell" });
		header.createSpan({ text: "", cls: "relations-types-header-cell" });

		this.plugin.settings.ringColorRules.forEach((rule, idx) => {
			const row = container.createDiv({ cls: "relations-types-row" });

			const valueInput = row.createEl("input", { type: "text", cls: "relations-types-name" });
			valueInput.value = rule.value;
			valueInput.placeholder = "e.g. enemy";
			valueInput.addEventListener("change", () => {
				void (async () => {
					this.plugin.settings.ringColorRules[idx].value = valueInput.value;
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				})();
			});

			const colorInput = row.createEl("input", { type: "color", cls: "relations-types-color" });
			colorInput.value = rule.color;
			colorInput.addEventListener("change", () => {
				void (async () => {
					this.plugin.settings.ringColorRules[idx].color = colorInput.value;
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				})();
			});

			const removeBtn = row.createEl("button", { text: "✕", cls: "relations-types-remove" });
			removeBtn.title = "Remove rule";
			removeBtn.addEventListener("click", () => {
				void (async () => {
					this.plugin.settings.ringColorRules.splice(idx, 1);
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.redisplay();
					this.plugin.refreshGraphView();
				})();
			});
		});
	}
}

/**
 * Walk up from `start` and return the first ancestor element that has overflow
 * scrolling — the element whose scrollTop we'd need to preserve across a
 * settings rebuild. Returns null if no scrollable ancestor exists (in which
 * case there's no scroll to preserve and the caller can skip the dance).
 *
 * We can't just save containerEl.scrollTop, because `containerEl` isn't
 * usually the element that actually scrolls in Obsidian's settings modal —
 * a parent does. Sniffing by computed style (`overflow-y` ∈ {auto, scroll}
 * AND scrollHeight > clientHeight) finds it reliably across modal and
 * inline-tab layouts.
 */
function findScrollContainer(start: HTMLElement): HTMLElement | null {
	let el: HTMLElement | null = start;
	while (el && el !== activeDocument.body) {
		const style = window.getComputedStyle(el);
		const overflowY = style.overflowY;
		const scrolls = overflowY === "auto" || overflowY === "scroll";
		if (scrolls && el.scrollHeight > el.clientHeight) {
			return el;
		}
		el = el.parentElement;
	}
	return null;
}
