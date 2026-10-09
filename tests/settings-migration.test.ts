import { describe, it, expect } from "vitest";
import { migrateRelationshipType } from "../src/types";
import type { RelationshipType } from "../src/types";

// Issue #24: the "Child" checkbox (declaresChild) was reset on every reload
// because the load-time migration rebuilt types from a fixed field list.
// Thanks to lilmissy4205 for tracking it down (PR #26).

const base: RelationshipType = {
	name: "children", color: "#b45309", symmetric: false, pair: false,
	treeLayout: true, lineStyle: "solid", genealogy: true, group: "Family",
};

describe("migrateRelationshipType", () => {
	it("keeps the Child checkbox through a reload", () => {
		expect(migrateRelationshipType({ ...base, declaresChild: true }).declaresChild).toBe(true);
	});

	it("defaults the Child checkbox to off for older settings", () => {
		expect(migrateRelationshipType(base).declaresChild).toBe(false);
	});

	it("keeps every field it's given", () => {
		const full: RelationshipType = { ...base, declaresChild: true };
		expect(migrateRelationshipType(full)).toEqual(full);
	});
});
