// The archive section's cards. Spec: docs/specs/archive.md §3, §4;
// markdown-format.md §5. Pure; no `obsidian`.
//
// The board holds its archive as raw text (`Board.archive`). Nothing in this
// module runs when a board is loaded or saved: parsing happens only when the
// archive modal asks for it, and writing a card into the archive *prepends*
// serialized lines without reading the rest of the section.

import { splitChecklist } from './checklist';
import { MARKER_VALUE, escapeMarker, unescapeMarker } from './markers';
import { cardLineText, parseCardContent } from './parse';
import { serializeCardLines } from './serialize';
import type { ArchivedCard, BoardConfig, Card, RawArchive } from './types';

/** Heading written when the plugin creates the section (markdown-format.md §5). */
export const DEFAULT_ARCHIVE_HEADING = 'Archive';

// The values are escaped by `markers.ts` — the same rule every `%%name|value%%`
// marker follows — so the closing `%%` can never be ambiguous.
const FROM_RE = new RegExp(`%%from\\|(${MARKER_VALUE})%%`);
const AT_RE = new RegExp(`%%at\\|(${MARKER_VALUE})%%`);

/** The `%%from|…%%` origin marker written after a card's tags. */
export function fromMarker(from: string | undefined): string {
	return from ? `%%from|${escapeMarker(from)}%%` : '';
}

/** The `%%at|…%%` archived-at marker, written right after the origin (§5.1). */
export function atMarker(at: string | undefined): string {
	return at ? `%%at|${escapeMarker(at)}%%` : '';
}

/** Split one `%%name|value%%` marker off a card line's content. */
function extractMarker(content: string, re: RegExp): { value?: string; rest: string } {
	const m = re.exec(content);
	if (!m) return { rest: content };
	const value = unescapeMarker(m[1] ?? '');
	const rest = content.slice(0, m.index) + content.slice(m.index + m[0].length);
	return { ...(value !== '' && { value }), rest };
}

/**
 * Split the origin marker off a card line's content. An absent, empty or
 * malformed marker means an unknown origin (§5.1) — legal, and restored to the
 * first stack.
 */
export function extractFrom(content: string): { from?: string; rest: string } {
	const { value, rest } = extractMarker(content, FROM_RE);
	return { ...(value !== undefined && { from: value }), rest };
}

/**
 * Split the archived-at marker off a card line's content. Absent, empty or
 * malformed means an unknown time (§5.1) — legal, and every archive written
 * before the marker existed is exactly that case.
 */
export function extractAt(content: string): { at?: string; rest: string } {
	const { value, rest } = extractMarker(content, AT_RE);
	return { ...(value !== undefined && { at: value }), rest };
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
			const origin = extractFrom(content);
			const stamp = extractAt(origin.rest);
			const card = parseCardContent(stamp.rest, config);
			current = card;
			cards.push({
				card,
				...(origin.from !== undefined && { from: origin.from }),
				...(stamp.at !== undefined && { at: stamp.at }),
			});
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

/** One archived card's lines: the ordinary card grammar plus its two markers. */
export function serializeArchivedCard(entry: ArchivedCard, config: BoardConfig): string[] {
	const card = entry.card;
	const trimmed = card.trailing.length ? { ...card, trailing: stripTrailingBlanks(card.trailing) } : card;
	const suffix = [fromMarker(entry.from), atMarker(entry.at)].filter(Boolean).join(' ');
	return serializeCardLines(trimmed, config, suffix);
}

/**
 * The archive body for a parsed list: a blank line after the heading, then the
 * cards back to back (§2). An empty list produces an empty body — the section
 * stays, with nothing in it.
 */
export function serializeArchive(cards: ArchivedCard[], config: BoardConfig): string {
	if (!cards.length) return '';
	const lines: string[] = [];
	for (const entry of cards) lines.push(...serializeArchivedCard(entry, config));
	return ['', ...lines, ''].join('\n');
}

/**
 * How many cards the archive body holds. Only the *shape* of each line is
 * tested — no card is parsed — so this stays cheap enough to run on the write
 * path the whole design keeps free of parsing (§4).
 */
export function countArchivedCards(body: string): number {
	let count = 0;
	for (const line of body.split('\n')) {
		if (cardLineText(line) !== null) count++;
	}
	return count;
}

/**
 * Enforce the archive's card limit (§4.2) by dropping cards off the **end** of
 * the body — the oldest, since cards are written newest-first. A card's own
 * continuation lines travel with it: the cut is made at the line that starts
 * the first card past the limit, so everything below goes with it.
 *
 * Like `countArchivedCards`, this only recognizes card lines; it never builds a
 * card. Returns the same string when the archive is within its limit, which is
 * the overwhelmingly common case.
 */
export function trimArchiveBody(body: string, limit: number): string {
	const max = Math.max(1, Math.floor(limit));
	const lines = body.split('\n');
	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		if (cardLineText(lines[i]!) === null) continue;
		count++;
		if (count <= max) continue;
		// Keep the body's trailing newline, so the section still ends the way
		// `serializeArchive` and `prependToArchive` write it.
		return lines.slice(0, i).join('\n').replace(/\n*$/, '\n');
	}
	return body;
}

/**
 * Put a card's lines at the **top** of the archive, creating the section when
 * the file has none, and drop whatever the limit no longer allows. The rest of
 * the body is still never *parsed*, which is what keeps archiving as cheap as
 * loading (§4).
 */
export function prependToArchive(
	archive: RawArchive | undefined,
	lines: string[],
	limit = Infinity,
): RawArchive {
	const heading = archive?.heading ?? DEFAULT_ARCHIVE_HEADING;
	const rest = archive?.body ?? '';
	const tail = rest === '' ? '\n' : rest.startsWith('\n') ? rest : `\n${rest}`;
	const body = `\n${lines.join('\n')}${tail}`;
	return { heading, body: Number.isFinite(limit) ? trimArchiveBody(body, limit) : body };
}

/**
 * The archive in **display** order: by archived-at, newest first by default
 * (§4.1). Returns indexes into `cards`, because every op addresses an entry by
 * its position in the file — the order it is shown in must not change what
 * "restore the third row" means.
 *
 * A card with no `%%at|…%%` was archived before the marker existed, so it sorts
 * as older than any dated one. Ties keep document order, which is itself
 * recency order — and invert with everything else, so an archive that predates
 * timestamps entirely still reverses cleanly.
 */
export function archiveOrder(cards: ArchivedCard[], newestFirst: boolean): number[] {
	return cards
		.map((_, i) => i)
		.sort((a, b) => {
			const at = cards[a]!.at ?? '';
			const bt = cards[b]!.at ?? '';
			const cmp = at < bt ? -1 : at > bt ? 1 : 0;
			if (cmp !== 0) return newestFirst ? -cmp : cmp;
			return newestFirst ? a - b : b - a;
		});
}
