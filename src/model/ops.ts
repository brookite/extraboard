// Pure board mutations used by the Kanban editor (M4).
// Spec: docs/specs/kanban-view.md §6. Pure; no `obsidian`.
//
// Every operation returns a new Board. Untouched stacks and items keep their
// object identity, so the only Markdown that changes is the region the user
// actually edited. Stacks touched by an operation are re-normalized so blank
// lines stay canonical (see `normalizeStack`).

import { configToDoc, writeConfig } from './frontmatter';
import { parseCardContent } from './parse';
import { formatValue, parseValue } from './properties';
import type { Board, BoardConfig, Card, Divider, Stack, StackItem } from './types';

/** Address of an item inside a board. */
export interface ItemRef {
	stack: number;
	item: number;
}

/**
 * Where to insert: before the item currently at this index, or at the end when
 * `null`. Resolved by identity, so callers may compute it against the board as
 * it looked before the move.
 */
export type InsertPos = number | null;

// --- line helpers -----------------------------------------------------------

const isBlank = (line: string): boolean => line.trim() === '';

function stripTrailingBlanks(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && isBlank(lines[end - 1]!)) end--;
	return end === lines.length ? lines : lines.slice(0, end);
}

function sameLines(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((line, i) => line === b[i]);
}

function withTrailing<T extends { trailing: string[] }>(item: T, trailing: string[]): T {
	return sameLines(item.trailing, trailing) ? item : { ...item, trailing };
}

/**
 * Canonical blank-line layout inside a stack: one blank line after the heading,
 * one after every divider, one after the last card of a group (i.e. before a
 * divider and at the end of the stack), and none between consecutive cards.
 * Non-blank verbatim lines are preserved; this only touches blank runs.
 *
 * Idempotent, so re-serializing an untouched, already-canonical board is a
 * no-op — boards written by earlier versions only get reflowed in the stacks
 * the user edits.
 */
function normalizeStack(stack: Stack): Stack {
	const lead = [...stripTrailingBlanks(stack.lead), ''];

	const items = stack.items.map((entry, i) => {
		const next = stack.items[i + 1];
		const wantBlank = entry.kind === 'divider' || !next || next.kind === 'divider';
		const base =
			entry.kind === 'card' ? stripTrailingBlanks(entry.card.trailing) : stripTrailingBlanks(entry.divider.trailing);
		const trailing = wantBlank ? [...base, ''] : base;
		if (entry.kind === 'card') {
			const card = withTrailing(entry.card, trailing);
			return card === entry.card ? entry : { kind: 'card' as const, card };
		}
		const divider = withTrailing(entry.divider, trailing);
		return divider === entry.divider ? entry : { kind: 'divider' as const, divider };
	});

	const leadChanged = !sameLines(stack.lead, lead);
	const itemsChanged = items.some((entry, i) => entry !== stack.items[i]);
	if (!leadChanged && !itemsChanged) return stack;
	return { ...stack, lead, items };
}

// --- board/stack plumbing ---------------------------------------------------

function replaceStack(board: Board, index: number, stack: Stack): Board {
	const stacks = board.stacks.slice();
	stacks[index] = normalizeStack(stack);
	return { ...board, stacks };
}

function withItems(board: Board, stackIndex: number, items: StackItem[]): Board {
	const stack = board.stacks[stackIndex];
	if (!stack) return board;
	return replaceStack(board, stackIndex, { ...stack, items });
}

/** Resolve an insert position to an array index using item identity. */
function resolveIndex<T>(items: T[], target: T | undefined): number {
	if (target === undefined) return items.length;
	const at = items.indexOf(target);
	return at === -1 ? items.length : at;
}

// --- constructors -----------------------------------------------------------

export function emptyStack(name: string): Stack {
	return { name, collapsed: false, lead: [''], items: [] };
}

export function newCard(text: string, board: Board): Card {
	return parseCardContent(text, board.config);
}

// --- stack operations -------------------------------------------------------

export function addStack(board: Board, name: string, at: InsertPos = null): Board {
	const stacks = board.stacks.slice();
	const index = at === null ? stacks.length : Math.max(0, Math.min(at, stacks.length));
	stacks.splice(index, 0, emptyStack(name));
	// Normalize the neighbour too: a stack that used to end the file may need a
	// blank line before the new heading.
	const board2 = { ...board, stacks };
	return index > 0 ? replaceStack(board2, index - 1, stacks[index - 1]!) : board2;
}

