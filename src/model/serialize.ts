// Board -> Markdown. Canonical and round-trip stable.
// Spec: docs/specs/markdown-format.md §4, §6. Pure; no `obsidian`.

import { serializeChecklist } from './checklist';
import { serializeFrontmatter } from './frontmatter';
import { formatToken } from './properties';
import { Board, BoardConfig, Card, Divider, Stack } from './types';

const COLLAPSE = '%%collapsed%%';

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

function serializeCard(card: Card, config: BoardConfig): string[] {
	const content = cardLineContent(card, config);
	// A task card is an ordinary Markdown task list item (§4.0): `- [x] text`.
	const marker = card.task !== undefined ? `[${card.task}]` : '';
	const line = `-${[marker, content].filter(Boolean).map((s) => ` ${s}`).join('')}`;
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
		if (item.kind === 'card') lines.push(...serializeCard(item.card, config));
		else lines.push(...serializeDivider(item.divider));
	}
	return lines;
}

/** Serialize the body (preamble + stacks) back to text. */
export function serializeBody(board: Board): string {
	const regionLines: string[] = [];
	for (const stack of board.stacks) {
		regionLines.push(...serializeStack(stack, board.config));
	}
	return board.preamble + regionLines.join('\n');
}

/** Serialize a full Board to board-file text. */
export function serializeBoard(board: Board): string {
	return serializeFrontmatter(board.frontmatterDoc, serializeBody(board));
}
