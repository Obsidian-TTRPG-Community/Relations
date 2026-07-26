import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import { buildFullGraph, dedupeEdges, filterFamilyNeighborhood } from "../src/graph";
import type { GraphEdge, RelationsSettings, RelationshipType } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Regression tests for issue #21: asymmetrical genealogy declarations.
 *
 * The data model stores genealogy edges child→parent (matching `parent: [[X]]`
 * written on the child's note). A parent-declaring type — `children: [[Kid]]`
 * on the parent's note — previously had no correct configuration: marking it
 * GEN corrupted the direction (the parent read as the child's child), and
 * leaving it un-flagged made children declared only that way invisible to
 * family views.
 *
 * The fix: RelationshipType.declaresChild. When set on a genealogy type, the
 * edge is swapped at scan time so storage stays uniformly child→parent, and
 * dedupeEdges collapses genealogy edges per directed node-pair regardless of
 * type name, so a bond declared from both sides renders as one edge.
 */

// ---------------------------------------------------------------------------
// Minimal fake vault. Enough of App for buildFullGraph: markdown file listing,
// frontmatter lookup, and basename-based link resolution.
// ---------------------------------------------------------------------------

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

function genType(name: string, overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name,
		color: "#b45309",
		symmetric: false,
		pair: false,
		treeLayout: true,
		lineStyle: "solid",
		genealogy: true,
		...overrides,
	};
}

function settingsWith(types: RelationshipType[]): RelationsSettings {
	return { ...DEFAULT_SETTINGS, relationshipTypes: types };
}

function edgePairs(edges: GraphEdge[]): string[] {
	return edges.map((e) => `${e.source}->${e.target}`).sort();
}

// The exact vault from issue #21's reproduction steps.
const ISSUE_21_VAULT: FakeNote[] = [
	{ path: "Amalayin.md", frontmatter: { children: ['[[Varinka]]'] } },
	{ path: "Varinka.md", frontmatter: { parents: ['[[Amalayin]]'], children: ['[[Twice]]'] } },
	{ path: "Twice.md", frontmatter: { parents: [] } },
];

const ISSUE_21_TYPES = [
	genType("parents"),
	genType("children", { declaresChild: true }),
];

describe("declaresChild normalization (issue #21)", () => {
	it("stores declares-child edges child→parent", () => {
		const app = makeFakeApp([
			{ path: "Parent.md", frontmatter: { children: ['[[Kid]]'] } },
			{ path: "Kid.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([genType("children", { declaresChild: true })]));
		expect(edgePairs(graph.edges)).toEqual(["Kid.md->Parent.md"]);
	});

	it("keeps the configured type name on swapped edges", () => {
		const app = makeFakeApp([
			{ path: "Parent.md", frontmatter: { children: ['[[Kid]]'] } },
			{ path: "Kid.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([genType("children", { declaresChild: true })]));
		expect(graph.edges[0].type).toBe("children");
	});

	it("does not swap when declaresChild is set but genealogy is off", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { knows: ['[[B]]'] } },
			{ path: "B.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(
			app,
			settingsWith([genType("knows", { genealogy: false, declaresChild: true })]),
		);
		expect(edgePairs(graph.edges)).toEqual(["A.md->B.md"]);
	});

	it("does not swap plain child-declared genealogy types", () => {
		const app = makeFakeApp([
			{ path: "Kid.md", frontmatter: { parents: ['[[Parent]]'] } },
			{ path: "Parent.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([genType("parents")]));
		expect(edgePairs(graph.edges)).toEqual(["Kid.md->Parent.md"]);
	});

	it("collapses a both-sides-declared bond into a single edge", () => {
		// Amalayin declares `children: [[Varinka]]` AND Varinka declares
		// `parents: [[Amalayin]]` — one bond, one edge (issue #21's
		// "redundant and conflicting edges").
		const app = makeFakeApp(ISSUE_21_VAULT);
		const graph = buildFullGraph(app, settingsWith(ISSUE_21_TYPES));
		const between = graph.edges.filter(
			(e) =>
				(e.source === "Varinka.md" && e.target === "Amalayin.md") ||
				(e.source === "Amalayin.md" && e.target === "Varinka.md"),
		);
		expect(between).toHaveLength(1);
		expect(between[0].source).toBe("Varinka.md");
		expect(between[0].target).toBe("Amalayin.md");
	});

	it("renders a child declared ONLY via the parent's children: property", () => {
		// Twice is declared only by Varinka's `children:`; Twice.md itself has
		// an empty parents array. Previously invisible to family views.
		const app = makeFakeApp(ISSUE_21_VAULT);
		const graph = buildFullGraph(app, settingsWith(ISSUE_21_TYPES));
		expect(graph.nodes.map((n) => n.id).sort()).toEqual([
			"Amalayin.md", "Twice.md", "Varinka.md",
		]);
		expect(edgePairs(graph.edges)).toEqual([
			"Twice.md->Varinka.md",
			"Varinka.md->Amalayin.md",
		]);
	});

	it("family neighborhood from the grandparent reaches the children-only grandchild", () => {
		const app = makeFakeApp(ISSUE_21_VAULT);
		const graph = buildFullGraph(app, settingsWith(ISSUE_21_TYPES));
		const family = filterFamilyNeighborhood(graph, "Amalayin.md");
		expect(family.nodes.map((n) => n.id).sort()).toEqual([
			"Amalayin.md", "Twice.md", "Varinka.md",
		]);
	});

	it("asymmetrical and symmetrical declarations produce identical graphs", () => {
		// Issue #21's expected behaviour, stated directly: declaring from the
		// parent side only, the child side only, or both sides must all yield
		// the same nodes and edges.
		const parentSideOnly = buildFullGraph(
			makeFakeApp([
				{ path: "Amalayin.md", frontmatter: { children: ['[[Varinka]]'] } },
				{ path: "Varinka.md", frontmatter: {} },
			]),
			settingsWith(ISSUE_21_TYPES),
		);
		const childSideOnly = buildFullGraph(
			makeFakeApp([
				{ path: "Amalayin.md", frontmatter: {} },
				{ path: "Varinka.md", frontmatter: { parents: ['[[Amalayin]]'] } },
			]),
			settingsWith(ISSUE_21_TYPES),
		);
		expect(edgePairs(parentSideOnly.edges)).toEqual(edgePairs(childSideOnly.edges));
		expect(parentSideOnly.nodes.map((n) => n.id).sort()).toEqual(
			childSideOnly.nodes.map((n) => n.id).sort(),
		);
	});
});

describe("dedupeEdges genealogy pair-dedupe", () => {
	function gen(source: string, target: string, type: string): GraphEdge {
		return {
			source, target, type,
			color: "#b45309",
			symmetric: false,
			pair: false,
			lineStyle: "solid",
			genealogy: true,
		};
	}

	it("collapses same-pair genealogy edges of different types", () => {
		const out = dedupeEdges([gen("Kid", "Parent", "parents"), gen("Kid", "Parent", "children")]);
		expect(out).toHaveLength(1);
		expect(out[0].type).toBe("parents"); // first occurrence wins
	});

	it("keeps genealogy edges between different pairs", () => {
		const out = dedupeEdges([gen("Kid", "Parent", "parents"), gen("Kid", "OtherParent", "parents")]);
		expect(out).toHaveLength(2);
	});

	it("direction still matters for genealogy keys", () => {
		// A→B and B→A are contradictory declarations, not duplicates; keep both
		// so the user can see (and fix) the conflict.
		const out = dedupeEdges([gen("A", "B", "parents"), gen("B", "A", "parents")]);
		expect(out).toHaveLength(2);
	});

	it("leaves non-genealogy dedupe behaviour unchanged", () => {
		const ally = (s: string, t: string): GraphEdge => ({
			source: s, target: t, type: "ally",
			color: "#22c55e", symmetric: true, pair: false,
			lineStyle: "solid", genealogy: false,
		});
		expect(dedupeEdges([ally("A", "B"), ally("B", "A")])).toHaveLength(1);
	});
});
