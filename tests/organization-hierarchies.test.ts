import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import {
	toFieldName,
	validateLevels,
	findHierarchy,
	isHierarchyNameTaken,
	buildOrganizationGraph,
} from "../src/organization-hierarchies";
import type { LevelDraft } from "../src/organization-hierarchies";
import type { OrganizationHierarchy, RelationsSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

// color/lineStyle/useHostNoteIfEmpty are irrelevant to validateLevels — this
// just satisfies LevelDraft's shape.
function lvl(level: number | null, name: string): LevelDraft {
	return { level, name, color: "#000000", lineStyle: "solid", useHostNoteIfEmpty: false };
}

// ---------------------------------------------------------------------------
// Minimal fake vault, modeled on tests/declares-child.test.ts — enough of App
// for buildOrganizationGraph: frontmatter lookup and name-based link resolution.
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
	const byBasename = new Map(files.map((f) => [f.basename.toLowerCase(), f]));
	const fmByPath = new Map(notes.map((n) => [n.path, n.frontmatter]));

	return {
		vault: {
			getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
			getResourcePath: (f: TFile) => `app://${f.path}`,
		},
		metadataCache: {
			getFileCache: (f: TFile) => ({ frontmatter: fmByPath.get(f.path) }),
			getFirstLinkpathDest: (link: string, _from: string) =>
				byBasename.get(link.toLowerCase()) ?? null,
		},
	} as unknown as App;
}

function fileFor(app: App, path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
	return f;
}

const PARTY_STRUCTURE: OrganizationHierarchy = {
	name: "Party Structure",
	levels: [
		{ level: 1, name: "Leader" },
		{ level: 2, name: "Officers" },
		{ level: 3, name: "Members" },
		{ level: 4, name: "Initiates" },
	],
};

function settings(overrides: Partial<RelationsSettings> = {}): RelationsSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("toFieldName", () => {
	it("lowercases a single word", () => {
		expect(toFieldName("Leader")).toBe("leader");
	});

	it("joins multiple words with underscores", () => {
		expect(toFieldName("Guild Masters")).toBe("guild_masters");
	});

	it("collapses non-alphanumeric runs to one underscore", () => {
		expect(toFieldName("Inner   Circle!!")).toBe("inner_circle");
	});

	it("keeps numbers", () => {
		expect(toFieldName("Rank 1")).toBe("rank_1");
	});

	it("trims leading/trailing separators", () => {
		expect(toFieldName("  Officers  ")).toBe("officers");
	});
});

describe("validateLevels", () => {
	it("requires at least 2 levels", () => {
		const { errors } = validateLevels([lvl(1, "Leader")]);
		expect(errors).toContain("At least 2 levels are required.");
	});

	it("accepts a normal 1..4 sequence with no errors or warnings", () => {
		const { errors, warnings } = validateLevels([
			lvl(1, "Leader"),
			lvl(2, "Officers"),
			lvl(3, "Members"),
			lvl(4, "Initiates"),
		]);
		expect(errors).toEqual([]);
		expect(warnings).toEqual([]);
	});

	it("flags duplicate level numbers", () => {
		const { errors } = validateLevels([lvl(1, "Leader"), lvl(1, "Officers")]);
		expect(errors).toContain("Level 1 already exists.");
	});

	it("flags non-integer/zero/negative level numbers", () => {
		const { errors } = validateLevels([lvl(0, "Leader"), lvl(2, "Officers")]);
		expect(errors).toContain("Level numbers must be positive integers.");
	});

	it("flags empty names", () => {
		const { errors } = validateLevels([lvl(1, ""), lvl(2, "  ")]);
		expect(errors).toContain("Every level needs a name.");
	});

	it("warns (but does not error) on gaps", () => {
		const { errors, warnings } = validateLevels([lvl(1, "Leader"), lvl(2, "Officers"), lvl(5, "Members")]);
		expect(errors).toEqual([]);
		expect(warnings.some((w) => w.includes("jump from 2 to 5"))).toBe(true);
	});

	it("allows large gaps (10, 20, 30) with only warnings", () => {
		const { errors, warnings } = validateLevels([lvl(10, "A"), lvl(20, "B"), lvl(30, "C")]);
		expect(errors).toEqual([]);
		expect(warnings.length).toBe(2);
	});
});

