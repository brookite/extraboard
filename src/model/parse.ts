// Markdown -> Board. Spec: docs/specs/markdown-format.md. Pure; no `obsidian`.

import { splitChecklist } from './checklist';
import { parseFrontmatter } from './frontmatter';
import { parseValue } from './properties';
import {
	Board,
	BoardConfig,
	Card,
	Divider,
	PropertyDef,
	RawArchive,
	Stack,
} from './types';

const H2_RE = /^##(?: (.*))?$/;
const H3_RE = /^###(?: (.*))?$/;
const HR_RE = /^---\s*(%%collapsed%%)?\s*$/;
const CARD_RE = /^-(?: (.*))?$/;
const COLLAPSE_RE = /^(.*?)\s*%%collapsed%%\s*$/;
const ARCHIVE_RE = /^(.*?)\s*%%archive%%\s*$/;

/** The content of a `- ` list item, or `null` when the line is not one. */
export function cardLineText(line: string): string | null {
	const m = CARD_RE.exec(line);
	return m ? (m[1] ?? '') : null;
}

interface Token {
	name: string;
	/** Raw (still-escaped) value text between `|` and `}`. */
	value: string;
}

/** Extract `@{name|value}` tokens, returning the text with tokens removed. */
export function extractTokens(s: string): { tokens: Token[]; rest: string } {
	const tokens: Token[] = [];
	let out = '';
	let i = 0;
	while (i < s.length) {
		if (s[i] === '@' && s[i + 1] === '{') {
			let j = i + 2;
			let name = '';
			while (j < s.length) {
				const c = s[j]!;
				if (c === '|' || c === '}') break;
				name += c;
				j++;
			}
			let value = '';
			if (s[j] === '|') {
				j++;
				while (j < s.length) {
					const c = s[j]!;
					if (c === '\\' && j + 1 < s.length) {
						value += c + s[j + 1]!;
						j += 2;
						continue;
					}
					if (c === '}') break;
					value += c;
					j++;
				}
			}
			if (s[j] === '}') {
				tokens.push({ name: name.trim(), value });
				i = j + 1;
				continue;
			}
		}
		out += s[i]!;
		i++;
	}
	return { tokens, rest: out };
}

/**
 * A task marker is exactly one character between brackets at the very start of
 * the card content, followed by a space or the end of the line (§4.0). The
 * single-character rule keeps `[[wikilinks]]` and `[a](links)` out.
 */
const TASK_RE = /^\[(.)\](?: (.*))?$/;

/** Split a leading `[x] ` task marker off a card's content. */
export function extractTask(content: string): { task?: string; rest: string } {
	const m = TASK_RE.exec(content);
	if (!m) return { rest: content };
	return { task: m[1]!, rest: m[2] ?? '' };
}

const TAG_RE = /(^|\s)#([A-Za-z0-9/_-]+)/g;

/** Extract `#tag` tokens, returning deduped tags and the text with tags removed. */
export function extractTags(s: string): { tags: string[]; rest: string } {
	const tags: string[] = [];
	const rest = s.replace(TAG_RE, (_m, pre: string, tag: string) => {
		if (!tags.includes(tag)) tags.push(tag);
		return pre;
	});
	return { tags, rest };
}

/**
 * Newlines collapse like any other whitespace. A card is one list item, and the
 * inline editor lets the user type Shift+Enter, so the model folds that back
 * into a single line (kanban-view.md §6.6) — otherwise a re-serialized card
 * would split into several cards. File parsing never sees a newline here.
 */
function collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function findDef(config: BoardConfig, name: string): PropertyDef | undefined {
	return config.properties.find((p) => p.name === name);
}

/**
 * Parse a card's inline content (text after `- `), including an optional
 * leading task marker. The inline editor shows the marker-free text, so a user
 * who types `[x] ` in front of it turns the card into a task list item.
 */
export function parseCardContent(content: string, config: BoardConfig): Card {
	const { task, rest } = extractTask(content);
	const { tokens, rest: afterTokens } = extractTokens(rest);
	const { tags, rest: afterTags } = extractTags(afterTokens);
	const title = collapseWhitespace(afterTags);
	const properties = tokens
		.map((t) => parseValue(t.name, t.value, findDef(config, t.name)))
		.filter((v): v is NonNullable<typeof v> => v !== null);
	return {
		title,
		properties,
		tags,
		...(task !== undefined && { task }),
		checklist: [],
		trailing: [],
	};
}

