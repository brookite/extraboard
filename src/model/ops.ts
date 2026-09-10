// Pure board mutations used by the Kanban editor (M4).
// Spec: docs/specs/kanban-view.md §6. Pure; no `obsidian`.
//
// Every operation returns a new Board. Untouched stacks and items keep their
// object identity, so the only Markdown that changes is the region the user
// actually edited. Stacks touched by an operation are re-normalized so blank
// lines stay canonical (see `normalizeStack`).

import { parseArchive, prependToArchive, serializeArchive, serializeArchivedCard } from './archive';
import { ChecklistItem, checkAll, cloneChecklist, progress } from './checklist';
import { processCardText } from './cardText';
import { parseCardLink, unlinkedTitle } from './link';
import { parseCardContent } from './parse';
import { formatValue, normalizeDateList, parseValue } from './properties';
import {
	dividerIndex,
	groupRange,
	sectionName,
	sectionOf,
	sectionOrder,
	type SectionKey,
} from './sections';
import type {
	ArchivedCard,
	Board,
	BoardConfig,
	CalendarMode,
	Card,
	Divider,
	ListControls,
	ListGroupBy,
	PropertyDef,
	PropertyValue,
	SectionState,
	Stack,
	StackItem,
	ViewDef,
	ViewDisplay,
} from './types';
import { isEmptyFilter, type FilterNode } from './filter';
import type { SortRule } from './sort';
import { nextViewId } from './views';

/**
 * What an archiving op needs that the model cannot know: **when** the cards are
 * being archived, and **how many** the archive may keep (archive.md §4.1, §4.2).
 * Both come from outside — a pure op must read neither the clock nor the plugin
 * settings — so every caller states them, and a test states them as constants.
 *
 * `at` absent writes no `%%at|…%%` marker; `limit` absent enforces none.
 */
export interface ArchiveOpts {
	/** Canonical `YYYY-MM-DD HH:mm` local time, written as each card's `%%at|…%%`. */
	at?: string;
	/** Cards the archive may hold; the oldest beyond it are dropped. */
	limit?: number;
}

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

export function emptyStack(name: string, completes = false): Stack {
	return { name, collapsed: false, completes, lead: [''], items: [] };
}

/**
 * A card from editor text. The text goes through the card text processor first
 * (`cardText.ts`), so a typed task list becomes the card's checklist and block
 * constructs a card cannot hold are dropped.
 */
export function newCard(text: string, board: Board): Card {
	const processed = processCardText(text);
	const card = parseCardContent(processed.text, board.config);
	return processed.checklist.length ? { ...card, checklist: processed.checklist } : card;
}

// --- stack operations -------------------------------------------------------

export function addStack(
	board: Board,
	name: string,
	at: InsertPos = null,
	completes = false,
): Board {
	const stacks = board.stacks.slice();
	const index = at === null ? stacks.length : Math.max(0, Math.min(at, stacks.length));
	stacks.splice(index, 0, emptyStack(name, completes));
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

/**
 * Mark a stack as completing the cards that land in it, or stop it doing so
 * (stack-completion-and-divider-colors.md §3). **Nothing is completed
 * retroactively:** the cards already in the stack are left exactly as they are,
 * and the flag only decides what happens to the next card that enters.
 */
export function setStackCompletes(board: Board, index: number, completes: boolean): Board {
	const stack = board.stacks[index];
	if (!stack || stack.completes === completes) return board;
	return replaceStack(board, index, { ...stack, completes });
}

/**
 * Delete a stack. The cards it holds are **archived**, not destroyed
 * (archive.md §5.6), each recording this stack as its origin; dividers carry no
 * content and go with it, as do untitled cards.
 */
export function deleteStack(board: Board, index: number, opts: ArchiveOpts): Board {
	const stack = board.stacks[index];
	if (!stack) return board;
	const lines = archiveLines(stack.items, stack, board.config, opts);
	const stacks = board.stacks.slice();
	stacks.splice(index, 1);
	const next = { ...board, stacks };
	return lines.length
		? { ...next, archive: prependToArchive(next.archive, lines, opts.limit) }
		: next;
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
	// A card created in a completing stack is created done (§3.2).
	const card = enteringCard(newCard(text, board), stack);
	items.splice(index, 0, { kind: 'card', card });
	return withItems(board, stackIndex, items);
}

/**
 * The card as it enters `stack`: completed when the stack completes what lands
 * in it, unchanged otherwise. Every path that puts a card into a stack goes
 * through here, so drag, "Move to", the composer and restore agree
 * (stack-completion-and-divider-colors.md §3.2).
 */
function enteringCard(card: Card, stack: Stack): Card {
	return stack.completes ? completeCard(card) : card;
}

/**
 * A completed card: its own marker is `x` and **every checklist item at every
 * level** is ticked (§3.1). A custom marker (`- [/]`) is overwritten — the one
 * place the plugin rewrites a marker the user did not toggle — while a card
 * that already reads as done keeps its own `x`/`X`. Returns the same card when
 * there is nothing to complete.
 */
export function completeCard(card: Card): Card {
	const checklist = checkAll(card.checklist);
	const task = isCardDone(card) ? (card.task ?? 'x') : 'x';
	if (task === card.task && checklist === card.checklist) return card;
	return { ...card, task, checklist };
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

/** Replace one card in place, keeping every other item's identity. */
function replaceCard(board: Board, ref: ItemRef, card: Card): Board {
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'card', card };
	return withItems(board, ref.stack, items);
}

/**
 * Replace a card's inline content (title + property tokens + tags). The editor
 * shows the text without the task marker, so an existing marker is carried
 * over — unless the user typed a new one (`[x] …`) in front of the text.
 *
 * With `keepProperties` the field held only the title and tags, so the card's
 * property values are carried over instead of being read from the text
 * (card-content-and-checklists.md §3). A token the user typed anyway is still
 * honoured — it overrides the carried-over value of the same name — so hiding
 * the tokens can never lose a property, whichever way the user edits.
 *
 * Task lines typed into the field are lifted out by the text processor and
 * **prepended** to the card's existing checklist (§3.2), so writing a checklist
 * in the editor adds to it rather than replacing it.
 */
export function setCardText(
	board: Board,
	ref: ItemRef,
	text: string,
	options: { keepProperties?: boolean } = {},
): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	const parsed = newCard(text, board);
	const task = parsed.task ?? entry.card.task;
	const properties = options.keepProperties
		? mergeProperties(entry.card.properties, parsed.properties)
		: parsed.properties;
	const checklist = parsed.checklist.length
		? [...parsed.checklist, ...entry.card.checklist]
		: entry.card.checklist;
	const card: Card = {
		...parsed,
		properties,
		...(task !== undefined && { task }),
		checklist,
		trailing: entry.card.trailing,
	};
	return replaceCard(board, ref, card);
}

