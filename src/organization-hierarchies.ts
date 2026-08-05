import { App, TFile } from "obsidian";
import {
	RelationsSettings,
	RelationsGraph,
	GraphNode,
	GraphEdge,
	OrganizationHierarchy,
	OrganizationLevel,
	LineStyle,
} from "./types";
import { extractLinkTargets, buildNode } from "./graph";

/**
 * Colors assigned to hierarchy levels, by position in the hierarchy's sorted
 * level list (not by how many members a specific note happens to declare).
 * This keeps a level's color stable across every Group note that uses the
 * hierarchy — "Officers" is always the same color for "Party Structure",
 * regardless of which note is being rendered. Cycles for hierarchies with
 * more levels than colors.
 */
export const ORG_LEVEL_COLORS = [
	"#dc2626", // red
	"#3b82f6", // blue
	"#22c55e", // green
	"#eab308", // yellow
	"#8b5cf6", // violet
	"#fb923c", // orange
	"#0891b2", // cyan
	"#d946ef", // fuchsia
];

/** Default color for a level at the given position, used both as the settings
 * modal's starting swatch for a newly-added level and as the rendering
 * fallback for any level that predates the per-level color field. */
export function defaultLevelColor(index: number): string {
	return ORG_LEVEL_COLORS[index % ORG_LEVEL_COLORS.length];
}

/** Synthetic edge types used by organization-hierarchy graphs. Not configured
 * relationship types, so they're excluded from the legend/filter panel. */
export const ORG_MEMBER_EDGE_TYPE = "__org_member";
export const ORG_LEVEL_EDGE_TYPE = "__org_level";

/**
 * Convert a hierarchy level's display label into a frontmatter field name:
 * lowercase, non-alphanumeric runs collapsed to a single underscore, leading/
 * trailing underscores trimmed. "Guild Masters" → "guild_masters", "Rank 1" →
 * "rank_1".
 */