export function renameStack(board: Board, index: number, name: string): Board {
	const stack = board.stacks[index];
	if (!stack || stack.name === name) return board;
	return replaceStack(board, index, { ...stack, name });
}

export function setStackCollapsed(board: Board, index: number, collapsed: boolean): Board {
	const stack = board.stacks[index];
	if (!stack || stack.collapsed === collapsed) return board;
	return replaceStack(board, index, { ...stack, collapsed });
}

export function deleteStack(board: Board, index: number): Board {
	if (!board.stacks[index]) return board;
	const stacks = board.stacks.slice();
	stacks.splice(index, 1);
	return { ...board, stacks };
}

/** Move a stack before the stack currently at `before` (or to the end). */
export function moveStack(board: Board, from: number, before: InsertPos): Board {
	const moved = board.stacks[from];
	if (!moved) return board;
	const target = before === null ? undefined : board.stacks[before];
	if (target === moved) return board;

	const stacks = board.stacks.slice();
	stacks.splice(from, 1);
	stacks.splice(resolveIndex(stacks, target), 0, moved);
	if (stacks.every((s, i) => s === board.stacks[i])) return board;
	return { ...board, stacks };
}

// --- item operations --------------------------------------------------------

export function addCard(board: Board, stackIndex: number, text: string, at: InsertPos = null): Board {
	const stack = board.stacks[stackIndex];
	if (!stack) return board;
	const items = stack.items.slice();
	const index = at === null ? items.length : Math.max(0, Math.min(at, items.length));
	items.splice(index, 0, { kind: 'card', card: newCard(text, board) });
	return withItems(board, stackIndex, items);
}

export function addDivider(
	board: Board,
	stackIndex: number,
	name: string | undefined,
	at: InsertPos = null,
): Board {
	const stack = board.stacks[stackIndex];
	if (!stack) return board;
	const divider: Divider = { collapsed: false, trailing: [] };
	if (name !== undefined) divider.name = name;
	const items = stack.items.slice();
	const index = at === null ? items.length : Math.max(0, Math.min(at, items.length));
	items.splice(index, 0, { kind: 'divider', divider });
	return withItems(board, stackIndex, items);
}

/**
 * Replace a card's inline content (title + property tokens + tags). The editor
 * shows the text without the task marker, so an existing marker is carried
 * over — unless the user typed a new one (`[x] …`) in front of the text.
 */
export function setCardText(board: Board, ref: ItemRef, text: string): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	const parsed = newCard(text, board);
	const task = parsed.task ?? entry.card.task;
	const card: Card = { ...parsed, ...(task !== undefined && { task }), trailing: entry.card.trailing };
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'card', card };
	return withItems(board, ref.stack, items);
}

/** True for a card whose task marker means "done" (§4.0). */
export function isCardDone(card: Card): boolean {
	return card.task === 'x' || card.task === 'X';
}

/**
 * Set a card's task marker; `undefined` turns it back into a plain list item.
 */
export function setCardTask(board: Board, ref: ItemRef, task: string | undefined): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card' || entry.card.task === task) return board;
	const card: Card = { ...entry.card };
	if (task === undefined) delete card.task;
	else card.task = task;
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'card', card };
	return withItems(board, ref.stack, items);
}

/**
 * Toggle a card's checkbox. A card that is not a task item becomes a done task;
 * a done one goes back to `[ ]`. A custom marker (`[/]`, `[-]`) counts as "not
 * done", so toggling it means "done" — nothing rewrites it until then.
 */
export function toggleCardTask(board: Board, ref: ItemRef): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	return setCardTask(board, ref, isCardDone(entry.card) ? ' ' : 'x');
}

export function renameDivider(board: Board, ref: ItemRef, name: string | undefined): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'divider') return board;
	const divider: Divider = { ...entry.divider };
	if (name === undefined) delete divider.name;
	else divider.name = name;
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'divider', divider };
	return withItems(board, ref.stack, items);
}

export function setDividerCollapsed(board: Board, ref: ItemRef, collapsed: boolean): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'divider' || entry.divider.collapsed === collapsed) return board;
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'divider', divider: { ...entry.divider, collapsed } };
	return withItems(board, ref.stack, items);
}

