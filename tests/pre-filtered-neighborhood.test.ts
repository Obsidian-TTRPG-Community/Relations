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
 * types before the disabled-types filter" bug.
 *
 * Root cause: buildLocalGraph / buildConnectedGraph / buildFamilyNeighborhood
 * computed reachability over the full, unfiltered graph, then filtered edges
 * afterward (in codeblock.ts / view.ts). A note reachable ONLY through a
 * disabled-type edge could still survive as an orphan if it happened to have
 * its OWN edge of a still-enabled type — that edge kept it from being pruned
 * as isolated, even though the edge that actually brought it into the
 * neighborhood was invisible.
 *
 * Fixed by filtering disabledTypes BEFORE the hop-limited / connected-
 * component / family walk, so hop distance is computed over only the edges
 * the user can actually see.
 *
 * This reproduces the shape of the manually-discovered bug: a note (Varinka)
 * with the "Family" type disabled showed her parent (Amalayin, reachable only
 * via the now-hidden parent edge) and that parent's own still-enabled enemy
 * (Kolimot), because Amalayin's enemy edge kept her from being pruned.
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

describe("buildLocalGraph — pre-filtered hop distance (disabledTypes)", () => {
	// Varinka --parent (disabled)--> Amalayin --enemy (enabled)--> Kolimot
	// Varinka <--parent (disabled)-- Twice --ally (enabled)--> AllyA/B/C/D
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

	const TYPES = [familyParentType(), socialType("enemy"), socialType("ally")];

	it("excludes a node reachable only via a disabled-type edge, not just the disabled edge itself", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES, { disabledTypes: ["parent"] });
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null).graph;
		// Amalayin/Kolimot and Twice/Ally* are only reachable through the disabled
		// parent edges — with the fix they must not appear at all, not survive as
		// a disconnected orphan cluster.
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still finds a node reachable via an enabled path even when a shorter disabled path also exists", () => {
		// C --social--> A --parent(disabled)--> B
		// C --social--> E --social--> B
		// B is 2 hops out via the all-enabled C-E-B path, so it must still show
		// at depth 2 — the fix must recompute hop distance, not blanket-exclude
		// anything ever touched by a disabled edge. A is itself 1 hop from C via
		// an enabled edge, so it stays too — only its onward (disabled) A-B edge
		// is gone, meaning B is reached via E, not via A.
		const app = makeFakeApp([
			{ path: "C.md", frontmatter: { social: ["[[A]]", "[[E]]"] } },
			{ path: "A.md", frontmatter: { parent: ["[[B]]"] } },
			{ path: "E.md", frontmatter: { social: ["[[B]]"] } },
			{ path: "B.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType(), socialType("social")], { disabledTypes: ["parent"] });
		const graph = buildLocalGraph(app, settings, "C.md", 2, null).graph;
		expect(ids(graph)).toEqual(["A.md", "B.md", "C.md", "E.md"]);
		const edgePairs = graph.edges.map((e) => `${e.source}->${e.target}`).sort();
		expect(edgePairs).toEqual(["C.md->A.md", "C.md->E.md", "E.md->B.md"]);
	});

	it("retains the center note even when every visible edge is filtered away", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES, { disabledTypes: ["parent", "enemy", "ally"] });
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null).graph;
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});
});