export function toFieldName(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/** A hierarchy's levels sorted by level number, regardless of storage order. */
export function sortedLevels(hierarchy: OrganizationHierarchy): OrganizationLevel[] {
	return [...hierarchy.levels].sort((a, b) => a.level - b.level);
}

/** Case-insensitive, trimmed lookup of a hierarchy by name. */
export function findHierarchy(
	settings: RelationsSettings,
	name: string,
): OrganizationHierarchy | undefined {
	const target = name.trim().toLowerCase();
	return settings.organizationHierarchies.find(
		(h) => h.name.trim().toLowerCase() === target,
	);
}

/** True if another hierarchy already uses this name (case-insensitive). Pass
 * `excludeIndex` when checking a rename so the hierarchy being edited doesn't
 * collide with itself. */
export function isHierarchyNameTaken(
	settings: RelationsSettings,
	name: string,
	excludeIndex?: number,
): boolean {
	const target = name.trim().toLowerCase();
	if (!target) return false;
	return settings.organizationHierarchies.some(
		(h, i) => i !== excludeIndex && h.name.trim().toLowerCase() === target,
	);
}

/** A level row as edited in the settings modal, before validation confirms
 * `level` is a real positive integer. */
export interface LevelDraft {
	level: number | null;
	name: string;
	color: string;
	lineStyle: LineStyle;
}

export interface LevelValidation {
	errors: string[];
	warnings: string[];
}

/**
 * Validate a set of level rows against the spec's hard/soft rules:
 *  - at least 2 levels
 *  - level numbers are positive integers, no duplicates
 *  - every level has a non-empty name
 *  - (soft) gaps in numbering produce a warning, not an error
 */
export function validateLevels(levels: LevelDraft[]): LevelValidation {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (levels.length < 2) {
		errors.push("At least 2 levels are required.");
	}

	const counts = new Map<number, number>();
	for (const l of levels) {
		if (l.level == null || !Number.isInteger(l.level) || l.level < 1) {
			errors.push("Level numbers must be positive integers.");
		} else {
			counts.set(l.level, (counts.get(l.level) ?? 0) + 1);
		}
		if (!l.name || !l.name.trim()) {
			errors.push("Every level needs a name.");
		}
	}
	for (const [num, count] of counts) {
		if (count > 1) errors.push(`Level ${num} already exists.`);
	}

	const nums = [...counts.keys()].sort((a, b) => a - b);
	for (let i = 1; i < nums.length; i++) {
		if (nums[i] - nums[i - 1] > 1) {
			warnings.push(
				`Levels jump from ${nums[i - 1]} to ${nums[i]}. Gaps are allowed, but confirm this is intentional.`,
			);
		}
	}

	return { errors, warnings };
}

export interface OrgLegendEntry {
	name: string;
	color: string;
}

export type OrgGraphResult =
	| { graph: RelationsGraph; legend: OrgLegendEntry[] }
	| { error: string };

/**
 * Build a top-down RelationsGraph for one Group note's organization hierarchy.
 *
 * For each level (sorted, top to bottom):
 *  - Read the frontmatter field named after the level (see toFieldName) and
 *    resolve its wikilinks/plain names to member nodes.
 *  - Empty levels are skipped entirely (no node, no gap in the legend).
 *  - A level with exactly one member is represented by that member's own node
 *    directly — no redundant "level" node when there's nothing to group.
 *  - A level with multiple members gets a synthetic colored "hub" node labeled
 *    with the level name; members fan out from it with plain connector edges.
 *  - Consecutive levels' representative nodes (hub or lone member) are chained
 *    top-down with a directed edge colored to match the lower level.
 *
 * Returns an error string (for display in the code block) when the hierarchy
 * has no levels, or when the note has no data for any level at all.
 */
export function buildOrganizationGraph(
	app: App,
	settings: RelationsSettings,
	hierarchy: OrganizationHierarchy,
	groupNote: TFile,
): OrgGraphResult {
	const levels = sortedLevels(hierarchy);
	if (levels.length === 0) {
		return { error: `Hierarchy "${hierarchy.name}" has no levels defined.` };
	}

	const frontmatter = app.metadataCache.getFileCache(groupNote)?.frontmatter;

	const nodesById = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];
	const legend: OrgLegendEntry[] = [];
	let previousRepId: string | null = null;
	let anyMembers = false;

	levels.forEach((level, idx) => {
		const color = level.color?.trim() || defaultLevelColor(idx);
		const fieldName = toFieldName(level.name);
		if (!fieldName) return;

		const raw: unknown = frontmatter ? frontmatter[fieldName] : undefined;
		const targets = extractLinkTargets(raw);
		if (targets.length === 0) return;

		anyMembers = true;
		legend.push({ name: level.name, color });

		const members = targets.map((t) => resolveMemberNode(app, settings, groupNote, fieldName, t));
		for (const m of members) {
			if (!nodesById.has(m.id)) nodesById.set(m.id, m);
		}

		let repId: string;
		if (members.length === 1) {
			const only = nodesById.get(members[0].id)!;
			only.ringColor = color;
			repId = only.id;
		} else {
			const hubId = `org-hub::${fieldName}`;
			nodesById.set(hubId, {
				id: hubId,
				label: level.name,
				tags: [],
				image: null,
				fillColor: color,
			});
			for (const m of members) {
				edges.push({
					source: hubId,
					target: m.id,
					type: ORG_MEMBER_EDGE_TYPE,
					color: "#888888",
					symmetric: true,
					pair: false,
					lineStyle: "solid",
					genealogy: false,
				});
			}
			repId = hubId;
		}

		if (previousRepId) {
			edges.push({
				source: previousRepId,
				target: repId,
				type: ORG_LEVEL_EDGE_TYPE,
				color,
				symmetric: false,
				pair: false,
				lineStyle: level.lineStyle || "solid",
				genealogy: false,
			});
		}
		previousRepId = repId;
	});

	if (!anyMembers) {
		return { error: `No members found for hierarchy "${hierarchy.name}" in this note.` };
	}

	return { graph: { nodes: [...nodesById.values()], edges }, legend };
}

/**
 * Resolve one member reference (already alias-stripped by extractLinkTargets)
 * to a GraphNode. Resolved wikilinks reuse buildNode so members get the same
 * portrait/badge treatment as any other node. Unresolved references (typo'd
 * link, or a plain name with no matching note) still render — as a plain
 * node carrying the raw text as its label — rather than silently disappearing.
 */
function resolveMemberNode(
	app: App,
	settings: RelationsSettings,
	groupNote: TFile,
	fieldName: string,
	rawTarget: string,
): GraphNode {
	const resolved = app.metadataCache.getFirstLinkpathDest(rawTarget, groupNote.path);
	if (resolved instanceof TFile) {
		return buildNode(app, resolved, settings) ?? { id: resolved.path, label: resolved.basename, tags: [], image: null };
	}
	return {
		id: `org-unresolved::${fieldName}::${rawTarget}`,
		label: rawTarget,
		tags: [],
		image: null,
	};
}