/** `base` with every value from `typed` overriding or appended by name. */
function mergeProperties(base: PropertyValue[], typed: PropertyValue[]): PropertyValue[] {
	if (!typed.length) return base;
	const out = base.slice();
	for (const pv of typed) {
		const at = out.findIndex((p) => p.name === pv.name);
		if (at === -1) out.push(pv);
		else out[at] = pv;
	}
	return out;
}

/** Replace only the card's title, leaving properties, tags and task alone. */
export function setCardTitle(board: Board, ref: ItemRef, title: string): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card' || entry.card.title === title) return board;
	return replaceCard(board, ref, { ...entry.card, title });
}

/**
 * Replace the card's title with the display text of its content link, leaving
 * the note on disk alone (card-content-and-checklists.md §2).
 */
export function unlinkCardNote(board: Board, ref: ItemRef): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card' || !parseCardLink(entry.card.title)) return board;
	return setCardTitle(board, ref, unlinkedTitle(entry.card.title));
}

/** Set or replace one property value on a card (the editor's badges, §3.1). */
export function setCardProperty(board: Board, ref: ItemRef, pv: PropertyValue): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	// A `date-list` is kept sorted and free of unparsable elements on every
	// write, so the file never shows an out-of-order or dead date (properties.md).
	// If nothing survives, the property is absent — the same rule an empty
	// token value follows everywhere else.
	if (pv.type === 'date-list') {
		const raw = normalizeDateList(pv.raw);
		if (!raw.length) return removeCardProperty(board, ref, pv.name);
		pv = { ...pv, raw };
	}
	const properties = mergeProperties(entry.card.properties, [pv]);
	if (properties === entry.card.properties) return board;
	return replaceCard(board, ref, { ...entry.card, properties });
}

/** Remove every value of `name` from a card. */
export function removeCardProperty(board: Board, ref: ItemRef, name: string): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	const properties = entry.card.properties.filter((pv) => pv.name !== name);
	if (properties.length === entry.card.properties.length) return board;
	return replaceCard(board, ref, { ...entry.card, properties });
}

/**
 * Apply a pure tree transform from `model/checklist` to a card's checklist.
 * The transform returning the same array means nothing changed, so the file is
 * left alone — the same contract every op here follows.
 */
export function updateChecklist(
	board: Board,
	ref: ItemRef,
	mutate: (items: ChecklistItem[]) => ChecklistItem[],
): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;
	const checklist = mutate(entry.card.checklist);
	if (checklist === entry.card.checklist) return board;
	return replaceCard(board, ref, { ...entry.card, checklist });
}

/** `N/M` for a card's checklist; `total: 0` means "no indicator" (§4.2). */
export function checklistProgress(card: Card): { done: number; total: number } {
	return progress(card.checklist);
}

/** True for a card whose task marker means "done" (§4.0). */
export function isCardDone(card: Card): boolean {
	return card.task === 'x' || card.task === 'X';
}

/** True for a card with no text at all — its title is blank or only whitespace. */
export function isCardUntitled(card: Card): boolean {
	return card.title.trim() === '';
}