describe("buildConnectedGraph — pre-filtered reachability (disabledTypes)", () => {
	it("excludes a whole cluster reachable only through a disabled-type edge", () => {
		const app = makeFakeApp([
			{ path: "Varinka.md", frontmatter: { parent: ["[[Amalayin]]"] } },
			{ path: "Amalayin.md", frontmatter: { enemy: ["[[Kolimot]]"] } },
			{ path: "Kolimot.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType(), socialType("enemy")], { disabledTypes: ["parent"] });
		const graph = buildConnectedGraph(app, settings, "Varinka.md", null).graph;
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still walks arbitrarily far through an all-enabled chain", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { social: ["[[B]]"] } },
			{ path: "B.md", frontmatter: { social: ["[[C]]"] } },
			{ path: "C.md", frontmatter: { social: ["[[D]]"] } },
			{ path: "D.md", frontmatter: {} },
		]);
		const settings = settingsWith([socialType("social")]);
		const graph = buildConnectedGraph(app, settings, "A.md", null).graph;
		expect(ids(graph)).toEqual(["A.md", "B.md", "C.md", "D.md"]);
	});
});

describe("buildFamilyNeighborhood — pre-filtered genealogy walk (disabledTypes)", () => {
	it("excludes an ancestor's partner reachable only through a disabled parent edge", () => {
		// Focus --parent (disabled)--> P --spouse (enabled)-- Q
		const app = makeFakeApp([
			{ path: "Focus.md", frontmatter: { parent: ["[[P]]"] } },
			{ path: "P.md", frontmatter: { spouse: ["[[Q]]"] } },
			{ path: "Q.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType(), spouseType()], { disabledTypes: ["parent"] });
		const graph = buildFamilyNeighborhood(app, settings, "Focus.md", undefined, null).graph;
		// With the old pipeline, P and Q would survive as a disconnected pair
		// (P-Q is an enabled spouse edge) even though the only path from Focus
		// to P is the now-disabled parent edge.
		expect(ids(graph)).toEqual(["Focus.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still includes the ancestor and partner when the parent type is enabled", () => {
		const app = makeFakeApp([
			{ path: "Focus.md", frontmatter: { parent: ["[[P]]"] } },
			{ path: "P.md", frontmatter: { spouse: ["[[Q]]"] } },
			{ path: "Q.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType(), spouseType()]);
		const graph = buildFamilyNeighborhood(app, settings, "Focus.md", undefined, null).graph;
		expect(ids(graph)).toEqual(["Focus.md", "P.md", "Q.md"]);
	});
});

/**
 * Regression tests for the `groups:` counterpart of the same bug — reported
 * separately (bug_report_graph_filtering.md / github_bug_report_orphaned_nodes.md)
 * after the disabledTypes fix above shipped, because `groups:` filtering was
 * built independently and still filtered the hop-limited graph after the walk
 * instead of before it. Same fix shape: buildLocalGraph / buildConnectedGraph /
 * buildFamilyNeighborhood now take an optional `groups` set and apply
 * filterGraphByGroups before the walk, exactly like disabledTypes.
 *
 * Reproduces the reported case: Varinka (parent type is in the "Family"
 * group, enemy/ally are in "Social") rendered with `groups: Social` should
 * not show her parent Amalayin (reachable only via the now-hidden Family-group
 * parent edge) even though Amalayin has her own visible Social-group enemy edge.
 */
describe("buildLocalGraph — pre-filtered hop distance (groups)", () => {
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
		socialType("enemy", { group: "Social" }),
		socialType("ally", { group: "Social" }),
	];

	it("excludes a node reachable only via a hidden-group edge, not just the edge itself", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES);
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, new Set(["Social"])).graph;
		// Amalayin/Kolimot and Twice/Ally* are only reachable through the
		// Family-group parent edges, hidden by `groups: Social` — they must not
		// appear at all, not survive as a disconnected orphan cluster.
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});

	it("still shows the node when its group is included", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES);
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, new Set(["Family"])).graph;
		expect(ids(graph)).toEqual(["Amalayin.md", "Twice.md", "Varinka.md"]);
	});

	it("composes with the global disabledTypes filter", () => {
		const app = makeFakeApp(VAULT);
		const settings = settingsWith(TYPES, { disabledTypes: ["ally"] });
		const graph = buildLocalGraph(app, settings, "Varinka.md", 2, null, new Set(["Family", "Social"])).graph;
		// ally is disabled globally, so Twice's Ally* cluster vanishes, but the
		// Family-group parent edge from Twice to Varinka stays visible — Twice
		// himself still shows, and Amalayin's still-enabled Social-group enemy
		// edge to Kolimot puts Kolimot at exactly 2 hops out.
		expect(ids(graph)).toEqual(["Amalayin.md", "Kolimot.md", "Twice.md", "Varinka.md"]);
	});
});

describe("buildConnectedGraph — pre-filtered reachability (groups)", () => {
	it("excludes a whole cluster reachable only through a hidden-group edge", () => {
		const app = makeFakeApp([
			{ path: "Varinka.md", frontmatter: { parent: ["[[Amalayin]]"] } },
			{ path: "Amalayin.md", frontmatter: { enemy: ["[[Kolimot]]"] } },
			{ path: "Kolimot.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType({ group: "Family" }), socialType("enemy", { group: "Social" })]);
		const graph = buildConnectedGraph(app, settings, "Varinka.md", null, new Set(["Social"])).graph;
		expect(ids(graph)).toEqual(["Varinka.md"]);
		expect(graph.edges).toEqual([]);
	});
});

describe("buildFamilyNeighborhood — pre-filtered genealogy walk (groups)", () => {
	it("excludes an ancestor's partner reachable only through a hidden-group parent edge", () => {
		const app = makeFakeApp([
			{ path: "Focus.md", frontmatter: { parent: ["[[P]]"] } },
			{ path: "P.md", frontmatter: { spouse: ["[[Q]]"] } },
			{ path: "Q.md", frontmatter: {} },
		]);
		const settings = settingsWith([familyParentType({ group: "Family" }), spouseType({ group: "Romance" })]);
		const graph = buildFamilyNeighborhood(app, settings, "Focus.md", undefined, null, new Set(["Romance"])).graph;
		expect(ids(graph)).toEqual(["Focus.md"]);
		expect(graph.edges).toEqual([]);
	});
});
