/**
 * Pure helpers for reading and rewriting a relations code block's own text.
 * Used by the per-graph Filter panel (issue #41), which saves its state as a
 * `hide:` line inside the block so each graph keeps its own filter.
 *
 * No Obsidian imports, so everything here is unit-testable.
 */

/** Opening fence of a relations block, after any callout `> ` prefix. */
const FENCE_OPEN = /^(`{3,}|~{3,})\s*(relations|npc-graph)\b/;
/** Leading callout/blockquote prefix, e.g. "> " or "> > ". */
const QUOTE_PREFIX = /^(\s*(?:>\s?)*)/;

/** A top-level `hide:` key (not a `# hide:` comment, not indented). */
const HIDE_KEY = /^hide\s*:/;

/**
 * Return the block body with its `hide:` setting replaced by `hidden`.
 * - An existing `hide:` line (plus any indented `- item` lines under it) is
 *   replaced in place, so the user's line order is kept.
 * - With no existing line, `hide:` is appended at the end.
 * - An empty `hidden` removes the setting entirely.
 * Commented template lines like `# hide: …` are left untouched.
 */
export function setHideInBody(body: string, hidden: readonly string[]): string {
	const lines = body.length > 0 ? body.split("\n") : [];
	const out: string[] = [];
	let insertAt = -1;
	for (let i = 0; i < lines.length; i++) {
		if (HIDE_KEY.test(lines[i])) {
			if (insertAt < 0) insertAt = out.length;
			// Skip a YAML block list that belongs to this key.
			while (i + 1 < lines.length && /^\s+(-\s|-$)/.test(lines[i + 1])) i++;
			continue;
		}
		out.push(lines[i]);
	}
	if (hidden.length > 0) {
		const line = `hide: ${hidden.join(", ")}`;
		if (insertAt >= 0) {
			out.splice(insertAt, 0, line);
		} else {
			// Append before any trailing blank lines so the block stays tidy.
			let end = out.length;
			while (end > 0 && out[end - 1].trim() === "") end--;
			out.splice(end, 0, line);
		}
	}
	return out.join("\n");
}

/**
 * Replace the body of one relations block inside a file.
 *
 * `lineStart`/`lineEnd` come from Obsidian's getSectionInfo and may cover a
 * whole callout rather than just the block, so the block is located by
 * scanning that range for an opening fence whose body matches `oldBody` (the
 * source Obsidian handed the code-block processor). Callout `> ` prefixes are
 * preserved on every rewritten line.
 *
 * Returns the new file text, or null when the block can't be found
 * unambiguously (the note changed underneath us) — callers must then leave
 * the file alone.
 */
export function replaceBlockBody(
	fileText: string,
	lineStart: number,
	lineEnd: number,
	oldBody: string,
	newBody: string,
): string | null {
	const lines = fileText.split("\n");
	const from = Math.max(0, lineStart);
	const to = Math.min(lines.length - 1, lineEnd);
	const wanted = normalise(oldBody);

	for (let i = from; i <= to; i++) {
		const prefix = (lines[i].match(QUOTE_PREFIX) ?? ["", ""])[1];
		const fence = lines[i].slice(prefix.length).match(FENCE_OPEN);
		if (!fence) continue;
		const fenceChars = fence[1];

		// Strip the callout prefix from a line. A blank callout line is often
		// just ">" with no trailing space, so accept that as an empty line.
		const unprefix = (l: string): string | null =>
			l.startsWith(prefix) ? l.slice(prefix.length) : (l === prefix.trimEnd() ? "" : null);

		// Find the matching closing fence (same prefix, same or longer fence).
		let close = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const rest = unprefix(lines[j]);
			if (rest === null) break; // left the callout without closing
			if (rest.trim().startsWith(fenceChars[0].repeat(fenceChars.length)) && rest.trim().replace(/[`~]/g, "") === "") {
				close = j;
				break;
			}
		}
		if (close < 0) continue;

		const body = lines.slice(i + 1, close).map((l) => unprefix(l) ?? l).join("\n");
		if (normalise(body) !== wanted) continue;

		const bodyLines = newBody.length > 0 ? newBody.split("\n").map((l) => prefix + l) : [];
		lines.splice(i + 1, close - i - 1, ...bodyLines);
		return lines.join("\n");
	}
	return null;
}

function normalise(s: string): string {
	return s.split("\n").map((l) => l.trimEnd()).join("\n").trim();
}