/** Remove every untitled card from every stack on the board. */
export function deleteUntitledCards(board: Board): Board {
	let next = board;
	board.stacks.forEach((stack, i) => {
		const items = stack.items.filter((item) => !(item.kind === 'card' && isCardUntitled(item.card)));
		if (items.length !== stack.items.length) next = withItems(next, i, items);
	});
	return next;
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

/** The board's single `color`-typed property definition, if it declares one. */
function colorDef(config: BoardConfig): PropertyDef | undefined {
	return config.properties.find((d) => d.type === 'color');
}

/** `base`, or `base 2`, `base 3`… when the board already uses that name. */
function freeName(config: BoardConfig, base: string): string {
	const taken = new Set(config.properties.map((d) => d.name));
	let name = base;
	for (let i = 2; taken.has(name); i++) name = `${base} ${String(i)}`;
	return name;
}

/**
 * Paint a card, or strip its color with `''`. The value lives in the board's
 * single `color`-typed property (kanban-view.md §5.2); a board that declares
 * none gets one added to its configuration the first time a card is painted, so
 * the card menu works without a trip through board settings first.
 */
export function setCardColor(board: Board, ref: ItemRef, color: string): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return board;

	const value = color.trim();
	const existing = colorDef(board.config);
	if (!existing && value === '') return board;

	const def: PropertyDef = existing ?? { name: freeName(board.config, 'color'), type: 'color' };
	const next = existing
		? board
		: setBoardConfig(board, { ...board.config, properties: [...board.config.properties, def] });

	// Match by name too: on a board that had no color property, an existing
	// `@{color|…}` token parsed as an untyped value and must be replaced, not
	// duplicated.
	const at = entry.card.properties.findIndex((pv) => pv.type === 'color' || pv.name === def.name);
	if (value === '' && at === -1) return board;

	const properties = entry.card.properties.slice();
	if (value === '') {
		properties.splice(at, 1);
	} else {
		const pv = { name: def.name, type: 'color' as const, value };
		const current = at === -1 ? undefined : properties[at];
		if (current?.type === 'color' && current.name === pv.name && current.value === value) {
			return board;
		}
		if (at === -1) properties.push(pv);
		else properties[at] = pv;
	}

	const items = next.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'card', card: { ...entry.card, properties } };
	return withItems(next, ref.stack, items);
}

export function renameDivider(board: Board, ref: ItemRef, name: string | undefined): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'divider') return board;
	const divider: Divider = { ...entry.divider };
	if (name === undefined) {
		delete divider.name;
		// An unnamed divider has no label to carry a color
		// (stack-completion-and-divider-colors.md §4.2).
		delete divider.color;
	} else divider.name = name;
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'divider', divider };
	return withItems(board, ref.stack, items);
}

/**
 * Color a **named** divider, or clear it with `''` (§4). The color is stored on
 * the divider alone: the cards of its group inherit it at render time, so no
 * card line is touched.
 */
export function setDividerColor(board: Board, ref: ItemRef, color: string): Board {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'divider' || entry.divider.name === undefined) return board;
	const value = color.trim() || undefined;
	if (value === entry.divider.color) return board;
	const divider: Divider = { ...entry.divider };
	if (value === undefined) delete divider.color;
	else divider.color = value;
	const items = board.stacks[ref.stack]!.items.slice();
	items[ref.item] = { kind: 'divider', divider };
	return withItems(board, ref.stack, items);
}

/**
 * The color a card at `index` inherits: the nearest divider above it in the
 * stack, if that one carries a color. A card before the first divider, or under
 * an uncolored one, inherits nothing (§4.1).
 */
export function groupColor(stack: Stack, index: number): string | undefined {
	for (let i = index - 1; i >= 0; i--) {
		const entry = stack.items[i];
		if (entry?.kind === 'divider') return entry.divider.color;
	}
	return undefined;
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
						checklist: cloneChecklist(entry.card.checklist),
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
	// Entering a completing stack completes the card; a move *within* one does
	// not, since the card did not enter anything (§3.2).
	const entering: StackItem =
		moved.kind === 'card' ? { kind: 'card', card: enteringCard(moved.card, dest) } : moved;
	const destItems = dest.items.slice();
	destItems.splice(resolveIndex(destItems, target), 0, entering);

	const stacks = board.stacks.slice();
	stacks[from.stack] = normalizeStack({ ...source, items: sourceItems });
	stacks[toStack] = normalizeStack({ ...dest, items: destItems });
	return { ...board, stacks };
}

// --- sections ---------------------------------------------------------------
//
// The list view's edits (list-view.md §4). A "section" is a divider read across
// stacks: named sections merge, an unnamed one stands alone, and the cards
// above a stack's first divider belong to no section at all. Every op here is
// expressed in those terms and lands on ordinary divider/card moves, so the
// Kanban side sees nothing unusual in the file.

/**
 * Add an empty named section from the list view. Its one physical divider is
 * appended to the first stack, after every card; other stacks receive their
 * divider only when a card enters the section there.
 */
