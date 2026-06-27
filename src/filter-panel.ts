import { setIcon } from "obsidian";
import { RelationsSettings, RelationshipType } from "./types";

/**
 * Shared type-filter panel used by both the side-panel view and code-block
 * embeds. Renders one row per relationship type, clustered by the same `group`
 * field that drives the legend:
 *
 *   - Ungrouped types render as flat top-level checkboxes.
 *   - Grouped types render under a collapsible group header whose checkbox is
 *     tri-state (all on / mixed / all off) and toggles every member at once.
 *
 * Toggling any checkbox mutates `settings.disabledTypes` in place and calls
 * `opts.onChange`, which the caller wires to persist + re-render the graph. The
 * caller owns `opts.expanded` (the set of expanded group names) so expand state
 * survives the re-render that onChange triggers.
 */
export interface FilterPanelOptions {
	/** Group names currently expanded. Owned by the caller, mutated in place. */
	expanded: Set<string>;
	/** Called after a toggle has updated settings.disabledTypes. */
	onChange: () => void;
}

interface GroupBucket {
	name: string;            // "" for the ungrouped bucket
	types: RelationshipType[];
}

function bucketByGroup(types: RelationshipType[]): GroupBucket[] {
	const order: string[] = [];
	const map = new Map<string, RelationshipType[]>();
	for (const t of types) {
		const g = (t.group ?? "").trim();
		if (!map.has(g)) {
			map.set(g, []);
			order.push(g);
		}
		map.get(g)!.push(t);
	}
	// Ungrouped first (matches the legend), then named groups in first-appearance order.
	const ordered = order.filter((g) => g === "").concat(order.filter((g) => g !== ""));
	return ordered.map((name) => ({ name, types: map.get(name)! }));
}

export function renderFilterPanel(
	host: HTMLElement,
	settings: RelationsSettings,
	opts: FilterPanelOptions,
): void {
	host.empty();

	const disabled = new Set(settings.disabledTypes);
	const types = settings.relationshipTypes;

	const commit = (): void => {
		settings.disabledTypes = [...disabled];
		opts.onChange();
	};

	// Header with a label and All / None quick actions.
	const header = host.createDiv({ cls: "relations-filter-header" });
	header.createSpan({ text: "Filter types", cls: "relations-filter-title" });
	const actions = header.createDiv({ cls: "relations-filter-actions" });
	const allBtn = actions.createEl("button", { text: "All", cls: "relations-filter-action" });
	const noneBtn = actions.createEl("button", { text: "None", cls: "relations-filter-action" });
	allBtn.addEventListener("click", () => { disabled.clear(); commit(); });
	noneBtn.addEventListener("click", () => {
		for (const t of types) disabled.add(t.name);
		commit();
	});

	const renderTypeRow = (parent: HTMLElement, t: RelationshipType, child: boolean): void => {
		const row = parent.createDiv({ cls: "relations-filter-row" + (child ? " is-child" : "") });
		const label = row.createEl("label", { cls: "relations-filter-label" });
		const cb = label.createEl("input", { type: "checkbox", cls: "relations-filter-cb" });
		cb.checked = !disabled.has(t.name);
		const swatch = label.createSpan({ cls: `relations-filter-swatch is-${t.lineStyle}` });
		swatch.style.setProperty("--swatch-color", t.color);
		label.createSpan({ text: t.name, cls: "relations-filter-name" });
		cb.addEventListener("change", () => {
			if (cb.checked) disabled.delete(t.name); else disabled.add(t.name);
			commit();
		});
	};

	for (const bucket of bucketByGroup(types)) {
		if (bucket.name === "") {
			for (const t of bucket.types) renderTypeRow(host, t, false);
			continue;
		}

		const members = bucket.types;
		const groupEl = host.createDiv({ cls: "relations-filter-group" });
		const headRow = groupEl.createDiv({ cls: "relations-filter-grouphead" });

		const chevron = headRow.createSpan({ cls: "relations-filter-chevron" });
		const isExpanded = opts.expanded.has(bucket.name);
		setIcon(chevron, isExpanded ? "chevron-down" : "chevron-right");

		const gcb = headRow.createEl("input", { type: "checkbox", cls: "relations-filter-cb" });
		const enabledCount = members.filter((t) => !disabled.has(t.name)).length;
		gcb.checked = enabledCount > 0;
		gcb.indeterminate = enabledCount > 0 && enabledCount < members.length;

		const nameEl = headRow.createSpan({ text: bucket.name, cls: "relations-filter-groupname" });
		headRow.createSpan({ text: `${enabledCount}/${members.length}`, cls: "relations-filter-count" });

		const childWrap = groupEl.createDiv({ cls: "relations-filter-children" });
		childWrap.toggleClass("is-hidden", !isExpanded);
		for (const t of members) renderTypeRow(childWrap, t, true);

		// Expand/collapse toggles visibility in place (no commit, no re-render),
		// so it stays snappy and doesn't disturb the graph.
		const toggleExpand = (): void => {
			if (opts.expanded.has(bucket.name)) opts.expanded.delete(bucket.name);
			else opts.expanded.add(bucket.name);
			const open = opts.expanded.has(bucket.name);
			childWrap.toggleClass("is-hidden", !open);
			setIcon(chevron, open ? "chevron-down" : "chevron-right");
		};
		chevron.addEventListener("click", toggleExpand);
		nameEl.addEventListener("click", toggleExpand);

		// Group checkbox: enable all members when turning on, disable all when off.
		gcb.addEventListener("change", () => {
			const turnOn = gcb.checked;
			for (const t of members) {
				if (turnOn) disabled.delete(t.name); else disabled.add(t.name);
			}
			commit();
		});
	}
}
