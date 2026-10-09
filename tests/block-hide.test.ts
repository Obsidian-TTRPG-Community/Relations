import { describe, it, expect } from "vitest";
import { replaceBlockBody, setHideInBody } from "../src/block-source";
import { parseOptions, resolveHide } from "../src/codeblock";

/**
 * Issue #41: each embedded graph has its own filter, saved as a `hide:` line
 * inside its own code block.
 */

describe("setHideInBody", () => {
	it("appends a hide: line to a block without one", () => {
		expect(setHideInBody("size: small", ["parent", "spouse"])).toBe("size: small\nhide: parent, spouse");
	});

	it("adds to an empty block", () => {
		expect(setHideInBody("", ["parent"])).toBe("hide: parent");
	});

	it("replaces an existing hide: line where it is", () => {
		expect(setHideInBody("hide: ally\nsize: small", ["enemy"])).toBe("hide: enemy\nsize: small");
	});

	it("replaces a YAML list form too", () => {
		expect(setHideInBody("size: small\nhide:\n  - ally\n  - enemy\ndepth: 2", ["rival"]))
			.toBe("size: small\nhide: rival\ndepth: 2");
	});

	it("removes the line when nothing is hidden", () => {
		expect(setHideInBody("size: small\nhide: ally", [])).toBe("size: small");
	});

	it("leaves commented template lines alone", () => {
		expect(setHideInBody("# hide: parent, spouse  # comment\nsize: small", ["ally"]))
			.toBe("# hide: parent, spouse  # comment\nsize: small\nhide: ally");
	});

	it("keeps trailing blank lines after the new setting", () => {
		expect(setHideInBody("size: small\n", ["ally"])).toBe("size: small\nhide: ally\n");
	});
});

describe("replaceBlockBody", () => {
	const note = [
		"# Varinka",
		"",
		"```relations",
		"groups: Family",
		"```",
		"",
		"```relations",
		"size: small",
		"```",
	].join("\n");

	it("rewrites only the block whose text matches", () => {
		// getSectionInfo for the second block: lines 6–8.
		const out = replaceBlockBody(note, 6, 8, "size: small", "size: small\nhide: parent");
		expect(out).toBe(note.replace("```relations\nsize: small\n```", "```relations\nsize: small\nhide: parent\n```"));
		expect(out).toContain("```relations\ngroups: Family\n```");
	});

	it("scans a wider range (like a whole section) for the right block", () => {
		const out = replaceBlockBody(note, 0, 8, "size: small", "size: large");
		expect(out).toContain("```relations\ngroups: Family\n```");
		expect(out).toContain("```relations\nsize: large\n```");
	});

	it("keeps callout prefixes, including bare '>' blank lines", () => {
		const callout = [
			"> [!info] Merlin",
			"> Court magician.",
			">",
			"> ```relations",
			"> size: small",
			">",
			"> ```",
			"",
			"After.",
		].join("\n");
		const out = replaceBlockBody(callout, 0, 6, "size: small\n", "size: small\nhide: lover");
		expect(out).toBe([
			"> [!info] Merlin",
			"> Court magician.",
			">",
			"> ```relations",
			"> size: small",
			"> hide: lover",
			"> ```",
			"",
			"After.",
		].join("\n"));
	});

	it("handles the legacy npc-graph language and tilde fences", () => {
		const legacy = "~~~npc-graph\ndepth: 1\n~~~";
		expect(replaceBlockBody(legacy, 0, 2, "depth: 1", "depth: 1\nhide: ally")).toBe("~~~npc-graph\ndepth: 1\nhide: ally\n~~~");
	});

	it("refuses to write when the block changed underneath us", () => {
		expect(replaceBlockBody(note, 6, 8, "size: large", "anything")).toBeNull();
	});

	it("ignores other code blocks", () => {
		const js = "```js\nsize: small\n```";
		expect(replaceBlockBody(js, 0, 2, "size: small", "x")).toBeNull();
	});
});

describe("hide: option", () => {
	it("accepts a comma list or a YAML list", () => {
		expect(resolveHide({ hide: "parent, spouse" })).toEqual(["parent", "spouse"]);
		expect(resolveHide({ hide: ["parent", "spouse"] })).toEqual(["parent", "spouse"]);
		expect(resolveHide({ hide: "" })).toBeUndefined();
	});

	it("is parsed from a code block", () => {
		expect(parseOptions("size: small\nhide: parent, spouse").hide).toEqual(["parent", "spouse"]);
		expect(parseOptions("size: small").hide).toBeUndefined();
	});
});