export function addSection(board: Board, name: string): Board {
	const normalized = sectionName(name);
	if (!normalized || !board.stacks.length || sectionOrder(board).includes(normalized)) return board;
	return addDivider(board, 0, normalized);
}

/**
 * Where a stack's divider for `name` belongs, so the stack stays consistent
 * with the board's section order (§1.2): before this stack's divider of the
 * first section that follows `name` globally, else at the end of the stack.
 */
export function sectionInsertIndex(board: Board, stackIndex: number, name: string): number {
	const stack = board.stacks[stackIndex];
	if (!stack) return 0;
	const order = sectionOrder(board);
	const at = order.indexOf(name);
	if (at !== -1) {
		for (const later of order.slice(at + 1)) {
			const index = dividerIndex(stack, later);
			if (index !== -1) return index;
		}
	}
	return stack.items.length;
}

/**
 * The board with a divider named `name` present in `stackIndex`, plus that
 * divider's index. Creating one is what makes a section exist in a stack (§4.2);
 * a stack that already holds it is returned untouched.
 */
function ensureSection(
	board: Board,
	stackIndex: number,
	name: string,
): { board: Board; index: number } {
	const stack = board.stacks[stackIndex];
	if (!stack) return { board, index: -1 };
	const existing = dividerIndex(stack, name);
	if (existing !== -1) return { board, index: existing };
	const at = sectionInsertIndex(board, stackIndex, name);
	return { board: addDivider(board, stackIndex, name, at), index: at };
}

/** A ref as it reads after an item was inserted at `at` in the same stack. */
function shifted(ref: ItemRef, stackIndex: number, at: number): ItemRef {
	return ref.stack === stackIndex && ref.item >= at ? { ...ref, item: ref.item + 1 } : ref;
}

/**
 * The item index a card lands on when it enters `key` in this stack: the top or
 * end of that section's group, as `atTop` says.
 *
 * Returns `null` when the section is not in this stack, which only happens for
 * an anonymous section: the caller creates named ones first.
 */
function sectionEntryIndex(
	board: Board,
	stackIndex: number,
	key: SectionKey,
	atTop: boolean,
): number | null {
	const stack = board.stacks[stackIndex];
	if (!stack) return null;
	// A stack group is not a section: it is the whole stack, so it names no place
	// inside one. Grouping by stack moves cards with `moveItem` instead
	// (list-view.md §1.0), and every section op refuses the key outright.
	if (key.kind === 'stack') return null;
	if (key.kind === 'none') return atTop ? 0 : groupRange(stack, null).end;
	const at =
		key.kind === 'named'
			? dividerIndex(stack, key.name)
			: key.ref.stack === stackIndex && stack.items[key.ref.item]?.kind === 'divider'
				? key.ref.item
				: -1;
	if (at === -1) return null;
	const range = groupRange(stack, at);
	return atTop ? range.start : range.end;
}

/**
 * Add a card to a section, in the stack the composer picked (§4.2). A named
 * section missing from that stack is **created** on the way in — a section with
 * a card in it exists, one without does not (§1.1) — and the insertion itself
 * goes through `addCard`, so a completing stack completes the card as it would
 * anywhere else.
 */
export function addCardToSection(
	board: Board,
	stackIndex: number,
	key: SectionKey,
	text: string,
	atTop = false,
): Board {
	return addCardToSectionAt(board, stackIndex, key, text, atTop).board;
}

/**
 * The same insertion, plus **where the card landed**. The composer opens the
 * card it just created for editing (§4.2), and the only honest way to know
 * which tile that is, on a board where the op may also have created a divider
 * above it, is for the op to say so.
 *
 * `ref` is `null` exactly when nothing was inserted.
 */
export function addCardToSectionAt(
	board: Board,
	stackIndex: number,
	key: SectionKey,
	text: string,
	atTop = false,
): { board: Board; ref: ItemRef | null } {
	if (!board.stacks[stackIndex]) return { board, ref: null };
	let next = board;
	if (key.kind === 'named') {
		const ensured = ensureSection(next, stackIndex, key.name);
		if (ensured.index === -1) return { board, ref: null };
		next = ensured.board;
	}
	const at = sectionEntryIndex(next, stackIndex, key, atTop);
	if (at === null) return { board, ref: null };
	const withCard = addCard(next, stackIndex, text, at);
	if (withCard === next) return { board, ref: null };
	return { board: withCard, ref: { stack: stackIndex, item: at } };
}

/**
 * Move a card into `key` in `toStack` (§4.3). The two callers are the row's
 * section change — where `toStack` is the card's own stack, so it keeps it —
 * and the row's stack badge, which keeps the section instead.
 *
 * `before` is a card of the destination group the moved card lands in front of
 * and always wins when supplied by drag-and-drop. Without one, `atTop` selects
 * the start or end of the group for non-positional menu moves. A target ref is
 * resolved by identity like every other move, so it may be read off the
 * pre-move board.
 */
