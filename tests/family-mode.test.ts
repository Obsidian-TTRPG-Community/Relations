import { describe, it, expect } from "vitest";
import { resolveFamilyMode } from "../src/codeblock";

describe("resolveFamilyMode", () => {
	it("maps family-tree to the true-tree (orthogonal) view", () => {
		expect(resolveFamilyMode({ "family-tree": true })).toBe("tree");
		expect(resolveFamilyMode({ familyTree: true })).toBe("tree");
	});

	it("maps family-graph to the graph-style view", () => {
		expect(resolveFamilyMode({ "family-graph": true })).toBe("graph");
		expect(resolveFamilyMode({ familyGraph: true })).toBe("graph");
	});

	it("returns undefined when no family key is set", () => {
		expect(resolveFamilyMode({})).toBeUndefined();
		expect(resolveFamilyMode({ tree: true })).toBeUndefined(); // generic dagre, not a family view
	});

	it("prefers tree when both keys are set", () => {
		expect(resolveFamilyMode({ "family-tree": true, "family-graph": true })).toBe("tree");
	});

	it("ignores non-true values (only an explicit boolean true enables a mode)", () => {
		expect(resolveFamilyMode({ "family-tree": "yes" })).toBeUndefined();
		expect(resolveFamilyMode({ "family-graph": 1 })).toBeUndefined();
	});
});