describe("findHierarchy / isHierarchyNameTaken", () => {
	const s = settings({ organizationHierarchies: [PARTY_STRUCTURE] });

	it("finds a hierarchy case-insensitively", () => {
		expect(findHierarchy(s, "party structure")).toBe(PARTY_STRUCTURE);
		expect(findHierarchy(s, "PARTY STRUCTURE")).toBe(PARTY_STRUCTURE);
	});

	it("returns undefined for an unknown name", () => {
		expect(findHierarchy(s, "Guild Ranks")).toBeUndefined();
	});

	it("detects a taken name case-insensitively", () => {
		expect(isHierarchyNameTaken(s, "party structure")).toBe(true);
		expect(isHierarchyNameTaken(s, "Guild Ranks")).toBe(false);
	});

	it("excludes the hierarchy being edited by index", () => {
		expect(isHierarchyNameTaken(s, "Party Structure", 0)).toBe(false);
	});
});

describe("buildOrganizationGraph", () => {
	it("errors when the hierarchy has no levels", () => {
		const app = makeFakeApp([{ path: "Group.md", frontmatter: {} }]);
		const empty: OrganizationHierarchy = { name: "Empty", levels: [] };
		const result = buildOrganizationGraph(app, settings(), empty, fileFor(app, "Group.md"));
		expect("error" in result).toBe(true);
	});

	it("errors when the note has no data for any level", () => {
		const app = makeFakeApp([{ path: "Group.md", frontmatter: {} }]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.error).toContain("Party Structure");
		}
	});

	it("useHostNoteIfEmpty: shows the host note itself as an empty level's sole member", () => {
		const worship: OrganizationHierarchy = {
			name: "Worship Hierarchy",
			levels: [
				{ level: 1, name: "Deity", color: "#dc2626", useHostNoteIfEmpty: true },
				{ level: 2, name: "Worshippers", color: "#22c55e" },
			],
		};
		const app = makeFakeApp([
			{ path: "Solari.md", frontmatter: { worshippers: ["[[Kess]]", "[[Dorn]]"] } },
			{ path: "Kess.md", frontmatter: {} },
			{ path: "Dorn.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), worship, fileFor(app, "Solari.md"));
		if ("error" in result) throw new Error("expected a graph");

		expect(result.legend.map((l) => l.name)).toEqual(["Deity", "Worshippers"]);
		const deityNode = result.graph.nodes.find((n) => n.id === "Solari.md");
		expect(deityNode).toBeDefined();
		expect(deityNode?.ringColor).toBe("#dc2626");
		const chainEdge = result.graph.edges.find(
			(e) => e.source === "Solari.md" && e.target === "org-hub::worshippers",
		);
		expect(chainEdge).toBeDefined();
	});

	it("useHostNoteIfEmpty: explicit frontmatter data still wins over the host-note fallback", () => {
		const worship: OrganizationHierarchy = {
			name: "Worship Hierarchy",
			levels: [
				{ level: 1, name: "Deity", useHostNoteIfEmpty: true },
				{ level: 2, name: "Worshippers" },
			],
		};
		const app = makeFakeApp([
			{ path: "Temple Record.md", frontmatter: { deity: "[[Solari]]", worshippers: ["[[Kess]]"] } },
			{ path: "Solari.md", frontmatter: {} },
			{ path: "Kess.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), worship, fileFor(app, "Temple Record.md"));
		if ("error" in result) throw new Error("expected a graph");

		// The host note ("Temple Record.md") should NOT appear — Solari does, from the explicit link.
		expect(result.graph.nodes.some((n) => n.id === "Temple Record.md")).toBe(false);
		expect(result.graph.nodes.some((n) => n.id === "Solari.md")).toBe(true);
	});

	it("levels without useHostNoteIfEmpty still skip when their field is empty (regression)", () => {
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { officers: ["[[A]]", "[[B]]"] } },
			{ path: "A.md", frontmatter: {} },
			{ path: "B.md", frontmatter: {} },
		]);
		// PARTY_STRUCTURE's "Leader" level has no useHostNoteIfEmpty set, and this
		// note declares no `leader:` field — it must still be skipped, not
		// replaced by the host note.
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.legend.map((l) => l.name)).toEqual(["Officers"]);
		expect(result.graph.nodes.some((n) => n.id === "Group.md")).toBe(false);
	});

	it("useHostNoteIfEmpty avoids the false 'no members' error when it's the only level with data", () => {
		const worship: OrganizationHierarchy = {
			name: "Worship Hierarchy",
			levels: [
				{ level: 1, name: "Deity", useHostNoteIfEmpty: true },
				{ level: 2, name: "Worshippers" },
			],
		};
		const app = makeFakeApp([{ path: "Solari.md", frontmatter: {} }]);
		const result = buildOrganizationGraph(app, settings(), worship, fileFor(app, "Solari.md"));
		expect("error" in result).toBe(false);
		if (!("error" in result)) {
			expect(result.graph.nodes.map((n) => n.id)).toEqual(["Solari.md"]);
		}
	});

	it("collapses a single-member level to that member's own node (no hub)", () => {
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Bob]]" } },
			{ path: "Bob.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.graph.nodes.map((n) => n.id)).toEqual(["Bob.md"]);
		expect(result.graph.nodes[0].ringColor).toBeDefined();
		expect(result.graph.edges).toEqual([]);
		expect(result.legend).toEqual([{ name: "Leader", color: result.legend[0].color }]);
	});

	it("uses a level's custom color when set", () => {
		const customized: OrganizationHierarchy = {
			name: "Custom Colors",
			levels: [
				{ level: 1, name: "Leader", color: "#123456" },
				{ level: 2, name: "Officers", color: "#abcdef" },
			],
		};
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Bob]]", officers: ["[[A]]", "[[B]]"] } },
			{ path: "Bob.md", frontmatter: {} },
			{ path: "A.md", frontmatter: {} },
			{ path: "B.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), customized, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.legend).toEqual([
			{ name: "Leader", color: "#123456" },
			{ name: "Officers", color: "#abcdef" },
		]);
		expect(result.graph.nodes.find((n) => n.id === "Bob.md")?.ringColor).toBe("#123456");
		expect(result.graph.nodes.find((n) => n.id === "org-hub::officers")?.fillColor).toBe("#abcdef");
	});

	it("falls back to the default palette when a level has no stored color", () => {
		const noColor: OrganizationHierarchy = {
			name: "No Colors",
			levels: [{ level: 1, name: "Leader" }, { level: 2, name: "Officers" }],
		};
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Bob]]" } },
			{ path: "Bob.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), noColor, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.legend[0].color).toBe("#dc2626");
	});

	it("creates a hub node with fan edges for a multi-member level", () => {
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { officers: ["[[A]]", "[[B]]"] } },
			{ path: "A.md", frontmatter: {} },
			{ path: "B.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		const hub = result.graph.nodes.find((n) => n.id === "org-hub::officers");
		expect(hub).toBeDefined();
		expect(hub?.fillColor).toBeDefined();
		expect(result.graph.edges).toHaveLength(2);
		expect(result.graph.edges.every((e) => e.source === "org-hub::officers")).toBe(true);
		expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(["A.md", "B.md", "org-hub::officers"]);
	});

	it("skips levels with no members entirely", () => {
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Bob]]", members: ["[[C]]"] } },
			{ path: "Bob.md", frontmatter: {} },
			{ path: "C.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.legend.map((l) => l.name)).toEqual(["Leader", "Members"]);
	});

	it("chains consecutive levels' representative nodes top-down", () => {
		const app = makeFakeApp([
			{
				path: "Group.md",
				frontmatter: {
					leader: "[[Bob]]",
					officers: ["[[A]]", "[[B]]"],
				},
			},
			{ path: "Bob.md", frontmatter: {} },
			{ path: "A.md", frontmatter: {} },
			{ path: "B.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		const chainEdge = result.graph.edges.find((e) => e.source === "Bob.md" && e.target === "org-hub::officers");
		expect(chainEdge).toBeDefined();
		expect(chainEdge?.lineStyle).toBe("solid");
	});

	it("uses a level's lineStyle for its incoming connector edge, defaulting to solid", () => {
		const dashed: OrganizationHierarchy = {
			name: "Dashed Officers",
			levels: [
				{ level: 1, name: "Leader" },
				{ level: 2, name: "Officers", lineStyle: "dashed" },
			],
		};
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Bob]]", officers: ["[[A]]", "[[B]]"] } },
			{ path: "Bob.md", frontmatter: {} },
			{ path: "A.md", frontmatter: {} },
			{ path: "B.md", frontmatter: {} },
		]);
		const result = buildOrganizationGraph(app, settings(), dashed, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		const chainEdge = result.graph.edges.find((e) => e.source === "Bob.md" && e.target === "org-hub::officers");
		expect(chainEdge?.lineStyle).toBe("dashed");
	});

	it("keeps unresolved links visible as plain nodes instead of dropping them", () => {
		const app = makeFakeApp([
			{ path: "Group.md", frontmatter: { leader: "[[Nobody]]" } },
		]);
		const result = buildOrganizationGraph(app, settings(), PARTY_STRUCTURE, fileFor(app, "Group.md"));
		if ("error" in result) throw new Error("expected a graph");
		expect(result.graph.nodes).toHaveLength(1);
		expect(result.graph.nodes[0].label).toBe("Nobody");
	});
});