export function moveCardToSection(
	board: Board,
	from: ItemRef,
	toStack: number,
	key: SectionKey,
	before: ItemRef | null = null,
	atTop = false,
): Board {
	const entry = board.stacks[from.stack]?.items[from.item];
	if (entry?.kind !== 'card' || !board.stacks[toStack]) return board;

	let next = board;
	let ref = from;
	let target = before;
	if (key.kind === 'named') {
		const ensured = ensureSection(next, toStack, key.name);
		if (ensured.index === -1) return board;
		if (ensured.board !== next) {
			ref = shifted(ref, toStack, ensured.index);
			if (target) target = shifted(target, toStack, ensured.index);
			next = ensured.board;
		}
	}

	// A position inside the group beats the group's end: the user pointed at it.
	const at =
		target && target.stack === toStack && next.stacks[toStack]?.items[target.item]?.kind === 'card'
			? target.item
			: sectionEntryIndex(next, toStack, key, atTop);
	if (at === null) return board;
	const moved = moveItem(next, ref, toStack, at);
	return moved === next && next === board ? board : moved;
}

/**
 * Move a card to another stack, keeping the section its row is in (§4.3) — the
 * row's stack badge. The section is created in the target stack when it has
 * none, exactly as adding a card there would.
 */
export function moveCardToStack(board: Board, from: ItemRef, toStack: number): Board {
	if (from.stack === toStack) return board;
	return moveCardToSection(board, from, toStack, sectionOf(board, from));
}

/**
 * Move a whole section before `beforeName` in the list order, or to the end
 * with `null` (§4.1). In **every stack holding it**, the divider and the group
 * under it move together; a stack that holds neither section is left alone, so
 * the move is applied exactly where it means something.
 */
export function moveSection(board: Board, name: string, beforeName: string | null): Board {
	if (name === '' || name === beforeName) return board;
	let changed = false;
	const stacks = board.stacks.map((stack) => {
		const at = dividerIndex(stack, name);
		if (at === -1) return stack;
		const { end } = groupRange(stack, at);
		const items = stack.items.slice();
		const moved = items.splice(at, end - at);

		let target: number;
		if (beforeName === null) {
			target = items.length;
		} else {
			target = items.findIndex(
				(entry) => entry.kind === 'divider' && sectionName(entry.divider.name) === beforeName,
			);
			// Nothing to sit in front of here: this stack has no opinion about the
			// two sections' order, so it keeps the layout it has.
			if (target === -1) return stack;
		}
		if (target === at) return stack;
		items.splice(target, 0, ...moved);
		changed = true;
		return normalizeStack({ ...stack, items });
	});
	return changed ? { ...board, stacks } : board;
}

/**
 * Rename a section: every divider carrying the old name takes the new one
 * (§4.4). Renaming onto a name that already exists **merges** the two sections,
 * which is what the list then shows — no divider is deleted for it.
 */
export function renameSection(board: Board, oldName: string, newName: string): Board {
	const name = newName.trim();
	if (!name || !oldName || name === oldName) return board;
	let changed = false;
	const stacks = board.stacks.map((stack) => {
		let touched = false;
		const items = stack.items.map((entry) => {
			if (entry.kind !== 'divider' || sectionName(entry.divider.name) !== oldName) return entry;
			touched = true;
			return { kind: 'divider' as const, divider: { ...entry.divider, name } };
		});
		if (!touched) return stack;
		changed = true;
		return normalizeStack({ ...stack, items });
	});
	return changed ? { ...board, stacks } : board;
}

/**
 * Remove a section: its divider goes from every stack and **the cards stay
 * where they are**, joining the group above them (§4.4). Nothing is archived
 * and nothing is deleted, which is why the item needs no confirmation.
 */
export function removeSection(board: Board, name: string): Board {
	if (!name) return board;
	let changed = false;
	const stacks = board.stacks.map((stack) => {
		const items = stack.items.filter(
			(entry) => !(entry.kind === 'divider' && sectionName(entry.divider.name) === name),
		);
		if (items.length === stack.items.length) return stack;
		changed = true;
		return normalizeStack({ ...stack, items });
	});
	return changed ? { ...board, stacks } : board;
}

// --- archive ----------------------------------------------------------------
//
// Writing never reads the archive: a card is serialized and prepended to the
// body (archive.md §4). Only the modal's own actions — restore, delete, clear —
// need the parsed list, and they are the ones that pay for it.

/** The origin recorded for a card leaving `stack`; an unnamed stack has none. */
function originOf(stack: Stack): string | undefined {
	return stack.name.trim() ? stack.name : undefined;
}

/**
 * Archive lines for the cards among `items`, in document order. **An untitled
 * card is left out**: it holds nothing to restore, so every archive path drops
 * it instead of filling the archive with blanks (archive.md §5.1) — the same
 * rule "Delete untitled cards" already follows.
 */
