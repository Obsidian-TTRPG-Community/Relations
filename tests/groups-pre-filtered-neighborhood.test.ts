import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import {
	buildLocalGraph,
	buildConnectedGraph,
	buildFamilyNeighborhood,
} from "../src/graph";
import type { RelationsSettings, RelationshipType } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Regression tests for the "hop-limited neighborhood walked over ALL edge
 * groups before the groups: filter" bug — the groups: counterpart of the
 * same root cause tracked for the global type filter as #28/#29 (that fix is
 * intentionally NOT depended on here; disabledTypes is left exactly as it is
 * in main, unaddressed by this branch).
 *
 * Root cause: buildLocalGraph / buildConnectedGraph / buildFamilyNeighborhood
 * computed reachability over the full, unfiltered graph, then a groups:
 * filter would have been applied afterward (in codeblock.ts). A note
 * reachable ONLY through a hidden-group edge could still survive as an
 * orphan if it happened to have its OWN edge of a type in a still-visible
 * group — that edge kept it from being pruned as isolated, even though the
 * edge that actually brought it into the neighborhood was invisible.
 *
 * Fixed by filtering groups: BEFORE the hop-limited / connected-component /
 * family walk, so hop distance is computed over only the edges the user can
 * actually see.
 */

interface FakeNote {
	path: string;
	frontmatter: Record<string, unknown>;
}

function makeFakeApp(notes: FakeNote[]): App {
	const files = notes.map((n) => {
		const f = new TFile();
		f.path = n.path;
		f.basename = n.path.replace(/\.md$/, "").split("/").pop() ?? n.path;
		return f;
	});
	const byPath = new Map(files.map((f) => [f.path, f]));
	const byBasename = new Map(files.map((f) => [f.basename.toLowerCase(), f]));
	const fmByPath = new Map(notes.map((n) => [n.path, n.frontmatter]));

	return {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getResourcePath: (f: TFile) => `app://${f.path}`,
		},
		metadataCache: {
			getFileCache: (f: TFile) => ({ frontmatter: fmByPath.get(f.path) }),
			getFirstLinkpathDest: (link: string, _from: string) =>
				byBasename.get(link.toLowerCase()) ?? null,
		},
	} as unknown as App;
}

function socialType(name: string, overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name,
		color: "#22c55e",
		symmetric: true,
		pair: false,
		treeLayout: false,
		lineStyle: "solid",
		genealogy: false,
		...overrides,
	};
}

function familyParentType(overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name: "parent",
		color: "#b45309",
		symmetric: false,
		pair: false,
		treeLayout: true,
		lineStyle: "solid",
		genealogy: true,
		...overrides,
	};
}

function spouseType(overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name: "spouse",
		color: "#d946ef",
		symmetric: true,
		pair: true,
		treeLayout: false,
		lineStyle: "double",
		genealogy: false,
		...overrides,
	};
}

function settingsWith(
	types: RelationshipType[],
	overrides: Partial<RelationsSettings> = {},
): RelationsSettings {
	return { ...DEFAULT_SETTINGS, relationshipTypes: types, ...overrides };
}

function ids(graph: { nodes: { id: string }[] }): string[] {
	return graph.nodes.map((n) => n.id).sort();
}

