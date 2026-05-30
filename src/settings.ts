import { App, PluginSettingTab, Setting, ColorComponent, ButtonComponent } from "obsidian";
import type RelationsPlugin from "./main";

export class RelationsSettingTab extends PluginSettingTab {
	private plugin: RelationsPlugin;

	constructor(app: App, plugin: RelationsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Relations" });

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

		containerEl.createEl("h3", { text: "Relationship types" });
		const help = containerEl.createDiv({ cls: "setting-item-description" });
		help.innerHTML = `
			<p>Each row is one relationship type, matched by frontmatter property name.</p>
			<ul style="margin-top:4px">
				<li><strong>Sym</strong> — symmetric: declaring on either note creates the relationship both ways.</li>
				<li><strong>Pair</strong> — pull paired nodes very close (e.g. spouse, partner).</li>
				<li><strong>Tree</strong> — when this type dominates a graph, lay it out top-down (e.g. family, parent).</li>
				<li><strong>Gen</strong> — genealogy: this type counts as a bloodline edge in family-graph mode. Typically <code>parent</code>. Used to build generations and place children below their parents.</li>
				<li><strong>Line</strong> — solid / dashed / dotted / double. Useful for marking "secret", "former", "rumored" or otherwise different-flavored relationships.</li>
			</ul>
		`;

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
					});
					await this.plugin.saveSettings();
					this.display();
					this.plugin.refreshGraphView();
				}));

		containerEl.createEl("h3", { text: "Code block syntax" });
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
			nameInput.addEventListener("change", async () => {
				this.plugin.settings.relationshipTypes[idx].name = nameInput.value.trim() || rt.name;
				await this.plugin.saveSettings();
				this.plugin.refreshGraphView();
			});

			const colorInput = row.createEl("input", { type: "color", cls: "relations-types-color" });
			colorInput.value = rt.color;
			colorInput.addEventListener("change", async () => {
				this.plugin.settings.relationshipTypes[idx].color = colorInput.value;
				await this.plugin.saveSettings();
				this.plugin.refreshGraphView();
			});

			const makeCheckbox = (
				key: "symmetric" | "pair" | "treeLayout" | "genealogy",
				title: string,
			): HTMLInputElement => {
				const cb = row.createEl("input", { type: "checkbox", cls: "relations-types-cb" });
				cb.checked = rt[key];
				cb.title = title;
				cb.addEventListener("change", async () => {
					this.plugin.settings.relationshipTypes[idx][key] = cb.checked;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphView();
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
			lineSelect.addEventListener("change", async () => {
				const v = lineSelect.value as "solid" | "dashed" | "dotted" | "double";
				this.plugin.settings.relationshipTypes[idx].lineStyle = v;
				await this.plugin.saveSettings();
				this.plugin.refreshGraphView();
			});

			const removeBtn = row.createEl("button", { text: "✕", cls: "relations-types-remove" });
			removeBtn.title = "Remove";
			removeBtn.addEventListener("click", async () => {
				this.plugin.settings.relationshipTypes.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
				this.plugin.refreshGraphView();
			});
		});
	}
}