function archiveLines(
	items: StackItem[],
	stack: Stack,
	config: BoardConfig,
	opts: ArchiveOpts,
): string[] {
	const lines: string[] = [];
	for (const item of items) {
		if (item.kind !== 'card' || isCardUntitled(item.card)) continue;
		const entry = {
			card: item.card,
			...(originOf(stack) !== undefined && { from: originOf(stack) }),
			...(opts.at !== undefined && { at: opts.at }),
		};
		lines.push(...serializeArchivedCard(entry, config));
	}
	return lines;
}

/**
 * Move one card off the board and into the archive (archive.md §5.1). An
 * untitled card is **deleted** instead: there is nothing in it to bring back.
 */
export function archiveCard(board: Board, ref: ItemRef, opts: ArchiveOpts): Board {
	const stack = board.stacks[ref.stack];
	const entry = stack?.items[ref.item];
	if (!stack || entry?.kind !== 'card') return board;
	if (isCardUntitled(entry.card)) return deleteItem(board, ref);

	const lines = archiveLines([entry], stack, board.config, opts);
	const items = stack.items.slice();
	items.splice(ref.item, 1);
	return withItems(
		{ ...board, archive: prependToArchive(board.archive, lines, opts.limit) },
		ref.stack,
		items,
	);
}

/** Cards whose own task marker is `x`/`X` — the only notion of "done" (§5.2). */
export function countCompletedCards(board: Board): number {
	let count = 0;
	for (const stack of board.stacks) {
		for (const item of stack.items) {
			if (item.kind === 'card' && isCardDone(item.card)) count++;
		}
	}
	return count;
}

/**
 * Archive every completed card on the board in one edit, in document order, as
 * a block at the top of the archive — so their relative order survives (§5.2).
 * Cards under collapsed stacks and dividers are included; a completed card that
 * is untitled leaves the board without being written to the archive.
 */
export function archiveCompletedCards(board: Board, opts: ArchiveOpts): Board {
	const lines: string[] = [];
	let next = board;
	let removed = 0;
	board.stacks.forEach((stack, i) => {
		const done = stack.items.filter((item) => item.kind === 'card' && isCardDone(item.card));
		if (!done.length) return;
		removed += done.length;
		lines.push(...archiveLines(done, stack, board.config, opts));
		next = withItems(
			next,
			i,
			stack.items.filter((item) => !done.includes(item)),
		);
	});
	if (!removed) return board;
	return lines.length
		? { ...next, archive: prependToArchive(next.archive, lines, opts.limit) }
		: next;
}

/** The archive as cards. Parses on every call — nothing caches it (§4). */
export function archivedCards(board: Board): ArchivedCard[] {
	return board.archive ? parseArchive(board.archive.body, board.config) : [];
}

/** The board with `cards` as its archive body, keeping the section's heading. */
function withArchivedCards(board: Board, cards: ArchivedCard[]): Board {
	const archive = board.archive;
	if (!archive) return board;
	return { ...board, archive: { ...archive, body: serializeArchive(cards, board.config) } };
}

/** Index of the stack an archived card is restored into, or -1 for "none yet". */
function restoreTargetIndex(board: Board, entry: ArchivedCard): number {
	const named = entry.from === undefined ? -1 : board.stacks.findIndex((s) => s.name === entry.from);
	if (named !== -1) return named;
	return board.stacks.length ? 0 : -1;
}

/**
 * The stack an archived card would be restored into (§5.3), or `undefined` when
 * one would have to be created for it. Exported so a caller can resolve the
 * insert position against the very stack the op will pick
 * (kanban-view.md §6.7) instead of guessing at it.
 */
export function restoreTarget(board: Board, entry: ArchivedCard): Stack | undefined {
	const index = restoreTargetIndex(board, entry);
	return index === -1 ? undefined : board.stacks[index];
}

/**
 * Put an archived card back on the board (§5.3): into the stack named by its
 * origin, else the first stack, else a stack created for it. `at` says where in
 * that stack it lands (§6.7); it comes back exactly as it went in.
 */
export function restoreCard(board: Board, index: number, at: InsertPos = null): Board {
	const cards = archivedCards(board);
	const entry = cards[index];
	if (!entry) return board;

	const rest = cards.slice();
	rest.splice(index, 1);
	let next = withArchivedCards(board, rest);

	let target = restoreTargetIndex(next, entry);
	if (target === -1) {
		next = addStack(next, entry.from ?? 'Restored');
		target = next.stacks.length - 1;
	}
	const stack = next.stacks[target]!;
	const card = enteringCard(entry.card, stack);
	const items = stack.items.slice();
	items.splice(at === null ? items.length : Math.max(0, Math.min(at, items.length)), 0, {
		kind: 'card' as const,
		card,
	});
	return withItems(next, target, items);
}

/** Destroy one archived card (§5.4). Confirmed by the modal, not here. */
export function deleteArchived(board: Board, index: number): Board {
	const cards = archivedCards(board);
	if (!cards[index]) return board;
	const rest = cards.slice();
	rest.splice(index, 1);
	return withArchivedCards(board, rest);
}

