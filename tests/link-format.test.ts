import { describe, it, expect } from "vitest";
import { parseLink, normalizeNoteName, extractParsedLinks } from "../src/graph";
import type { ParsedLink } from "../src/types";

describe("normalizeNoteName", () => {
	it("converts to lowercase", () => {
		expect(normalizeNoteName("Alice")).toBe("alice");
		expect(normalizeNoteName("ALICE")).toBe("alice");
		expect(normalizeNoteName("AlIcE")).toBe("alice");
	});

	it("trims whitespace", () => {
		expect(normalizeNoteName("  Alice  ")).toBe("alice");
	});

	it("handles empty strings", () => {
		expect(normalizeNoteName("")).toBe("");
		expect(normalizeNoteName("   ")).toBe("");
	});

	it("preserves special characters", () => {
		expect(normalizeNoteName("O'Brien")).toBe("o'brien");
		expect(normalizeNoteName("Mary-Jane")).toBe("mary-jane");
	});
});

describe("parseLink", () => {
	describe("plain text format", () => {
		it("parses simple plain text", () => {
			const link = parseLink("Alice");
			expect(link).not.toBeNull();
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Alice");
			expect(link?.source).toBe("plain-text");
		});

		it("case-insensitive but preserves display name", () => {
			const link = parseLink("ALICE");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("ALICE");
		});

		it("trims whitespace from plain text", () => {
			const link = parseLink("  Alice  ");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Alice");
		});

		it("handles empty/whitespace strings", () => {
			expect(parseLink("")).toBeNull();
			expect(parseLink("   ")).toBeNull();
		});

		it("handles non-string types", () => {
			expect(parseLink(null)).toBeNull();
			expect(parseLink(undefined)).toBeNull();
			expect(parseLink(42)).toBeNull();
			expect(parseLink(true)).toBeNull();
			expect(parseLink({})).toBeNull();
		});
	});

	describe("wikilink format [[Note]]", () => {
		it("parses basic wikilink", () => {
			const link = parseLink("[[Alice]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Alice");
			expect(link?.source).toBe("wikilink");
		});

		it("removes heading anchors from wikilinks", () => {
			const link = parseLink("[[Alice#Background]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Alice");
		});

		it("preserves case in display name", () => {
			const link = parseLink("[[ALICE]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("ALICE");
		});

		it("trims internal whitespace", () => {
			const link = parseLink("[[  Alice  ]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Alice");
		});

		it("returns null for empty wikilinks", () => {
			expect(parseLink("[[]]")).toBeNull();
			expect(parseLink("[[   ]]")).toBeNull();
		});
	});

	describe("aliased wikilink format [[Target|Display]]", () => {
		it("parses aliased wikilink", () => {
			const link = parseLink("[[Alice|Bobby]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Bobby");
			expect(link?.source).toBe("wikilink-alias");
		});

		it("case-insensitive target, preserves display name case", () => {
			const link = parseLink("[[ALICE|Bobby]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Bobby");
		});

		it("preserves display name exactly", () => {
			const link = parseLink("[[Alice|King Arthur]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("King Arthur");
		});

		it("trims whitespace in alias", () => {
			const link = parseLink("[[Alice  |  Bobby]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Bobby");
		});

		it("ignores heading anchor after pipe", () => {
			const link = parseLink("[[Alice|Bobby#Section]]");
			expect(link?.target).toBe("alice");
			expect(link?.displayName).toBe("Bobby");
		});

		it("returns null if either part is empty", () => {
			expect(parseLink("[[|Display]]")).toBeNull();
			expect(parseLink("[[Target|]]")).toBeNull();
			expect(parseLink("[[|]]")).toBeNull();
		});
	});

	describe("edge cases", () => {
		it("handles special characters in names", () => {
			const link = parseLink("O'Brien");
			expect(link?.target).toBe("o'brien");
			expect(link?.displayName).toBe("O'Brien");
		});

		it("handles hyphens and spaces", () => {
			const link = parseLink("Mary-Jane Watson");
			expect(link?.target).toBe("mary-jane watson");
			expect(link?.displayName).toBe("Mary-Jane Watson");
		});

		it("handles unicode characters", () => {
			const link = parseLink("Åsa");
			expect(link?.target).toBe("åsa");
			expect(link?.displayName).toBe("Åsa");
		});

		it("handles parentheses", () => {
			const link = parseLink("Alice (the Elder)");
			expect(link?.target).toBe("alice (the elder)");
			expect(link?.displayName).toBe("Alice (the Elder)");
		});
	});
});

describe("extractParsedLinks", () => {
	it("returns empty array for null/undefined", () => {
		expect(extractParsedLinks(null)).toEqual([]);
		expect(extractParsedLinks(undefined)).toEqual([]);
	});

	it("returns empty array for non-string non-array types", () => {
		expect(extractParsedLinks(42)).toEqual([]);
		expect(extractParsedLinks(true)).toEqual([]);
		expect(extractParsedLinks({})).toEqual([]);
	});

	it("returns empty array for empty/whitespace strings", () => {
		expect(extractParsedLinks("")).toEqual([]);
		expect(extractParsedLinks("   ")).toEqual([]);
	});

	it("extracts single wikilink", () => {
		const links = extractParsedLinks("[[Alice]]");
		expect(links).toHaveLength(1);
		expect(links[0].target).toBe("alice");
		expect(links[0].displayName).toBe("Alice");
	});

	it("extracts multiple wikilinks", () => {
		const links = extractParsedLinks("[[Alice]] and [[Bob]] and [[Charlie]]");
		expect(links).toHaveLength(3);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob", "charlie"]);
	});

	it("handles wikilinks with aliases", () => {
		const links = extractParsedLinks("[[Alice|Queen]] and [[Bob|King]]");
		expect(links).toHaveLength(2);
		expect(links[0].displayName).toBe("Queen");
		expect(links[1].displayName).toBe("King");
	});

	it("extracts comma-separated plain text", () => {
		const links = extractParsedLinks("Alice, Bob, Charlie");
		expect(links).toHaveLength(3);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob", "charlie"]);
		expect(links.map((l: ParsedLink) => l.source)).toEqual(["plain-text", "plain-text", "plain-text"]);
	});

	it("extracts single plain text value", () => {
		const links = extractParsedLinks("Alice");
		expect(links).toHaveLength(1);
		expect(links[0].target).toBe("alice");
		expect(links[0].source).toBe("plain-text");
	});

	it("prioritizes wikilinks over comma-separated parsing", () => {
		// If wikilinks are found, ignore comma-separated logic
		const links = extractParsedLinks("[[Alice]], Bob");
		expect(links).toHaveLength(1);
		expect(links[0].target).toBe("alice");
		// Bob is not extracted because we found wikilinks
	});

	it("flattens array values recursively", () => {
		const links = extractParsedLinks(["[[Alice]]", "[[Bob]]"]);
		expect(links).toHaveLength(2);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob"]);
	});

	it("handles mixed array with nulls", () => {
		const links = extractParsedLinks(["[[Alice]]", null, "Bob"]);
		expect(links).toHaveLength(2);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob"]);
	});

	it("handles nested arrays", () => {
		const links = extractParsedLinks([["[[Alice]]"], "[[Bob]]"]);
		expect(links).toHaveLength(2);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob"]);
	});

	it("skips invalid entries in arrays", () => {
		const links = extractParsedLinks(["[[Alice]]", "", "[[Bob]]"]);
		expect(links).toHaveLength(2);
		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob"]);
	});

	it("handles mixed format in array", () => {
		const links = extractParsedLinks([
			"[[Alice|Queen]]",
			"Bob",
			"[[Charlie#Section]]",
		]);
		expect(links).toHaveLength(3);
		expect(links[0].displayName).toBe("Queen");
		expect(links[1].displayName).toBe("Bob");
		expect(links[2].target).toBe("charlie");
	});
});

describe("ParsedLink integration", () => {
	it("preserves display name through parsing chain", () => {
		const links = extractParsedLinks([
			"Alice",                    // plain text
			"[[Bob]]",                  // wikilink
			"[[Charlie|Crown]]",        // aliased
		]);

		expect(links[0].displayName).toBe("Alice");
		expect(links[1].displayName).toBe("Bob");
		expect(links[2].displayName).toBe("Crown");
	});

	it("always lowercases targets regardless of format", () => {
		const links = extractParsedLinks([
			"ALICE",
			"[[BOB]]",
			"[[CHARLIE|crown]]",
		]);

		expect(links.map((l: ParsedLink) => l.target)).toEqual(["alice", "bob", "charlie"]);
	});

	it("distinguishes between multiple people with similar names", () => {
		const links = extractParsedLinks([
			"Alice",
			"[[Alice|Alice the Elder]]",
			"alice",  // same as first, different format
		]);

		// All resolve to same target
		expect(links.map((l) => l.target)).toEqual(["alice", "alice", "alice"]);
		// But display names differ
		expect(links.map((l: ParsedLink) => l.displayName)).toEqual([
			"Alice",
			"Alice the Elder",
			"alice",
		]);
	});
});
