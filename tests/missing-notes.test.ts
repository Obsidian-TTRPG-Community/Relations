import { describe, it, expect } from "vitest";
import { App, TFile } from "obsidian";
import { buildFullGraph, buildLocalGraph, extractLinks, missingNodeId, perspectiveLabel } from "../src/graph";
import type { RelationsGraph, RelationsSettings, RelationshipType } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Issue #18: a relationship [[link]] to a note that doesn't exist yet shows up
 * as a faded "missing" node instead of vanishing, like Obsidian's own graph.
 * Design credit: lilmissy4205 (PRs #19/#25).
 */

interface FakeNote {
	path: string;
	frontmatter: Record<string, unknown>;
	tags?: string[];
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
	const byNote = new Map(notes.map((n) => [n.path, n]));

	return {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getResourcePath: (f: TFile) => `app://${f.path}`,
		},
		metadataCache: {
			getFileCache: (f: TFile) => {
				const n = byNote.get(f.path)!;
				return { frontmatter: n.frontmatter, tags: (n.tags ?? []).map((tag) => ({ tag: `#${tag}` })) };
			},
			getFirstLinkpathDest: (link: string, _from: string) =>
				byBasename.get(link.split("/").pop()!.toLowerCase()) ?? null,
		},
	} as unknown as App;
}

function type(name: string, overrides: Partial<RelationshipType> = {}): RelationshipType {
	return {
		name, color: "#888", symmetric: false, pair: false, treeLayout: false,
		lineStyle: "solid", genealogy: false, ...overrides,
	};
}

function settings(extra: Partial<RelationsSettings> = {}, types = [type("ally")]): RelationsSettings {
	return { ...DEFAULT_SETTINGS, relationshipTypes: types, ...extra };
}

const missing = (g: RelationsGraph) => g.nodes.filter((n) => n.missing);

describe("missing notes", () => {
	it("draws a [[link]] to a note that doesn't exist as a missing node", () => {
		const app = makeFakeApp([{ path: "Varinka.md", frontmatter: { ally: "[[Alice]]" } }]);
		const g = buildFullGraph(app, settings());

		expect(missing(g)).toEqual([{
			id: "missing:alice", label: "Alice", tags: [], image: null,
			missing: true, linkText: "Alice", linkSource: "Varinka.md",
		}]);
		expect(g.edges).toHaveLength(1);
		expect(g.edges[0]).toMatchObject({ source: "Varinka.md", target: "missing:alice" });
		// The note that linked to it is in the graph too, even with no other links.
		expect(g.nodes.map((n) => n.id).sort()).toEqual(["Varinka.md", "missing:alice"]);
	});

	it("ignores plain-text values, which aren't links in Obsidian either", () => {
		const app = makeFakeApp([{ path: "A.md", frontmatter: { ally: ["TBD", "Nobody, Someone"] } }]);
		expect(buildFullGraph(app, settings()).nodes).toEqual([]);
	});

	it("treats [[bob]] and [[Bob]] as the same missing note, keeping the first spelling", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { ally: "[[Bob]]" } },
			{ path: "B.md", frontmatter: { ally: "[[bob]]" } },
		]);
		const m = missing(buildFullGraph(app, settings()));
		expect(m).toHaveLength(1);
		expect(m[0].label).toBe("Bob");
	});

	it("labels a folder link with the note's own name and keeps the full link for creating it", () => {
		const app = makeFakeApp([{ path: "A.md", frontmatter: { ally: "[[People/Elves/Serion#Youth|Ser]]" } }]);
		const [m] = missing(buildFullGraph(app, settings()));
		expect(m.label).toBe("Serion");
		expect(m.linkText).toBe("People/Elves/Serion");
	});

	it("can never clash with a real note's id", () => {
		expect(missingNodeId("Bob")).not.toBe("Bob.md");
		expect(missingNodeId("Bob.md")).not.toBe("Bob.md");
	});

	it("becomes a normal node once the note exists", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { ally: "[[Bob]]" } },
			{ path: "Bob.md", frontmatter: {} },
		]);
		const g = buildFullGraph(app, settings());
		expect(missing(g)).toEqual([]);
		expect(g.edges[0].target).toBe("Bob.md");
	});

	it("is hidden when the setting is off", () => {
		const app = makeFakeApp([{ path: "A.md", frontmatter: { ally: "[[Alice]]" } }]);
		expect(buildFullGraph(app, settings({ showMissingNotes: false })).nodes).toEqual([]);
	});

	it("is hidden when required tags are set, since it has no tags", () => {
		const app = makeFakeApp([
			{ path: "A.md", frontmatter: { ally: ["[[Alice]]", "[[B]]"] }, tags: ["npc"] },
			{ path: "B.md", frontmatter: {}, tags: ["npc"] },
		]);
		const g = buildFullGraph(app, settings({ requiredTags: ["npc"] }));
		expect(missing(g)).toEqual([]);
		expect(g.nodes.map((n) => n.id).sort()).toEqual(["A.md", "B.md"]);
	});

	it("uses the focus note's nickname for it", () => {
		const app = makeFakeApp([{ path: "A.md", frontmatter: { ally: "[[Alice|The Enlightened One]]" } }]);
		const g = buildLocalGraph(app, settings(), "A.md", 1);
		const [m] = missing(g);
		expect(perspectiveLabel(g, m, "A.md")).toBe("The Enlightened One");
		expect(perspectiveLabel(g, m, undefined)).toBe("Alice");
	});

	it("follows declares-child direction, so a missing child sits below its parent", () => {
		const app = makeFakeApp([{ path: "Mother.md", frontmatter: { children: "[[Twice]]" } }]);
		const g = buildFullGraph(app, settings({}, [type("children", { genealogy: true, declaresChild: true })]));
		expect(g.edges[0]).toMatchObject({ source: "missing:twice", target: "Mother.md" });
	});
});

describe("extractLinks marks wikilinks", () => {
	it("flags [[links]] but not plain text", () => {
		expect(extractLinks(["[[A]]", "B"])).toEqual([{ target: "A", wikilink: true }, { target: "B" }]);
	});
});
