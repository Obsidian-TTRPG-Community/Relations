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
// None are exercised by the pure functions under test.
export class MarkdownRenderChild { constructor(_el?: unknown) {} onunload(): void {} }
export class Notice { constructor(_message?: unknown) {} }
export class MarkdownPostProcessorContext {}
export function parseYaml(_s: string): unknown { return {}; }
export function setIcon(): void {}
