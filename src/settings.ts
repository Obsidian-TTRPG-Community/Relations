import { App, Modal, PluginSettingTab, Setting, ButtonComponent, Notice } from "obsidian";
import type RelationsPlugin from "./main";
import type { LineStyle } from "./types";
import { isHierarchyNameTaken, sortedLevels, defaultLevelColor, LevelDraft, validateLevels } from "./organization-hierarchies";

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
			.setName("Bottom-left icon property")
			.setDesc("Frontmatter property whose value renders as a badge in the bottom-left corner. Leave blank to disable.")
			.addText((t) => t
				.setPlaceholder("e.g. status")
				.setValue(this.plugin.settings.bottomLeftIconProperty)
				.onChange(async (v) => {
					this.plugin.settings.bottomLeftIconProperty = v.trim();
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.plugin.refreshGraphView();
				}));

		new Setting(containerEl)
			.setName("Bottom-right icon property")
			.setDesc("Frontmatter property whose value renders as a badge in the bottom-right corner. Leave blank to disable.")
			.addText((t) => t
				.setPlaceholder("e.g. role")
				.setValue(this.plugin.settings.bottomRightIconProperty)
				.onChange(async (v) => {
					this.plugin.settings.bottomRightIconProperty = v.trim();
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

		// -----------------------------------------------------------------
		// Organization hierarchies: user-defined rank structures (e.g. "Party
		// Structure": Leader/Officers/Members/Initiates) for Group notes. A
		// hierarchy's level names become the frontmatter field names a Group
		// note lists members under; a `relations` code block then renders that
		// structure with `org-graph:`/`org-tree: <hierarchy name>`.
		// -----------------------------------------------------------------
		new Setting(containerEl).setName("Organization hierarchies").setHeading();
		const orgHelp = containerEl.createDiv({ cls: "setting-item-description" });
		orgHelp.createEl("p", {
			text: "Define custom rank structures for Group notes — e.g. a \"Party Structure\" of Leader/Officers/Members/Initiates, or a guild's Master/Journeyman/Apprentice ranks. Each level's name becomes a frontmatter field a Group note lists members under.",
		});
		{
			const p = orgHelp.createEl("p");
			p.appendText("Example: level ");
			p.createEl("code", { text: "Officers" });
			p.appendText(" becomes the frontmatter field ");
			p.createEl("code", { text: "officers" });
			p.appendText(". Render it with ");
			p.createEl("code", { text: "org-graph: Party Structure" });
			p.appendText(" or ");
			p.createEl("code", { text: "org-tree: Party Structure" });
			p.appendText(" in a relations code block.");
		}
		const orgHelpList = orgHelp.createEl("ul", { cls: "relations-help-list" });
		const addOrgHelpItem = (label: string, body: string): void => {
			const li = orgHelpList.createEl("li");
			li.createEl("strong", { text: label });
			li.appendText(` — ${body}`);
		};
		addOrgHelpItem("Level", "position in the hierarchy (1 = top). Gaps are fine — levels always display sorted by number.");
		addOrgHelpItem("Name", "becomes the frontmatter field a Group note lists members under (e.g. \"Officers\" → officers).");
		addOrgHelpItem("Color", "legend swatch color; also the ring color when a level collapses to one member, or the hub node's fill color when it has several.");
		addOrgHelpItem("Line", "solid / dashed / dotted / double. Styles the connector from this level up to the level above it.");

		const orgList = containerEl.createDiv();
		this.renderHierarchyList(orgList);

		new Setting(containerEl)
			.addButton((b: ButtonComponent) => b
				.setButtonText("Add hierarchy")
				.setCta()
				.onClick(() => {
					new HierarchyNameModal(this.app, (name) => {
						if (isHierarchyNameTaken(this.plugin.settings, name)) {
							new Notice(`A hierarchy named "${name}" already exists.`);
							return;
						}
						new HierarchyLevelsModal(
							this.app,
							name,
							[
								{ level: 1, name: "", color: defaultLevelColor(0), lineStyle: "solid" },
								{ level: 2, name: "", color: defaultLevelColor(1), lineStyle: "solid" },
							],
							false,
							(candidate) => isHierarchyNameTaken(this.plugin.settings, candidate),
							(finalName, levels) => {
								void (async () => {
									this.plugin.settings.organizationHierarchies.push({ name: finalName, levels });
									await this.plugin.saveSettings();
									this.redisplay();
									this.plugin.refreshGraphView();
								})();
							},
						).open();
					}).open();
				}));

		new Setting(containerEl).setName("Code block syntax").setHeading();
		const usage = containerEl.createEl("pre", { cls: "relations-help-pre" });
		usage.setText(
			"```relations\n" +
			"size: small         # mini | small | large (mini is auto-selected inside callouts)\n" +
			"depth: 1            # number of hops from this note (local scope; bounds connected scope when set; forced to 1 for mini)\n" +
			"scope: local        # local | connected | full\n" +
			"tree: false         # generic top-down dagre layout\n" +
			"family-graph: false # focused family view: parents above, partners on the same row, children below\n" +
			"org-graph: Hierarchy # organization hierarchy (see above), force-directed layout\n" +
			"org-tree: Hierarchy  # same, but top-down layout\n" +
			"zoom: 1.0           # zoom multiplier applied after fit. mini defaults to 1.4. 1.5 = 150%, etc.\n" +
			"height: 800px       # override the size's default height. Accepts px, em, rem, vh, vw, %.\n" +
			"spacing: 1.0        # family-graph node spacing; <1 tighter (infoboxes), >1 looser\n" +
			"# id: my-graph      # stable id; required to lock node positions in place\n" +
			"# center: \"[[Other Note]]\"      # override the focus note\n" +
			"```",
		);
	}

	/**
	 * Render the configured hierarchies as a list of (name, level summary, Edit,
	 * Delete) rows. Mirrors renderTypeList/renderRingColorList in structure.
	 */
	private renderHierarchyList(container: HTMLElement): void {
		container.empty();

		const hierarchies = this.plugin.settings.organizationHierarchies;
		if (hierarchies.length === 0) {
			const empty = container.createDiv({ cls: "setting-item-description" });
			empty.setText("No hierarchies yet. Click \"Add hierarchy\" below to create one.");
			return;
		}

		hierarchies.forEach((h, idx) => {
			const row = container.createDiv({ cls: "relations-org-hierarchy-row" });

			const info = row.createDiv({ cls: "relations-org-hierarchy-info" });
			info.createEl("strong", { text: h.name });
			const summary = info.createDiv({ cls: "relations-org-hierarchy-summary" });
			sortedLevels(h).forEach((l, i) => {
				const chip = summary.createSpan({ cls: "relations-org-level-chip" });
				const swatch = chip.createSpan({ cls: "relations-org-level-swatch" });
				swatch.style.setProperty("--org-swatch-color", l.color || defaultLevelColor(i));
				chip.appendText(`${l.level}=${l.name}`);
			});

			const actions = row.createDiv({ cls: "relations-org-hierarchy-actions" });

			const editBtn = actions.createEl("button", { text: "Edit" });
			editBtn.addEventListener("click", () => {
				new HierarchyLevelsModal(
					this.app,
					h.name,
					sortedLevels(h).map((l, i) => ({
						level: l.level,
						name: l.name,
						color: l.color || defaultLevelColor(i),
						lineStyle: l.lineStyle || "solid",
					})),
					true,
					(candidate) => isHierarchyNameTaken(this.plugin.settings, candidate, idx),
					(finalName, levels) => {
						void (async () => {
							this.plugin.settings.organizationHierarchies[idx] = { name: finalName, levels };
							await this.plugin.saveSettings();
							this.plugin.graphCache.invalidate();
							this.redisplay();
							this.plugin.refreshGraphView();
						})();
					},
				).open();
			});

			const removeBtn = actions.createEl("button", { text: "✕", cls: "relations-types-remove" });
			removeBtn.title = "Delete hierarchy";
			removeBtn.addEventListener("click", () => {
				void (async () => {
					this.plugin.settings.organizationHierarchies.splice(idx, 1);
					await this.plugin.saveSettings();
					this.plugin.graphCache.invalidate();
					this.redisplay();
					this.plugin.refreshGraphView();
				})();
			});
		});
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
		header.createSpan({ text: "Child", cls: "relations-types-header-cell" });
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
				key: "symmetric" | "pair" | "treeLayout" | "genealogy" | "declaresChild",
				title: string,
			): HTMLInputElement => {
				const cb = row.createEl("input", { type: "checkbox", cls: "relations-types-cb" });
				cb.checked = rt[key] ?? false;
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
			makeCheckbox("declaresChild", "Child — this property is written on the PARENT's note and names the child (e.g. `children:`). Only used when Gen is on; edges are stored child→parent either way, so both sides of a bond can be declared without duplicates.");

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

/**
 * Step 1 of creating a new hierarchy: just the name. Kept separate from the
 * level builder (HierarchyLevelsModal) so the level-builder's header can read
 * `Define levels for "<name>"` — matching the spec's two-modal flow.
 */
export class HierarchyNameModal extends Modal {
	private name = "";

	constructor(app: App, private onSubmit: (name: string) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "New organization hierarchy" });

		new Setting(contentEl)
			.setName("Organization name")
			.addText((t) => {
				t.setPlaceholder("e.g. Party Structure")
					.onChange((v) => { this.name = v; });
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.trySubmit();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Create").setCta().onClick(() => this.trySubmit()));
	}

	private trySubmit(): void {
		const trimmed = this.name.trim();
		if (!trimmed) {
			new Notice("Enter a name for the hierarchy.");
			return;
		}
		this.close();
		this.onSubmit(trimmed);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Step 2: the level builder. Handles both "create" (name fixed from step 1,
 * shown read-only in the header) and "edit" (name editable inline) via the
 * `editableName` flag. Levels can be added, removed, and renumbered freely;
 * duplicate level numbers get an inline error on blur, and Save re-validates
 * everything (see validateLevels) so a bad state can't be persisted.
 */
export class HierarchyLevelsModal extends Modal {
	private name: string;
	private levels: LevelDraft[];

	constructor(
		app: App,
		initialName: string,
		initialLevels: LevelDraft[],
		private editableName: boolean,
		private isNameTaken: (name: string) => boolean,
		private onSave: (name: string, levels: { level: number; name: string; color: string; lineStyle: LineStyle }[]) => void,
	) {
		super(app);
		this.name = initialName;
		this.levels = initialLevels.length > 0
			? initialLevels.map((l) => ({ ...l }))
			: [
				{ level: 1, name: "", color: defaultLevelColor(0), lineStyle: "solid" },
				{ level: 2, name: "", color: defaultLevelColor(1), lineStyle: "solid" },
			];
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Define levels for "${this.name}"` });

		if (this.editableName) {
			new Setting(contentEl)
				.setName("Organization name")
				.addText((t) => t
					.setValue(this.name)
					.onChange((v) => { this.name = v; }));
		}

		const help = contentEl.createDiv({ cls: "setting-item-description" });
		help.setText("Each level needs a number and a name. Levels display sorted by number — gaps (1, 2, 5) are fine, but each number can only be used once.");

		const rows = contentEl.createDiv({ cls: "relations-org-levels" });
		this.renderRows(rows);

		new Setting(contentEl)
			.addButton((b) => b
				.setButtonText("+ Add level")
				.onClick(() => {
					const maxLevel = this.levels.reduce((m, l) => Math.max(m, l.level ?? 0), 0);
					this.levels.push({ level: maxLevel + 1, name: "", color: defaultLevelColor(this.levels.length), lineStyle: "solid" });
					this.renderRows(rows);
				}));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText("Save").setCta().onClick(() => this.trySave()));
	}

	private renderRows(container: HTMLElement): void {
		container.empty();

		this.levels.forEach((lvl, idx) => {
			const row = container.createDiv({ cls: "relations-org-level-row" });

			const numInput = row.createEl("input", { type: "number", cls: "relations-org-level-number" });
			numInput.min = "1";
			numInput.step = "1";
			numInput.value = lvl.level != null ? String(lvl.level) : "";

			const nameInput = row.createEl("input", { type: "text", cls: "relations-org-level-name" });
			nameInput.placeholder = "e.g. Leader";
			nameInput.value = lvl.name;

			const colorInput = row.createEl("input", { type: "color", cls: "relations-types-color" });
			colorInput.value = lvl.color || defaultLevelColor(idx);
			colorInput.title = "Level color — legend swatch, ring color (single member) or hub fill (multiple members)";
			colorInput.addEventListener("change", () => { lvl.color = colorInput.value; });

			const lineSelect = row.createEl("select", { cls: "relations-types-linestyle" });
			lineSelect.title = "Line style — connector from this level up to the level above it";
			for (const opt of ["solid", "dashed", "dotted", "double"] as const) {
				const o = lineSelect.createEl("option", { text: opt });
				o.value = opt;
				if ((lvl.lineStyle || "solid") === opt) o.selected = true;
			}
			lineSelect.addEventListener("change", () => { lvl.lineStyle = lineSelect.value as LineStyle; });

			const removeBtn = row.createEl("button", { text: "✕", cls: "relations-types-remove" });
			removeBtn.title = "Remove level";

			const errorEl = row.createDiv({ cls: "relations-org-level-error" });

			const updateError = (): void => {
				const dup = lvl.level != null
					&& this.levels.some((other, j) => j !== idx && other.level === lvl.level);
				errorEl.setText(dup ? `Level ${lvl.level} already exists` : "");
				numInput.toggleClass("has-error", dup);
			};

			numInput.addEventListener("input", () => {
				const v = parseInt(numInput.value, 10);
				lvl.level = Number.isFinite(v) ? v : null;
			});
			numInput.addEventListener("blur", updateError);

			nameInput.addEventListener("input", () => { lvl.name = nameInput.value; });

			removeBtn.addEventListener("click", () => {
				this.levels.splice(idx, 1);
				this.renderRows(container);
			});

			updateError();
		});
	}

	private trySave(): void {
		const trimmedName = this.name.trim();
		if (!trimmedName) {
			new Notice("Enter a name for the hierarchy.");
			return;
		}
		if (this.isNameTaken(trimmedName)) {
			new Notice(`A hierarchy named "${trimmedName}" already exists.`);
			return;
		}

		const { errors, warnings } = validateLevels(this.levels);
		if (errors.length > 0) {
			new Notice(errors[0]);
			return;
		}
		if (warnings.length > 0) {
			new Notice(warnings[0]);
		}

		// Validated above: every level has a non-null number and non-empty name.
		const cleanLevels = this.levels
			.map((l) => ({ level: l.level as number, name: l.name.trim(), color: l.color, lineStyle: l.lineStyle }))
			.sort((a, b) => a.level - b.level);

		this.close();
		this.onSave(trimmedName, cleanLevels);
	}
}
