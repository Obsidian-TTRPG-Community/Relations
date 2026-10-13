import { describe, it, expect } from "vitest";
import { resolveOrgMode } from "../src/codeblock";

describe("resolveOrgMode", () => {
	it("maps org-tree to the top-down dagre view, carrying the hierarchy name", () => {
		expect(resolveOrgMode({ "org-tree": "Party Structure" })).toEqual({
			mode: "tree",
			name: "Party Structure",
		});
	});

	it("maps org-graph to the force-directed view, carrying the hierarchy name", () => {
		expect(resolveOrgMode({ "org-graph": "Guild Ranks" })).toEqual({
			mode: "graph",
			name: "Guild Ranks",
		});
	});

	it("returns undefined when neither key is set", () => {
		expect(resolveOrgMode({})).toBeUndefined();
		expect(resolveOrgMode({ tree: true })).toBeUndefined();
	});

	it("prefers tree when both keys are set", () => {
		expect(resolveOrgMode({ "org-tree": "A", "org-graph": "B" })).toEqual({
			mode: "tree",
			name: "A",
		});
	});

	it("trims whitespace from the hierarchy name", () => {
		expect(resolveOrgMode({ "org-graph": "  Party Structure  " })).toEqual({
			mode: "graph",
			name: "Party Structure",
		});
	});

	it("ignores non-string or blank values", () => {
		expect(resolveOrgMode({ "org-tree": true })).toBeUndefined();
		expect(resolveOrgMode({ "org-graph": 42 })).toBeUndefined();
		expect(resolveOrgMode({ "org-tree": "" })).toBeUndefined();
		expect(resolveOrgMode({ "org-tree": "   " })).toBeUndefined();
	});
});
