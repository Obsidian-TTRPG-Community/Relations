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

function allyType(): RelationshipType {
	return { name: "ally", color: "#22c55e", symmetric: true, pair: false, treeLayout: false, lineStyle: "solid", genealogy: false };
}
function parentType(): RelationshipType {
	return { name: "parent", color: "#b45309", symmetric: false, pair: false, treeLayout: true, lineStyle: "solid", genealogy: true };
}

const DEAD_HIDE = { property: "char_status", value: "Dead", hide: true, mute: false, muteColor: "#2c2c2c" };

function settingsWith(overrides: Partial<RelationsSettings> = {}): RelationsSettings {
	return {
		...DEFAULT_SETTINGS,
		relationshipTypes: [allyType(), parentType()],
		statusProperties: ["char_status"],
		statusRules: [DEAD_HIDE],
		...overrides,
	} as RelationsSettings;
}

function ids(graph: { nodes: { id: string }[] }): string[] {
	return graph.nodes.map((n) => n.id).sort();
}

// Center --ally--> Gone (Dead) --ally--> Stranded --ally--> Friend
// Stranded is reachable ONLY through the dead note, and has its own edge to Friend.
const VAULT: FakeNote[] = [
	{ path: "Center.md", frontmatter: { ally: ["[[Gone]]", "[[Alive]]"] } },
	{ path: "Gone.md", frontmatter: { char_status: "Dead", ally: ["[[Stranded]]"] } },
	{ path: "Stranded.md", frontmatter: { ally: ["[[Friend]]"] } },
	{ path: "Friend.md", frontmatter: {} },
	{ path: "Alive.md", frontmatter: {} },
];

describe("Node status Hide runs before the walk (#28 limitation)", () => {
	it("buildLocalGraph: a note reachable only through a hidden node is dropped, not stranded", () => {
		const graph = buildLocalGraph(makeFakeApp(VAULT), settingsWith(), "Center.md", 3, null);
		expect(ids(graph)).toEqual(["Alive.md", "Center.md"]);
	});

	it("buildConnectedGraph: same, over the whole component", () => {
		const graph = buildConnectedGraph(makeFakeApp(VAULT), settingsWith(), "Center.md", null);
		expect(ids(graph)).toEqual(["Alive.md", "Center.md"]);
	});

	it("buildConnectedGraph with skipHide keeps the hidden note and what hangs off it", () => {
		const graph = buildConnectedGraph(makeFakeApp(VAULT), settingsWith(), "Center.md", null, undefined, true);
		expect(ids(graph)).toEqual(["Alive.md", "Center.md", "Friend.md", "Gone.md", "Stranded.md"]);
	});

	it("buildFamilyNeighborhood never hides: a dead ancestor stays in the tree", () => {
		const app = makeFakeApp([
			{ path: "Kid.md", frontmatter: { parent: ["[[Elder]]"] } },
			{ path: "Elder.md", frontmatter: { char_status: "Dead" } },
		]);
		const graph = buildFamilyNeighborhood(app, settingsWith(), "Kid.md", undefined, null);
		expect(ids(graph)).toEqual(["Elder.md", "Kid.md"]);
	});

	it("the center note is kept even when it matches a Hide rule", () => {
		const graph = buildLocalGraph(makeFakeApp(VAULT), settingsWith(), "Gone.md", 2, null);
		expect(ids(graph)).toContain("Gone.md");
	});
});