/** Destroy every archived card; the (now empty) section stays (§5.4). */
export function clearArchive(board: Board): Board {
	if (!board.archive || !archivedCards(board).length) return board;
	return { ...board, archive: { ...board.archive, body: '' } };
}

// --- board configuration ----------------------------------------------------

/**
 * Replace the board configuration. Serialization is what writes it back into
 * the `extraboard-settings` block, so this is a plain field swap.
 *
 * Existing cards are deliberately left alone: a value that no longer validates
 * under the new definition keeps its text until the user edits that card
 * (kanban-view.md §5.4).
 */
export function setBoardConfig(board: Board, config: BoardConfig): Board {
	return { ...board, config };
}

// --- view operations --------------------------------------------------------
// Spec: views.md §2.4. Each one goes through `setBoardConfig`, so a view change
// travels the same path as any other config edit.

function withViews(board: Board, views: ViewDef[], activeView?: string): Board {
	const active = activeView ?? board.config.activeView;
	return setBoardConfig(board, {
		...board.config,
		views,
		activeView: views.some((v) => v.id === active) ? active : (views[0]?.id ?? active),
	});
}

/** Make `id` the active view; unknown ids and the current one change nothing. */
export function setActiveView(board: Board, id: string): Board {
	if (board.config.activeView === id) return board;
	if (!board.config.views.some((v) => v.id === id)) return board;
	return setBoardConfig(board, { ...board.config, activeView: id });
}

/** Activate the next view in list order, wrapping (the `next-view` command). */
export function nextView(board: Board): Board {
	const views = board.config.views;
	if (views.length < 2) return board;
	const at = views.findIndex((v) => v.id === board.config.activeView);
	const next = views[(at + 1) % views.length];
	return next ? setActiveView(board, next.id) : board;
}

/** A view as a caller describes it — the id is the op's business. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type NewView = WithoutId<ViewDef>;

/** Append a view; the id is assigned here, so callers never invent one. */
export function addView(board: Board, def: NewView, activate = true): Board {
	const id = nextViewId(board.config.views);
	const view: ViewDef = { ...def, id };
	const views = [...board.config.views, view];
	return withViews(board, views, activate ? id : board.config.activeView);
}

/**
 * Patch a view's editable fields. The type is not among them: changing it would
 * discard the view's configuration, so the modal offers delete-and-create
 * instead (views.md §4.2).
 */
export function updateView(
	board: Board,
	id: string,
	patch: {
		name?: string;
		/** Replaces the calendar's whole list; an empty one is ignored. */
		dateProperties?: string[];
		mode?: CalendarMode;
		controls?: ListControls;
		groupBy?: ListGroupBy;
	},
): Board {
	const at = board.config.views.findIndex((v) => v.id === id);
	const view = board.config.views[at];
	if (!view) return board;

	const name = patch.name?.trim();
	let next: ViewDef = name && name !== view.name ? { ...view, name } : view;
	if (next.type === 'calendar') {
		const properties = cleanNames(patch.dateProperties);
		// A calendar with no property is not a view, so an empty list is a no-op
		// rather than a way to break one (views.md §4.3).
		if (properties && !sameNames(properties, next.dateProperties)) {
			next = { ...next, dateProperties: properties };
		}
		if (patch.mode && patch.mode !== next.mode) next = { ...next, mode: patch.mode };
	}
	if (next.type === 'list' && patch.controls && patch.controls !== next.controls) {
		next = { ...next, controls: patch.controls };
	}
	if (next.type === 'list' && patch.groupBy && patch.groupBy !== next.groupBy) {
		next = { ...next, groupBy: patch.groupBy };
	}
	if (next === view) return board;

	const views = board.config.views.slice();
	views[at] = next;
	return withViews(board, views);
}

/**
 * Patch what a view draws on its cards (views.md §5). Defaults are pruned, so
 * turning everything back on leaves the view exactly as it was written before
 * anyone touched the quick settings.
 */
export function setViewDisplay(board: Board, id: string, patch: Partial<ViewDisplay>): Board {
	const at = board.config.views.findIndex((v) => v.id === id);
	const view = board.config.views[at];
	if (!view) return board;

	const merged: ViewDisplay = { ...view.display, ...patch };
	if (!merged.hiddenProperties?.length) delete merged.hiddenProperties;
	if (!merged.hideTags) delete merged.hideTags;
	if (!merged.hideCheckbox) delete merged.hideCheckbox;
	if (!merged.hideProgress) delete merged.hideProgress;
	if (!merged.hideColor) delete merged.hideColor;

	const display = Object.keys(merged).length ? merged : undefined;
	if (sameDisplay(view.display, display)) return board;

	let next: ViewDef;
	if (display) next = { ...view, display };
	else {
		const { display: _dropped, ...rest } = view;
		next = rest;
	}
	const views = board.config.views.slice();
	views[at] = next;
	return withViews(board, views);
}

