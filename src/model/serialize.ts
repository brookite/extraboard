// Board -> Markdown. Canonical and round-trip stable.
// Spec: docs/specs/markdown-format.md §4, §6. Pure; no `obsidian`.

import { serializeChecklist } from './checklist';
import { serializeFrontmatter } from './frontmatter';
import { formatToken } from './properties';
import { Board, BoardConfig, Card, Divider, Stack } from './types';

const COLLAPSE = '%%collapsed%%';
const ARCHIVE = '%%archive%%';

/**
 * The archive's heading line. The **marker** identifies the section, not the
 * text, so the heading may say anything — including nothing (markdown-format.md
 * §5).
 */
export function archiveHeadingLine(heading: string): string {
	return heading ? `## ${heading} ${ARCHIVE}` : `## ${ARCHIVE}`;
}

/**
 * The text of a card's `- ` line without the task marker: title, property
 * tokens in config order, then tags. This is also what the inline card editor
 * shows, so re-parsing it reproduces the card (the marker is carried over
 * separately by `ops.setCardText`).
 */
export function cardLineContent(card: Card, config: BoardConfig): string {
	const order = new Map(config.properties.map((p, i) => [p.name, i]));
	const decorated = card.properties.map((pv, idx) => ({
		pv,
		rank: order.get(pv.name) ?? config.properties.length,
		idx,
	}));
	decorated.sort((a, b) => a.rank - b.rank || a.idx - b.idx);

	const segments: string[] = [];
	if (card.title) segments.push(card.title);
	for (const d of decorated) segments.push(formatToken(d.pv));
	for (const tag of card.tags) segments.push(`#${tag}`);

	return segments.join(' ');
}

/**
 * A card's lines. `suffix` is appended to the card line after its tags — the
 * archive's `%%from|…%%` origin marker is the only thing that uses it
 * (markdown-format.md §5.1).
 */
export function serializeCardLines(card: Card, config: BoardConfig, suffix = ''): string[] {
	const content = cardLineContent(card, config);
	// A task card is an ordinary Markdown task list item (§4.0): `- [x] text`.
	const marker = card.task !== undefined ? `[${card.task}]` : '';
	const line = `-${[marker, content, suffix].filter(Boolean).map((s) => ` ${s}`).join('')}`;
	// The checklist sits directly under the card line, before any verbatim
	// continuation lines (markdown-format.md §4.5).
	return [line, ...serializeChecklist(card.checklist), ...card.trailing];
}

function serializeDivider(divider: Divider): string[] {
	let line: string;
	if (divider.name !== undefined) {
		line = `### ${divider.name}`;
	} else {
		line = '---';
	}
	if (divider.collapsed) line += ` ${COLLAPSE}`;
	return [line, ...divider.trailing];
}

function serializeStack(stack: Stack, config: BoardConfig): string[] {
	let heading = `## ${stack.name}`;
	if (stack.collapsed) heading += ` ${COLLAPSE}`;
	const lines = [heading, ...stack.lead];
	for (const item of stack.items) {
		if (item.kind === 'card') lines.push(...serializeCardLines(item.card, config));
		else lines.push(...serializeDivider(item.divider));
	}
	return lines;
}

/** Serialize the body (preamble + stacks + archive) back to text. */
export function serializeBody(board: Board): string {
	const regionLines: string[] = [];
	for (const stack of board.stacks) {
		regionLines.push(...serializeStack(stack, board.config));
	}
	// The archive is re-emitted exactly as it was read: its cards are text here,
	// so an archive nobody opened survives a round trip byte for byte
	// (archive.md §4).
	if (board.archive) {
		regionLines.push(archiveHeadingLine(board.archive.heading), ...board.archive.body.split('\n'));
	}
	return board.preamble + regionLines.join('\n');
}

/** Serialize a full Board to board-file text. */
export function serializeBoard(board: Board): string {
	return serializeFrontmatter(board.frontmatterDoc, serializeBody(board));
}
