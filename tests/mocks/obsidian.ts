export class App {}
export class TFile {
	path = "";
	basename = "";
}
export class Menu {
	addItem() { return this; }
	showAtMouseEvent() {}
}
export class CachedMetadata {}
export function getAllTags(): string[] { return []; }
export function normalizePath(p: string): string { return p; }

// Stubs so modules importing these (e.g. codeblock.ts) link in the test runtime.
export class MarkdownRenderChild { constructor(_el?: unknown) {} onunload(): void {} }
export class Notice { constructor(_message?: unknown) {} }
export class MarkdownPostProcessorContext {}
export function setIcon(): void {}

function parseYamlScalar(raw: string): unknown {
	const s = raw.trim();
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	if (s === "true") return true;
	if (s === "false") return false;
	if (s !== "" && !isNaN(Number(s))) return Number(s);
	return s;
}

/**
 * Minimal real YAML parser for tests — real Obsidian's parseYaml is unavailable
 * outside the app, and code-block options never use anything beyond flat
 * `key: value` pairs, optionally a bracketed array. Good enough for a genuine
 * parseOptions() round-trip test, unlike a stub that always returns {}.
 */
export function parseYaml(source: string): unknown {
	const result: Record<string, unknown> = {};
	for (const rawLine of source.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (value.startsWith("[") && value.endsWith("]")) {
			const inner = value.slice(1, -1).trim();
			result[key] = inner === "" ? [] : inner.split(",").map((v) => parseYamlScalar(v));
		} else {
			result[key] = parseYamlScalar(value);
		}
	}
	return result;
}
