// The card text processor: what the inline editor's multi-line field is allowed
// to leave behind. Spec: docs/specs/card-content-and-checklists.md §3.2.
// Pure; no `obsidian` imports.
//
// A card is **one Markdown list item**, so its text may hold a paragraph with
// inline markup and nothing else. The field is a real editor, so a user can type
// anything into it; this module decides what survives:
//
//   - **task lines are lifted out** into the card's checklist, at any indent
//     (the list need not be indented to be recognized);
//   - every other block construct — plain and ordered lists, blockquotes and
//     callouts, headings, rules, code fences, block math, tables, raw HTML,
//     images and embeds — is **removed**;
//   - the remaining paragraph lines fold into the single line a card is.
//
// Removal is deliberate and lossy: a card that carried a block element would not
// round-trip through `- ` at all. The caller reports what was dropped.

import { ChecklistItem, ChecklistRow, buildChecklist, indentWidth } from './checklist';

/**
 * A task list item at any indent, with any bullet. The single character between
 * the brackets is what keeps `[[wikilinks]]` and `[a](links)` out, exactly as
 * for the card's own marker (markdown-format.md §4.0).
 */
const TASK_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[(.)\][ \t]*(.*)$/;

/** Ordered and unordered list items that are *not* tasks. */
const LIST_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
/** Blockquotes, which is also how Obsidian callouts start. */
const QUOTE_RE = /^[ \t]*>/;
/** ATX headings. The trailing space requirement keeps `#tag` out. */
const HEADING_RE = /^ {0,3}#{1,6}([ \t]|$)/;
/** Thematic breaks: three or more of the same marker and nothing else. */
const RULE_RE = /^[ \t]*(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const CODE_FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const MATH_FENCE_RE = /^[ \t]*\$\$/;
const TABLE_RE = /^[ \t]*\|/;
const HTML_RE = /^[ \t]*<\/?[A-Za-z!]/;
/** Images and embeds, wherever they sit — a card tile cannot hold one. */
const EMBED_RE = /!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^()]*\)/g;

export type DroppedKind =
	| 'list'
	| 'quote'
	| 'heading'
	| 'rule'
	| 'code'
	| 'math'
	| 'table'
	| 'html'
	| 'image';

export interface ProcessedCardText {
	/** Inline content for the card's `- ` line: always a single line. */
	text: string;
	/** Task lines lifted out of the text, in document order. */
	checklist: ChecklistItem[];
	/** Kinds of block construct removed, in first-seen order. Never throws. */
	dropped: DroppedKind[];
}

function stripEmbeds(line: string): string {
	return line.replace(EMBED_RE, '');
}

/** Split editor text into a card's one-line content plus a lifted checklist. */
export function processCardText(input: string): ProcessedCardText {
	const dropped: DroppedKind[] = [];
	const drop = (kind: DroppedKind): void => {
		if (!dropped.includes(kind)) dropped.push(kind);
	};

	const rows: ChecklistRow[] = [];
	const kept: string[] = [];
	/** Backtick or tilde of the open code fence; `null` outside one. */
	let fence: string | null = null;
	let inMath = false;

	for (const line of input.split('\n')) {
		if (fence !== null) {
			if (new RegExp(`^[ \t]*${fence}{3,}[ \t]*$`).test(line)) fence = null;
			continue;
		}
		if (inMath) {
			if (line.includes('$$')) inMath = false;
			continue;
		}

		const code = CODE_FENCE_RE.exec(line);
		if (code) {
			drop('code');
			fence = code[1]![0] === '`' ? '`' : '~';
			continue;
		}
		if (MATH_FENCE_RE.test(line)) {
			drop('math');
			// `$$x$$` opens and closes on one line; a lone `$$` opens a block.
			inMath = (line.match(/\$\$/g) ?? []).length < 2;
			continue;
		}

		// Tasks first: they are the one list that is kept, just not as text.
		const task = TASK_RE.exec(line);
		if (task) {
			rows.push({
				indent: indentWidth(task[1]!),
				marker: task[2]!,
				text: stripEmbeds(task[3] ?? '').trim(),
			});
			continue;
		}

		// A rule is checked before a list: `- - -` is both.
		if (RULE_RE.test(line)) {
			drop('rule');
			continue;
		}
		if (LIST_RE.test(line)) {
			drop('list');
			continue;
		}
		if (QUOTE_RE.test(line)) {
			drop('quote');
			continue;
		}
		if (HEADING_RE.test(line)) {
			drop('heading');
			continue;
		}
		if (TABLE_RE.test(line)) {
			drop('table');
			continue;
		}
		if (HTML_RE.test(line)) {
			drop('html');
			continue;
		}

		const text = stripEmbeds(line);
		if (text !== line) drop('image');
		// Collapsed here rather than downstream, so a removed image does not
		// leave a double space behind and the result is a fixed point.
		const clean = text.replace(/\s+/g, ' ').trim();
		if (clean) kept.push(clean);
	}

	return { text: kept.join(' '), checklist: buildChecklist(rows), dropped };
}

