import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import {
	buildFullGraph,
	buildLocalGraph,
	connectedComponent,
	extractLinks,
	extractLinkTargets,
	filterFamilyNeighborhood,
	filterGraphByTypes,
	localSubgraph,
	perspectiveLabel,
} from "../src/graph";
import type { RelationsGraph, RelationsSettings, RelationshipType } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Issue #14: context-aware display names. A note's relationship links can
 * carry an alias — `ally: "[[Meine Wald|The Enlightened One]]"` — and when the
 * graph is viewed from that note, the linked node shows the alias instead of
 * its basename. Aliases are stored per direction alongside the graph (not on
 * edges, which dedupe collapses) and applied only at render time.
 */

// ---------------------------------------------------------------------------
// Minimal fake vault (same shape as declares-child.test.ts).
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

function type(name: string, overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name,
		color: "#888",
		symmetric: false,
		pair: false,
		treeLayout: false,
		lineStyle: "solid",
		genealogy: false,
		...overrides,
	};
}

function settingsWith(types: RelationshipType[], extra: Partial<RelationsSettings> = {}): RelationsSettings {
	return { ...DEFAULT_SETTINGS, relationshipTypes: types, ...extra };
}

function node(graph: RelationsGraph, id: string) {
	const n = graph.nodes.find((x) => x.id === id);
	if (!n) throw new Error(`no node ${id}`);
	return n;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("extractLinks", () => {
	it("returns no alias for plain wikilinks", () => {
		expect(extractLinks("[[Alice]]")).toEqual([{ target: "Alice" }]);
	});

	it("captures the alias from [[Target|Alias]]", () => {
		expect(extractLinks("[[Meine Wald|The Enlightened One]]")).toEqual([
			{ target: "Meine Wald", alias: "The Enlightened One" },
		]);
	});

	it("strips a heading from the target but keeps the alias", () => {
		expect(extractLinks("[[Bob#Early life|Bobby]]")).toEqual([{ target: "Bob", alias: "Bobby" }]);
	});

	it("trims the alias and ignores an empty one", () => {
		expect(extractLinks("[[Bob|  Bobby  ]]")).toEqual([{ target: "Bob", alias: "Bobby" }]);
		expect(extractLinks("[[Bob|]]")).toEqual([{ target: "Bob" }]);
		expect(extractLinks("[[Bob|   ]]")).toEqual([{ target: "Bob" }]);
	});

	it("handles lists and multiple wikilinks in one string", () => {
		expect(extractLinks(["[[A|Ay]]", "[[B]]"])).toEqual([{ target: "A", alias: "Ay" }, { target: "B" }]);
		expect(extractLinks("[[A|Ay]], [[B|Bee]]")).toEqual([
			{ target: "A", alias: "Ay" },
			{ target: "B", alias: "Bee" },
		]);
	});

	it("never produces aliases from plain-text values", () => {
		expect(extractLinks("Bob|Bobby")).toEqual([{ target: "Bob" }]);
		expect(extractLinks("Alice, Bob|Bobby")).toEqual([{ target: "Alice" }, { target: "Bob" }]);
	});

	it("leaves extractLinkTargets output unchanged", () => {
		expect(extractLinkTargets(["[[A|Ay]]", "[[B#h]]", "C|x"])).toEqual(["A", "B", "C"]);
	});
});

// ---------------------------------------------------------------------------
// Collection during the scan
// ---------------------------------------------------------------------------

describe("buildFullGraph display names", () => {
	it("omits the map entirely when no link is aliased", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { ally: "[[B]]" } },
			{ path: "B.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([type("ally")]));
		expect(graph.displayNames).toBeUndefined();
	});

	it("keeps both directions' aliases for a symmetric edge collapsed by dedupe", () => {
		// The issue's scenario: each character has their own name for the other.
		const app = makeFakeApp([
			{ path: "Varinka.md", frontmatter: { friend: "[[Serion|Ser]]" } },
			{ path: "Serion.md", frontmatter: { friend: "[[Varinka|Little Star]]" } },
		]);
		const graph = buildFullGraph(app, settingsWith([type("friend", { symmetric: true })]));

		expect(graph.edges).toHaveLength(1); // dedupe collapsed the pair
		expect(graph.displayNames?.get("Varinka.md")?.get("Serion.md")).toBe("Ser");
		expect(graph.displayNames?.get("Serion.md")?.get("Varinka.md")).toBe("Little Star");
	});

	it("does not mutate node labels", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { ally: "[[B|Bee]]" } },
			{ path: "B.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([type("ally")]));
		expect(node(graph, "B.md").label).toBe("B");
	});

	it("skips aliases on unresolved, self and out-of-scope links", () => {
		const app = makeFakeApp([
			{ path: "In/A.md", frontmatter: { ally: ["[[Ghost|Boo]]", "[[A|Me]]", "[[B|Bee]]", "[[C|Sea]]"] } },
			{ path: "In/B.md", frontmatter: {} },
			{ path: "Out/C.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(app, settingsWith([type("ally")], { folderScopes: ["In"] }));
		expect([...(graph.displayNames?.get("In/A.md") ?? new Map())]).toEqual([["In/B.md", "Bee"]]);
	});

	it("keys declares-child aliases by the declaring note, not the swapped edge", () => {
		const app = makeFakeApp([
			{ path: "Mother.md", frontmatter: { children: "[[Kid|my little one]]" } },
			{ path: "Kid.md", frontmatter: {} },
		]);
		const graph = buildFullGraph(
			app,
			settingsWith([type("children", { genealogy: true, declaresChild: true })]),
		);
		expect(graph.edges[0]).toMatchObject({ source: "Kid.md", target: "Mother.md" });
		expect(graph.displayNames?.get("Mother.md")?.get("Kid.md")).toBe("my little one");
		expect(graph.displayNames?.get("Kid.md")).toBeUndefined();
	});

	describe("precedence when one note aliases a target differently", () => {
		const types = [type("rival"), type("ally")]; // rival is configured first

		it("the type earlier in settings wins, regardless of frontmatter key order", () => {
			for (const fm of [
				{ ally: "[[B|Friend]]", rival: "[[B|Nemesis]]" },
				{ rival: "[[B|Nemesis]]", ally: "[[B|Friend]]" },
			]) {
				const app = makeFakeApp([{ path: "A.md", frontmatter: fm }, { path: "B.md", frontmatter: {} }]);
				const graph = buildFullGraph(app, settingsWith(types));
				expect(graph.displayNames?.get("A.md")?.get("B.md")).toBe("Nemesis");
			}
		});

		it("an unaliased link in a higher-precedence type does not clear the alias", () => {
			const app = makeFakeApp([
				{ path: "A.md", frontmatter: { rival: "[[B]]", ally: "[[B|Friend]]" } },
				{ path: "B.md", frontmatter: {} },
			]);
			const graph = buildFullGraph(app, settingsWith(types));
			expect(graph.displayNames?.get("A.md")?.get("B.md")).toBe("Friend");
		});

		it("within one property, the first link wins", () => {
			const app = makeFakeApp([
				{ path: "A.md", frontmatter: { ally: ["[[B|First]]", "[[B|Second]]"] } },
				{ path: "B.md", frontmatter: {} },
			]);
			const graph = buildFullGraph(app, settingsWith(types));
			expect(graph.displayNames?.get("A.md")?.get("B.md")).toBe("First");
		});
	});
});

// ---------------------------------------------------------------------------
// Perspective resolution + propagation through derived graphs
// ---------------------------------------------------------------------------

// A → B (aliased), B → C (aliased by B), A also family with D.
const VAULT: FakeNote[] = [
	{ path: "A.md", frontmatter: { ally: "[[B|Bee]]", parent: "[[D|Mum]]" } },
	{ path: "B.md", frontmatter: { ally: "[[C|Sea]]" } },
	{ path: "C.md", frontmatter: {} },
	{ path: "D.md", frontmatter: {} },
];
const VAULT_TYPES = [type("ally"), type("parent", { genealogy: true, treeLayout: true })];

describe("perspectiveLabel", () => {
	const full = buildFullGraph(makeFakeApp(VAULT), settingsWith(VAULT_TYPES));

	it("shows the focus note's alias for its direct targets", () => {
		expect(perspectiveLabel(full, node(full, "B.md"), "A.md")).toBe("Bee");
		expect(perspectiveLabel(full, node(full, "D.md"), "A.md")).toBe("Mum");
	});

	it("falls back to the basename beyond the focus note's own links", () => {
		// B calls C "Sea", but we're looking from A — v1 only applies the focus's aliases.
		expect(perspectiveLabel(full, node(full, "C.md"), "A.md")).toBe("C");
	});

	it("keeps the focus note's own label", () => {
		expect(perspectiveLabel(full, node(full, "A.md"), "A.md")).toBe("A");
	});

	it("switches with the perspective", () => {
		expect(perspectiveLabel(full, node(full, "C.md"), "B.md")).toBe("Sea");
		expect(perspectiveLabel(full, node(full, "B.md"), "B.md")).toBe("B");
	});

	it("uses basenames when there is no focus (full-vault views)", () => {
		expect(perspectiveLabel(full, node(full, "B.md"), undefined)).toBe("B");
	});

	it("carries through every derived graph", () => {
		const derived: RelationsGraph[] = [
			localSubgraph(full, "A.md", 1),
			connectedComponent(full, "A.md"),
			filterFamilyNeighborhood(full, "A.md"),
			filterGraphByTypes(full, new Set(["parent"]), "A.md"),
			buildLocalGraph(makeFakeApp(VAULT), settingsWith(VAULT_TYPES), "A.md", 1),
		];
		for (const g of derived) {
			expect(g.displayNames?.get("A.md")?.get("B.md")).toBe("Bee");
		}
		const local = localSubgraph(full, "A.md", 1);
		expect(perspectiveLabel(local, node(local, "B.md"), "A.md")).toBe("Bee");
	});
});