export function deleteItem(board: Board, ref: ItemRef): Board {
	const stack = board.stacks[ref.stack];
	if (!stack?.items[ref.item]) return board;
	const items = stack.items.slice();
	items.splice(ref.item, 1);
	return withItems(board, ref.stack, items);
}

export function duplicateItem(board: Board, ref: ItemRef): Board {
	const stack = board.stacks[ref.stack];
	const entry = stack?.items[ref.item];
	if (!stack || !entry) return board;
	const copy: StackItem =
		entry.kind === 'card'
			? {
					kind: 'card',
					card: {
						...entry.card,
						properties: entry.card.properties.slice(),
						tags: entry.card.tags.slice(),
						trailing: entry.card.trailing.slice(),
					},
				}
			: { kind: 'divider', divider: { ...entry.divider, trailing: entry.divider.trailing.slice() } };
	const items = stack.items.slice();
	items.splice(ref.item + 1, 0, copy);
	return withItems(board, ref.stack, items);
}

/**
 * Move an item before the item currently at `before` in `toStack` (or to the
 * end of that stack). Positions are resolved by identity, so `before` may be an
 * index taken from the pre-move board even for same-stack moves.
 */
export function moveItem(board: Board, from: ItemRef, toStack: number, before: InsertPos): Board {
	const source = board.stacks[from.stack];
	const dest = board.stacks[toStack];
	const moved = source?.items[from.item];
	if (!source || !dest || !moved) return board;

	const target = before === null ? undefined : dest.items[before];
	if (target === moved) return board;

	if (from.stack === toStack) {
		const items = source.items.slice();
		items.splice(from.item, 1);
		items.splice(resolveIndex(items, target), 0, moved);
		if (items.every((item, i) => item === source.items[i])) return board;
		return withItems(board, toStack, items);
	}

	const sourceItems = source.items.slice();
	sourceItems.splice(from.item, 1);
	const destItems = dest.items.slice();
	destItems.splice(resolveIndex(destItems, target), 0, moved);

	const stacks = board.stacks.slice();
	stacks[from.stack] = normalizeStack({ ...source, items: sourceItems });
	stacks[toStack] = normalizeStack({ ...dest, items: destItems });
	return { ...board, stacks };
}

// --- board configuration ----------------------------------------------------

/**
 * Replace the board configuration and write it back into the `extraboard`
 * frontmatter node. The YAML document is cloned first, so the previous board
 * object stays valid and the op keeps the usual "new board out" contract;
 * foreign frontmatter keys and comments are preserved by `writeConfig`.
 *
 * Existing cards are deliberately left alone: a value that no longer validates
 * under the new definition keeps its text until the user edits that card
 * (kanban-view.md §5.4).
 */
export function setBoardConfig(board: Board, config: BoardConfig): Board {
	let doc = board.frontmatterDoc;
	if (doc) {
		doc = doc.clone();
		writeConfig(doc, config);
	} else {
		doc = configToDoc(config);
	}
	return { ...board, config, frontmatterDoc: doc };
}

// --- queries ----------------------------------------------------------------

/**
 * Card values that would no longer validate under `config` — i.e. the tokens a
 * future re-read of the file would drop. Used to warn before board settings are
 * changed; nothing is rewritten (kanban-view.md §5.4).
 */
export function invalidatedValues(
	board: Board,
	config: BoardConfig,
): { card: string; property: string }[] {
	const defs = new Map(config.properties.map((d) => [d.name, d]));
	const out: { card: string; property: string }[] = [];
	for (const stack of board.stacks) {
		for (const entry of stack.items) {
			if (entry.kind !== 'card') continue;
			for (const pv of entry.card.properties) {
				if (parseValue(pv.name, formatValue(pv), defs.get(pv.name)) === null) {
					out.push({ card: entry.card.title, property: pv.name });
				}
			}
		}
	}
	return out;
}

/** Number of cards in a stack (dividers do not count). */
export function cardCount(stack: Stack): number {
	return stack.items.filter((item) => item.kind === 'card').length;
}

/**
 * Items hidden because they follow a collapsed divider. A collapsed divider
 * hides everything up to the next divider or the end of the stack.
 */
export function hiddenItems(stack: Stack): Set<number> {
	const hidden = new Set<number>();
	let collapsed = false;
	stack.items.forEach((entry, i) => {
		if (entry.kind === 'divider') {
			collapsed = entry.divider.collapsed;
			return;
		}
		if (collapsed) hidden.add(i);
	});
	return hidden;
}
