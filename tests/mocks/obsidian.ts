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