function stripCollapse(s: string): { text: string; collapsed: boolean } {
	const m = COLLAPSE_RE.exec(s);
	if (m) return { text: m[1] ?? '', collapsed: true };
	return { text: s, collapsed: false };
}

/** The heading text of an `%%archive%%` H2, or `null` for an ordinary stack. */
function stripArchive(h2Text: string): string | null {
	const m = ARCHIVE_RE.exec(h2Text);
	return m ? (m[1] ?? '').trim() : null;
}

/** Parse the body (after frontmatter) into preamble + stacks + archive. */
export function parseBody(
	body: string,
	config: BoardConfig,
): { preamble: string; stacks: Stack[]; archive?: RawArchive } {
	const lines = body.split('\n');

	// The archive heading ends the board: everything after it belongs to the
	// archive and is kept verbatim, never interpreted here (archive.md §4).
	let archive: RawArchive | undefined;
	let end = lines.length;
	// Offset of the archive heading in `body`, so the text before it stays exact.
	let cut = body.length;
	for (let i = 0, at = 0; i < lines.length; i++) {
		const h2 = H2_RE.exec(lines[i]!);
		const heading = h2 ? stripArchive(h2[1] ?? '') : null;
		if (heading !== null) {
			archive = { heading, body: lines.slice(i + 1).join('\n') };
			end = i;
			cut = at;
			break;
		}
		at += lines[i]!.length + 1;
	}
	const withArchive = archive ? { archive } : {};

	let firstStack = -1;
	for (let i = 0; i < end; i++) {
		if (H2_RE.test(lines[i]!)) {
			firstStack = i;
			break;
		}
	}
	if (firstStack === -1) {
		return { preamble: body.slice(0, cut), stacks: [], ...withArchive };
	}

	let offset = 0;
	for (let i = 0; i < firstStack; i++) offset += lines[i]!.length + 1;
	const preamble = body.slice(0, offset);

	const stacks: Stack[] = [];
	let stack: Stack | null = null;
	let sink: string[] = [];

	for (let i = firstStack; i < end; i++) {
		const line = lines[i]!;

		const h2 = H2_RE.exec(line);
		if (h2) {
			const { text, collapsed } = stripCollapse(h2[1] ?? '');
			stack = { name: text.trim(), collapsed, lead: [], items: [] };
			stacks.push(stack);
			sink = stack.lead;
			continue;
		}
		// stack is non-null here: region begins with an H2 line.
		const s = stack!;

		const h3 = H3_RE.exec(line);
		if (h3) {
			const { text, collapsed } = stripCollapse(h3[1] ?? '');
			const divider: Divider = { name: text.trim(), collapsed, trailing: [] };
			s.items.push({ kind: 'divider', divider });
			sink = divider.trailing;
			continue;
		}

		const hr = HR_RE.exec(line);
		if (hr) {
			const divider: Divider = { collapsed: hr[1] !== undefined, trailing: [] };
			s.items.push({ kind: 'divider', divider });
			sink = divider.trailing;
			continue;
		}

		const content = cardLineText(line);
		if (content !== null) {
			const parsed = parseCardContent(content, config);
			s.items.push({ kind: 'card', card: parsed });
			sink = parsed.trailing;
			continue;
		}

		sink.push(line);
	}

	// A card's continuation lines can only be classified once they are all in:
	// the checklist is the leading contiguous block of nested task items (§4.5),
	// everything after it stays verbatim.
	for (const s of stacks) {
		for (const entry of s.items) {
			if (entry.kind !== 'card') continue;
			const split = splitChecklist(entry.card.trailing);
			entry.card.checklist = split.checklist;
			entry.card.trailing = split.trailing;
		}
	}

	return { preamble, stacks, ...withArchive };
}

/** Parse full board file text into a Board. */
export function parseBoard(text: string): Board {
	const normalized = text.replace(/\r\n/g, '\n');
	const fm = parseFrontmatter(normalized);
	const { preamble, stacks, archive } = parseBody(fm.body, fm.config);
	return {
		config: fm.config,
		frontmatterDoc: fm.doc,
		preamble,
		stacks,
		...(archive && { archive }),
		trailing: '',
	};
}
