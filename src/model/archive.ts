// The archive section's cards. Spec: docs/specs/archive.md §3, §4;
// markdown-format.md §5. Pure; no `obsidian`.
//
// The board holds its archive as raw text (`Board.archive`). Nothing in this
// module runs when a board is loaded or saved: parsing happens only when the
// archive modal asks for it, and writing a card into the archive *prepends*
// serialized lines without reading the rest of the section.

import { splitChecklist } from './checklist';
import { cardLineText, parseCardContent } from './parse';
import { serializeCardLines } from './serialize';
import type { ArchivedCard, BoardConfig, Card, RawArchive } from './types';

/** Heading written when the plugin creates the section (markdown-format.md §5). */
export const DEFAULT_ARCHIVE_HEADING = 'Archive';

// The value is escaped (`%` -> `\%`, `\` -> `\\`), so the closing `%%` can never
// be ambiguous and an escape is always consumed as a unit.
const FROM_RE = /%%from\|((?:\\[\s\S]|[^\\])*?)%%/;

export function escapeFrom(name: string): string {
	return name.replace(/\\/g, '\\\\').replace(/%/g, '\\%');
}

function unescapeFrom(raw: string): string {
	return raw.replace(/\\([\s\S])/g, '$1');
}

/** The `%%from|…%%` origin marker written after a card's tags. */
export function fromMarker(from: string | undefined): string {
	return from ? `%%from|${escapeFrom(from)}%%` : '';
}

/**
 * Split the origin marker off a card line's content. An absent, empty or
 * malformed marker means an unknown origin (§5.1) — legal, and restored to the
 * first stack.
 */
export function extractFrom(content: string): { from?: string; rest: string } {
	const m = FROM_RE.exec(content);
	if (!m) return { rest: content };
	const from = unescapeFrom(m[1] ?? '');
	const rest = content.slice(0, m.index) + content.slice(m.index + m[0].length);
	return { ...(from !== '' && { from }), rest };
}

function stripTrailingBlanks(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1]!.trim() === '') end--;
	return end === lines.length ? lines : lines.slice(0, end);
}

/**
 * Read the archive body into cards, newest first — the order they are written
 * in (§2). Called only by the archive modal and by the ops it drives.
 *
 * Dividers are not archived, so a `---` or `### ` line inside the section is
 * not interpreted: it rides along as a verbatim continuation line of the card
 * above it, exactly like any other unrecognized line.
 */
export function parseArchive(body: string, config: BoardConfig): ArchivedCard[] {
	const cards: ArchivedCard[] = [];
	let current: Card | null = null;

	for (const line of body.split('\n')) {
		const content = cardLineText(line);
		if (content !== null) {
			const { from, rest } = extractFrom(content);
			const card = parseCardContent(rest, config);
			current = card;
			cards.push({ card, ...(from !== undefined && { from }) });
			continue;
		}
		// Lines before the first card (the blank one after the heading) belong to
		// no card and are dropped when the archive is rewritten.
		current?.trailing.push(line);
	}

	for (const entry of cards) {
		const split = splitChecklist(stripTrailingBlanks(entry.card.trailing));
		entry.card.checklist = split.checklist;
		entry.card.trailing = split.trailing;
	}
	return cards;
}

/** One archived card's lines: its ordinary card grammar plus the origin marker. */
export function serializeArchivedCard(
	card: Card,
	from: string | undefined,
	config: BoardConfig,
): string[] {
	const trimmed = card.trailing.length ? { ...card, trailing: stripTrailingBlanks(card.trailing) } : card;
	return serializeCardLines(trimmed, config, fromMarker(from));
}

/**
 * The archive body for a parsed list: a blank line after the heading, then the
 * cards back to back (§2). An empty list produces an empty body — the section
 * stays, with nothing in it.
 */
export function serializeArchive(cards: ArchivedCard[], config: BoardConfig): string {
	if (!cards.length) return '';
	const lines: string[] = [];
	for (const entry of cards) lines.push(...serializeArchivedCard(entry.card, entry.from, config));
	return ['', ...lines, ''].join('\n');
}

/**
 * Put a card's lines at the **top** of the archive, creating the section when
 * the file has none. The rest of the body is never read, which is what keeps
 * archiving as cheap as loading (§4).
 */
export function prependToArchive(archive: RawArchive | undefined, lines: string[]): RawArchive {
	const heading = archive?.heading ?? DEFAULT_ARCHIVE_HEADING;
	const rest = archive?.body ?? '';
	const tail = rest === '' ? '\n' : rest.startsWith('\n') ? rest : `\n${rest}`;
	return { heading, body: `\n${lines.join('\n')}${tail}` };
}
