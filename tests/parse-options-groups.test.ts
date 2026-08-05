import { describe, it, expect } from "vitest";
import { parseOptions, resolveGroups } from "../src/codeblock";

describe("parseOptions groups round-trip", () => {
	it("threads a comma-separated groups string through to the parsed options", () => {
		expect(parseOptions('groups: "Social, Bond"').groups).toEqual(["Social", "Bond"]);
	});

	it("threads an array-form groups option through to the parsed options", () => {
		expect(parseOptions('groups: ["Social", "Bond"]').groups).toEqual(["Social", "Bond"]);
	});

	it("is undefined when groups is omitted", () => {
		expect(parseOptions("size: small").groups).toBeUndefined();
	});

	it("is undefined when groups is an empty string or array", () => {
		expect(parseOptions('groups: ""').groups).toBeUndefined();
		expect(parseOptions("groups: []").groups).toBeUndefined();
	});

	it("doesn't affect other options parsed alongside groups", () => {
		const opts = parseOptions('size: large\ndepth: 2\ngroups: "Social"');
		expect(opts.size).toBe("large");
		expect(opts.depth).toBe(2);
		expect(opts.groups).toEqual(["Social"]);
	});
});

describe("resolveGroups", () => {
	it("parses a comma-separated string into a trimmed array", () => {
		expect(resolveGroups({ groups: "Social, Bond" })).toEqual(["Social", "Bond"]);
	});

	it("parses an array form as-is (trimmed, stringified)", () => {
		expect(resolveGroups({ groups: ["Social", " Bond "] })).toEqual(["Social", "Bond"]);
	});

	it("is undefined when groups is omitted", () => {
		expect(resolveGroups({})).toBeUndefined();
	});

	it("is undefined when groups is an empty string or array", () => {
		expect(resolveGroups({ groups: "" })).toBeUndefined();
		expect(resolveGroups({ groups: [] })).toBeUndefined();
	});
});