function sameDisplay(a: ViewDisplay | undefined, b: ViewDisplay | undefined): boolean {
	if (!a || !b) return a === b;
	return (
		a.hideTags === b.hideTags &&
		a.hideCheckbox === b.hideCheckbox &&
		a.hideProgress === b.hideProgress &&
		a.hideColor === b.hideColor &&
		sameNames(a.hiddenProperties ?? [], b.hiddenProperties ?? [])
	);
}

/** Trimmed, de-duplicated names, or `undefined` when there is nothing to set. */
function cleanNames(names: string[] | undefined): string[] | undefined {
	if (!names) return undefined;
	const out: string[] = [];
	for (const raw of names) {
		const name = raw.trim();
		if (name && !out.includes(name)) out.push(name);
	}
	return out.length ? out : undefined;
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((name, i) => name === b[i]);
}

type ListView = Extract<ViewDef, { type: 'list' }>;

/**
 * Set a list view's filter (filters-and-sorting.md §1). A tree with no
 * conditions left in it drops the key altogether, so clearing a filter leaves
 * the view exactly as it was written before one existed.
 */
export function setViewFilter(board: Board, id: string, filter: FilterNode | null): Board {
	const at = board.config.views.findIndex((v) => v.id === id);
	const view = board.config.views[at];
	if (view?.type !== 'list') return board;

	const next = filter && !isEmptyFilter(filter) ? filter : null;
	if (JSON.stringify(view.filter ?? null) === JSON.stringify(next)) return board;

	let updated: ListView;
	if (next) updated = { ...view, filter: next };
	else {
		const { filter: _dropped, ...rest } = view;
		updated = rest;
	}
	const views = board.config.views.slice();
	views[at] = updated;
	return withViews(board, views);
}

/** Set a list view's sort keys, most significant first; an empty list clears them. */
export function setViewSorts(board: Board, id: string, sorts: readonly SortRule[]): Board {
	const at = board.config.views.findIndex((v) => v.id === id);
	const view = board.config.views[at];
	if (view?.type !== 'list') return board;

	const next = sorts.length ? sorts.map((rule) => ({ ...rule })) : null;
	if (JSON.stringify(view.sorts ?? null) === JSON.stringify(next)) return board;

	let updated: ListView;
	if (next) updated = { ...view, sorts: next };
	else {
		const { sorts: _dropped, ...rest } = view;
		updated = rest;
	}
	const views = board.config.views.slice();
	views[at] = updated;
	return withViews(board, views);
}

/**
 * Write one list section's display state into the view definition
 * (list-view.md §3.4, §5). The caller decides whether the mode wants it
 * persisted at all — a `session` view keeps its state in the component instead
 * and never comes here.
 *
 * An entry naming a section that no longer exists is deliberately **kept**: the
 * section returns as soon as a card is put in it, and its sort returns with it.
 */
export function setSectionState(
	board: Board,
	viewId: string,
	key: string,
	patch: Partial<SectionState>,
): Board {
	const at = board.config.views.findIndex((v) => v.id === viewId);
	const view = board.config.views[at];
	if (view?.type !== 'list') return board;

	const current = view.sections?.[key] ?? {};
	const merged: SectionState = { ...current, ...patch };
	// Prune what is at its default, so an untouched section writes nothing.
	if (!merged.collapsed) delete merged.collapsed;

	const sections = { ...view.sections };
	if (Object.keys(merged).length) sections[key] = merged;
	else delete sections[key];
	if (sameSections(view.sections ?? {}, sections)) return board;

	const next: ListView = Object.keys(sections).length
		? { ...view, sections }
		: (() => {
				const { sections: _dropped, ...rest } = view;
				return rest;
			})();
	const views = board.config.views.slice();
	views[at] = next;
	return withViews(board, views);
}

function sameSections(a: Record<string, SectionState>, b: Record<string, SectionState>): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	// Collapse is all a section state holds now (filters-and-sorting.md §1).
	return keys.every((key) => a[key]?.collapsed === b[key]?.collapsed);
}

/**
 * Delete a view. The last one is never deleted — a board without a view has
 * nothing to render (views.md §4.1) — and deleting the active view falls back
 * to the first survivor.
 */
export function deleteView(board: Board, id: string): Board {
	if (board.config.views.length <= 1) return board;
	const views = board.config.views.filter((v) => v.id !== id);
	if (views.length === board.config.views.length) return board;
	return withViews(board, views);
}

/** Reorder a view; `before` is resolved by identity like every other move. */
export function moveView(board: Board, id: string, before: InsertPos): Board {
	const views = board.config.views.slice();
	const from = views.findIndex((v) => v.id === id);
	if (from === -1) return board;
	const target = before === null ? undefined : views[before];
	const [moved] = views.splice(from, 1);
	if (!moved) return board;
	const at = resolveIndex(views, target);
	views.splice(at, 0, moved);
	if (views.every((v, i) => v === board.config.views[i])) return board;
	return withViews(board, views);
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
