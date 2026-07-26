import { describe, it, expect, beforeEach } from "vitest";
import { buildFullGraph } from "../src/graph";
import { TFile } from "obsidian";
import type { App, Vault, MetadataCache } from "obsidian";
import type { RelationsSettings } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Mock App, Vault, MetadataCache for testing buildFullGraph alias accumulation.
 * These tests focus on whether aliases are correctly captured and stored in the aliasMap.
 */

interface MockFile {
	path: string;
	name: string;
	frontmatter: Record<string, unknown>;
}

// Real TFile instances (not plain objects) so buildNode's `f instanceof TFile`
// check in graph.ts actually matches and real nodes get built.
function toTFile(f: MockFile): TFile {
	const file = new TFile();
	file.path = f.path;
	file.basename = f.name;
	return file;
}

function createMockApp(files: MockFile[]): Partial<App> {
	const mockVault: Partial<Vault> = {
		getMarkdownFiles: () => files.map(toTFile),

		getAbstractFileByPath: (path: string) => {
			const file = files.find((f) => f.path === path);
			return file ? toTFile(file) : null;
		},
	};

	const mockMetadataCache: Partial<MetadataCache> = {
		getFileCache: (file: TFile) => {
			const mockFile = files.find((f) => f.path === file.path);
			return mockFile ? { frontmatter: mockFile.frontmatter } : null;
		},

		getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
			// Case-insensitive lookup to match real Obsidian behavior
			// Strip heading anchors like the real Obsidian API does
			const hashIdx = linkpath.indexOf("#");
			const cleanLinkpath = hashIdx >= 0 ? linkpath.slice(0, hashIdx) : linkpath;
			const lowerLinkpath = cleanLinkpath.toLowerCase();
			const target = files.find(
				(f) => f.path.toLowerCase() === lowerLinkpath || f.name.toLowerCase() === lowerLinkpath,
			);
			return target ? toTFile(target) : null;
		},
	};

	return {
		vault: mockVault as Vault,
		metadataCache: mockMetadataCache as MetadataCache,
	} as unknown as App;
}

describe("buildFullGraph alias accumulation", () => {
	let mockApp: Partial<App>;
	const settings: RelationsSettings = DEFAULT_SETTINGS;

	describe("basic alias accumulation", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob|Bobby]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("accumulates alias from single wikilink", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.aliasMap.has("Alice.md")).toBe(true);
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("Bobby");
		});

		it("stores alias under source note path, not target path", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// Alias is from Alice's perspective
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("Bobby");
			// Bob doesn't have any aliases to store
			expect(result.aliasMap.has("Bob.md")).toBe(false);
		});
	});

	describe("multiple aliases for same target", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob|Bobby]]",
					},
				},
				{
					path: "Charlie.md",
					name: "Charlie",
					frontmatter: {
						ally: "[[Bob|Robert]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("stores different aliases from different sources", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// Alice calls Bob "Bobby"
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("Bobby");
			// Charlie calls Bob "Robert"
			expect(result.aliasMap.get("Charlie.md")?.get("Bob.md")).toBe("Robert");
		});

		it("keeps each perspective's aliases separate", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			const aliceAliases = result.aliasMap.get("Alice.md");
			const charlieAliases = result.aliasMap.get("Charlie.md");
			expect(aliceAliases?.get("Bob.md")).not.toBe(charlieAliases?.get("Bob.md"));
		});
	});

	describe("aliased source alongside a plain, unaliased source for the same target", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob|Bobby]]",
					},
				},
				{
					path: "Charlie.md",
					name: "Charlie",
					frontmatter: {
						// Plain, unaliased reference to the same Bob
						ally: "[[Bob]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("does not let an unaliased reference from another note erase or shadow Alice's alias", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// Alice's perspective on Bob is untouched by Charlie's plain link
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("Bobby");
			// Charlie never aliased Bob, so Charlie has no alias entry at all
			expect(result.aliasMap.has("Charlie.md")).toBe(false);
		});
	});

	describe("non-aliased links", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("omits entries for non-aliased links", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// No alias for plain [[Bob]]
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBeUndefined();
		});

		it("doesn't create a map entry if no aliases", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// Alice has no aliased links
			expect(result.aliasMap.has("Alice.md")).toBe(false);
		});
	});

	describe("mixed aliased and non-aliased", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: ["[[Bob|Bobby]]", "[[Charlie]]", "[[David|Dave]]"],
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
				{
					path: "Charlie.md",
					name: "Charlie",
					frontmatter: {},
				},
				{
					path: "David.md",
					name: "David",
					frontmatter: {},
				},
			]);
		});

		it("accumulates only aliases, skipping plain links", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			const aliceAliases = result.aliasMap.get("Alice.md");
			expect(aliceAliases?.get("Bob.md")).toBe("Bobby");
			expect(aliceAliases?.get("Charlie.md")).toBeUndefined();
			expect(aliceAliases?.get("David.md")).toBe("Dave");
		});
	});

	describe("aliases with heading anchors", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob#Background|The King]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("preserves alias when link has heading anchor", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("The King");
		});
	});

	describe("comma-separated links", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "Bob, Charlie, David",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
				{
					path: "Charlie.md",
					name: "Charlie",
					frontmatter: {},
				},
				{
					path: "David.md",
					name: "David",
					frontmatter: {},
				},
			]);
		});

		it("does not capture aliases from plain-text links", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			// Plain text links don't support aliases
			expect(result.aliasMap.has("Alice.md")).toBe(false);
		});
	});

	describe("graph structure integrity with aliases", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						ally: "[[Bob|Bobby]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {
						ally: "[[Alice]]",
					},
				},
			]);
		});

		it("returns both graph and aliasMap", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result).toHaveProperty("graph");
			expect(result).toHaveProperty("aliasMap");
		});

		it("graph contains correct edges", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.graph.edges.length).toBeGreaterThan(0);
			expect(result.graph.nodes.length).toBeGreaterThan(0);
		});
	});

	describe("unresolved links", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						// Bob.md doesn't exist anywhere in the vault
						ally: "[[Bob|Bobby]]",
					},
				},
			]);
		});

		it("produces no edge, no node, and no alias entry for an unresolved link", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.graph.edges).toHaveLength(0);
			expect(result.graph.nodes).toHaveLength(0);
			expect(result.aliasMap.has("Alice.md")).toBe(false);
		});
	});

	describe("conflicting aliases from different properties", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {
						// "ally" < "mentor" alphabetically, so "ally"'s alias should win
						mentor: "[[Bob|Master Bob]]",
						ally: "[[Bob|Bobby]]",
					},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {},
				},
			]);
		});

		it("resolves to the alphabetically-first property's alias", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.aliasMap.get("Alice.md")?.get("Bob.md")).toBe("Bobby");
		});
	});

	describe("empty aliasMap cases", () => {
		beforeEach(() => {
			mockApp = createMockApp([
				{
					path: "Alice.md",
					name: "Alice",
					frontmatter: {},
				},
				{
					path: "Bob.md",
					name: "Bob",
					frontmatter: {
						ally: "[[Alice]]",
					},
				},
			]);
		});

		it("returns empty aliasMap when no aliases used", () => {
			const result = buildFullGraph(mockApp as App, settings, null);
			expect(result.aliasMap.size).toBe(0);
		});
	});
});