describe("buildLocalGraph — pre-filtered hop distance (groups)", () => {
	// Varinka --parent (Family, hidden)--> Amalayin --enemy (Conflict, hidden)--> Kolimot
	// Varinka <--parent (Family, hidden)-- Twice --ally (Social, visible)--> AllyA/B/C/D
	const VAULT: FakeNote[] = [
		{ path: "Varinka.md", frontmatter: { parent: ["[[Amalayin]]"] } },
		{ path: "Amalayin.md", frontmatter: { enemy: ["[[Kolimot]]"] } },
		{ path: "Kolimot.md", frontmatter: {} },
		{ path: "Twice.md", frontmatter: { parent: ["[[Varinka]]"], ally: ["[[AllyA]]", "[[AllyB]]", "[[AllyC]]", "[[AllyD]]"] } },
		{ path: "AllyA.md", frontmatter: {} },
		{ path: "AllyB.md", frontmatter: {} },
		{ path: "AllyC.md", frontmatter: {} },
		{ path: "AllyD.md", frontmatter: {} },
	];

	const TYPES = [
		familyParentType({ group: "Family" }),
		socialType("enemy", { group: "Conflict" }),
		socialType("ally", { group: "Social" }),
	];

	it("excludes a node reachable only via a hidden-group edge, not just the edge itself", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES);
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, new Set(["Social"]));
		// Amalayin/Kolimot and Twice/Ally* are only reachable through the
		// Family-grouped parent edges, which "Social" doesn't include — with
		// the fix they must not appear at all, not survive as a disconnected
		// orphan cluster.
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still finds a node reachable via a matching-group path even when a shorter non-matching path also exists", () => {
		// C --social (Social, visible)--> A --parent (Family, hidden)--> B
		// C --social (Social, visible)--> E --social (Social, visible)--> B
		const app = makeFakeApp([
			{ path: "C.md", frontmatter: { social: ["[[A]]", "[[E]]"] } },
			{ path: "A.md", frontmatter: { parent: ["[[B]]"] } },
			{ path: "E.md", frontmatter: { social: ["[[B]]"] } },
			{ path: "B.md", frontmatter: {} },
		]);
		const settings = settingsWith([
			familyParentType({ group: "Family" }),
			socialType("social", { group: "Social" }),
		]);
		const graph = buildLocalGraph(app, settings, "C.md", 2, null, new Set(["Social"]));
		expect(ids(graph)).toEqual(["A.md", "B.md", "C.md", "E.md"]);
		const edgePairs = graph.edges.map((e) => `${e.source}->${e.target}`).sort();
		expect(edgePairs).toEqual(["C.md->A.md", "C.md->E.md", "E.md->B.md"]);
	});

	it("retains the center note even when every visible-group edge is filtered away", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES);
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, new Set(["Nonexistent"]));
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("is unaffected when no groups filter is passed (undefined)", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES);
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, undefined);
		expect(ids(graph)).toEqual(["AllyA.md", "AllyB.md", "AllyC.md", "AllyD.md", "Amalayin.md", "Kolimot.md", "Twice.md", "Varinka.md"]);
	});
});

describe("buildConnectedGraph — pre-filtered reachability (groups)", () => {
	it("excludes a whole cluster reachable only through a hidden-group edge", () => {
		const app = makeFakeApp([
			{ path: "Varinka.md", frontmatter: { parent: ["[[Amalayin]]"] } },
			{ path: "Amalayin.md", frontmatter: { enemy: ["[[Kolimot]]"] } },
			{ path: "Kolimot.md", frontmatter: {} },
		]);
		const settings = settingsWith([
			familyParentType({ group: "Family" }),
			socialType("enemy", { group: "Conflict" }),
		]);
		const graph = buildConnectedGraph(app, settings, "Varinka.md", null, new Set(["Conflict"]));
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still walks arbitrarily far through an all-matching-group chain", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { social: ["[[B]]"] } },
			{ path: "B.md", frontmatter: { social: ["[[C]]"] } },
			{ path: "C.md", frontmatter: { social: ["[[D]]"] } },
			{ path: "D.md", frontmatter: {} },
		]);
		const settings = settingsWith([socialType("social", { group: "Social" })]);
		const graph = buildConnectedGraph(app, settings, "A.md", null, new Set(["Social"]));
		expect(ids(graph)).toEqual(["A.md", "B.md", "C.md", "D.md"]);
	});
});

describe("buildFamilyNeighborhood — pre-filtered genealogy walk (groups)", () => {
	it("excludes an ancestor's partner reachable only through a hidden-group parent edge", () => {
		// Focus --parent (Family, hidden)--> P --spouse (Bond, visible)-- Q
		const app = makeFakeApp([
			{ path: "Focus.md", frontmatter: { parent: ["[[P]]"] } },
			{ path: "P.md", frontmatter: { spouse: ["[[Q]]"] } },
			{ path: "Q.md", frontmatter: {} },
		]);
		const settings = settingsWith([
			familyParentType({ group: "Family" }),
			spouseType({ group: "Bond" }),
		]);
		const graph = buildFamilyNeighborhood(app, settings, "Focus.md", undefined, null, new Set(["Bond"]));
		// With the old pipeline, P and Q would survive as a disconnected pair
		// (P-Q is a visible-group spouse edge) even though the only path from
		// Focus to P is the now-hidden-group parent edge.
		expect(ids(graph)).toEqual(["Focus.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still includes the ancestor and partner when the parent type's group is included", () => {
		const app = makeFakeApp([
			{ path: "Focus.md", frontmatter: { parent: ["[[P]]"] } },
			{ path: "P.md", frontmatter: { spouse: ["[[Q]]"] } },
			{ path: "Q.md", frontmatter: {} },
		]);
		const settings = settingsWith([
			familyParentType({ group: "Family" }),
			spouseType({ group: "Bond" }),
		]);
		const graph = buildFamilyNeighborhood(app, settings, "Focus.md", undefined, null, new Set(["Family", "Bond"]));
		expect(ids(graph)).toEqual(["Focus.md", "P.md", "Q.md"]);
	});
});
