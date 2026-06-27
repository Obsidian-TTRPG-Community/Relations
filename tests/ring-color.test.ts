import { describe, it, expect } from "vitest";
import { resolveRingColor } from "../src/graph";
import type { RelationsSettings, RingColorRule } from "../src/types";

/**
 * Tests for the ring-color resolver — a pure helper that maps a note's
 * frontmatter through the ringColorProperty + ringColorRules settings to
 * either a color string or undefined ("no ring color, use default").
 *
 * The test bar is the contract resolveRingColor advertises:
 *   - Feature off (no property name configured) → undefined
 *   - Feature off (empty rules) → undefined
 *   - Note has no frontmatter for the configured property → undefined
 *   - Value matches a rule → that rule's color
 *   - Value matches no rule → undefined (NOT some fallback)
 *   - Array-valued properties use the first element
 *   - Whitespace around the matched value is trimmed
 *   - Comparison is case-sensitive
 */

function makeSettings(
	property: string,
	rules: RingColorRule[],
): RelationsSettings {
	// Minimal RelationsSettings — only the ring-color fields matter to the
	// resolver, but we still need a shape TypeScript accepts.
	return {
		relationshipTypes: [],
		imageProperty: "npcimage",
		folderScopes: [],
		requiredTags: [],
		showLegend: true,
		layout: "fcose",
		disabledTypes: [],
		showNodeLabels: true,
		localGraphDepth: 2,
		animateLayout: true,
		ringColorProperty: property,
		ringColorRules: rules,
		topLeftIconProperty: "",
		topRightIconProperty: "",
		bottomLeftIconProperty: "",
		bottomRightIconProperty: "",
		subtextProperty: "",
	};
}

describe("resolveRingColor", () => {
	it("returns undefined when the property name is empty", () => {
		const s = makeSettings("", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBeUndefined();
	});

	it("returns undefined when there are no rules", () => {
		const s = makeSettings("feelings", []);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBeUndefined();
	});

	it("returns undefined when frontmatter is missing entirely", () => {
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, undefined)).toBeUndefined();
	});

	it("returns undefined when the property isn't set in this note", () => {
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { someOtherProp: "enemy" })).toBeUndefined();
	});

	it("returns the matched rule's color for an exact match", () => {
		const s = makeSettings("feelings", [
			{ value: "enemy", color: "#ef4444" },
			{ value: "friendly", color: "#22c55e" },
		]);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBe("#ef4444");
		expect(resolveRingColor(s, { feelings: "friendly" })).toBe("#22c55e");
	});

	it("returns undefined when the value doesn't match any rule", () => {
		const s = makeSettings("feelings", [
			{ value: "enemy", color: "#ef4444" },
		]);
		expect(resolveRingColor(s, { feelings: "neutral" })).toBeUndefined();
	});

	it("uses the first element of array-valued properties", () => {
		// Some users put tag-like values as arrays. We pick the first one — the
		// user-visible alternative (joining or matching any element) needs a
		// settings shape that doesn't exist yet.
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: ["enemy", "former-ally"] })).toBe("#ef4444");
	});

	it("trims whitespace around the property value before matching", () => {
		// Some YAML editors leave trailing spaces; we shouldn't punish users
		// for that.
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: "  enemy  " })).toBe("#ef4444");
	});

	it("matches case-sensitively (Enemy ≠ enemy)", () => {
		// Documented behaviour — see resolveRingColor's doc comment for rationale.
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: "Enemy" })).toBeUndefined();
	});

	it("returns undefined when the rule has an empty color string", () => {
		// Defensive: a rule with no color is treated as no rule.
		const s = makeSettings("feelings", [{ value: "enemy", color: "" }]);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBeUndefined();
	});

	it("returns the first matching rule when multiple rules share a value", () => {
		// User error case — duplicate value entries. We resolve to the first,
		// matching how most rule systems work (top-to-bottom precedence).
		const s = makeSettings("feelings", [
			{ value: "enemy", color: "#ef4444" },
			{ value: "enemy", color: "#000000" },
		]);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBe("#ef4444");
	});

	it("coerces numeric and boolean property values to strings before matching", () => {
		// Frontmatter values can be typed. A user with `level: 5` might want
		// a rule for value "5". We coerce.
		const s = makeSettings("level", [{ value: "5", color: "#22c55e" }]);
		expect(resolveRingColor(s, { level: 5 })).toBe("#22c55e");
		const sb = makeSettings("hostile", [{ value: "true", color: "#ef4444" }]);
		expect(resolveRingColor(sb, { hostile: true })).toBe("#ef4444");
	});

	it("trims whitespace from rule values too (so '  enemy' matches 'enemy')", () => {
		// Settings UI may permit accidental trailing space — match anyway.
		const s = makeSettings("feelings", [{ value: " enemy ", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: "enemy" })).toBe("#ef4444");
	});

	it("returns undefined when frontmatter value is an empty string", () => {
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: "" })).toBeUndefined();
	});

	it("returns undefined when frontmatter value is null", () => {
		const s = makeSettings("feelings", [{ value: "enemy", color: "#ef4444" }]);
		expect(resolveRingColor(s, { feelings: null })).toBeUndefined();
	});
});
