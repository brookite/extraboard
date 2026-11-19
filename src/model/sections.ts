// Reading a board as sections rather than as stacks — the list view's model.
// Spec: docs/specs/list-view.md §1. Pure; no `obsidian` imports.
//
// Named dividers define sections across stacks. Cards above the first named
// divider belong to the sectionless group. A plain rule subdivides its stack.

import type { CardPlace } from './fieldValue';
import type { ItemRef } from './ops';
import type { Board, Card, Divider, ListGroupBy, Stack } from './types';

/**
 * What identifies a section. Named sections merge across stacks.
 */
export type SectionKey =
	| { kind: 'none' }
	| { kind: 'named'; name: string }
	| { kind: 'tag'; tag: string | null }
	/**
	 * A whole stack read as one group — what a list grouped by stack shows
	 * (list-view.md §1.0). It is not a divider, so no op that writes one accepts
	 * it; it addresses a stack by index and is only valid against the board it
	 * was computed from.
	 */
	| { kind: 'stack'; index: number };

export interface Section {
	key: SectionKey;
	/** The user's label, or `''` for the sectionless group. */
	name: string;
	/** Every divider behind this section, in board order; empty for `none`. A
	 * named section lists the dividers carrying its name, not the `---` nested
	 * inside it (§1.5). */
	dividers: ItemRef[];
	/** Every card in it, in board order (stack by stack, top to bottom). */
	cards: ItemRef[];
	/** Whether the group can be reordered. */
	movable: boolean;
}

export function sameKey(a: SectionKey, b: SectionKey): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'named' && b.kind === 'named') return a.name === b.name;
	if (a.kind === 'tag' && b.kind === 'tag') return a.tag === b.tag;
	if (a.kind === 'stack' && b.kind === 'stack') return a.index === b.index;
	return true;
}

/** The divider name as a section is keyed by it: trimmed, case kept. */
export function sectionName(name: string | undefined): string {
	return (name ?? '').trim();
}

/** A divider that names a section; only it outranks a `---` (§1.5). */
export function isNamedDivider(divider: Divider): boolean {
	return sectionName(divider.name) !== '';
}

/**
 * Index of the nearest named divider above `index` in the stack, looking past
 * any `---` in between, or -1 when there is none — the divider whose group the
 * item belongs to (§1.5).
 */
export function namedDividerAbove(stack: Stack, index: number): number {
	for (let i = index - 1; i >= 0; i--) {
		const entry = stack.items[i];
		if (entry?.kind === 'divider' && isNamedDivider(entry.divider)) return i;
	}
	return -1;
}

/**
 * The key under which a section's display state is stored in the view
 * definition (list-view.md §5): the empty string for the sectionless group, the
 * name for a named section, or `null` for stack and tag groups.
 */
export function stateKeyOf(key: SectionKey): string | null {
	if (key.kind === 'none') return '';
	if (key.kind === 'named') return key.name;
	return null;
}

/**
 * Every section of a board, in list order: the sectionless group first, then
 * each section in order of first appearance, scanning stacks left to right and
 * each stack top to bottom (list-view.md §1.2).
 *
 * The sectionless group is **always present**, even on a board where every card
 * sits under a divider: it is where a card with no section goes, so the list
 * must offer its composer.
 */
export function sectionsOf(board: Board): Section[] {
	const none: Section = { key: { kind: 'none' }, name: '', dividers: [], cards: [], movable: false };
	const sections: Section[] = [none];
	const byName = new Map<string, Section>();

	board.stacks.forEach((stack, s) => {
		let current = none;
		stack.items.forEach((entry, i) => {
			const ref: ItemRef = { stack: s, item: i };
			if (entry.kind === 'card') {
				current.cards.push(ref);
				return;
			}
			const name = sectionName(entry.divider.name);
			if (!name) return;
			const existing = byName.get(name);
			if (existing) {
				existing.dividers.push(ref);
				current = existing;
				return;
			}
			current = { key: { kind: 'named', name }, name, dividers: [ref], cards: [], movable: true };
			byName.set(name, current);
			sections.push(current);
		});
	});

	return sections;
}

/**
 * Every **stack** of a board as one group each, in board order — the other way
 * a list can be read (list-view.md §1.0). The shape is the section's, so the
 * view draws, drops and collapses both the same way; what differs is that a
 * stack group holds every card of its stack whatever divider it sits under, and
 * that it is backed by a stack rather than by dividers.
 *
 * Every stack is a group, empty ones included: a stack the user can see on the
 * board must be somewhere to drop a card in the list.
 */
export function stackGroupsOf(board: Board): Section[] {
	return board.stacks.map((stack, index) => ({
		key: { kind: 'stack', index },
		name: stack.name,
		dividers: [],
		cards: stack.items.flatMap((entry, item) => (entry.kind === 'card' ? [{ stack: index, item }] : [])),
		movable: true,
	}));
}

/** The groups a list view draws, by what it groups on (list-view.md §1.0). */
export function groupsOf(board: Board, groupBy: ListGroupBy): Section[] {
	if (groupBy === 'none') {
		return [{ key: { kind: 'none' }, name: '', dividers: [], movable: false,
			cards: board.stacks.flatMap((stack, index) => stack.items.flatMap((entry, item) =>
				entry.kind === 'card' ? [{ stack: index, item }] : [],
			)),
		}];
	}
	if (groupBy === 'tag') return tagGroupsOf(board);
	return groupBy === 'stack' ? stackGroupsOf(board) : sectionsOf(board);
}

/** Each card appears once for each of its explicit tags, or under No tags. */
function tagGroupsOf(board: Board): Section[] {
	const groups = new Map<string, Section>();
	const untagged: Section = {
		key: { kind: 'tag', tag: null }, name: '', dividers: [], cards: [], movable: false,
	};
	board.stacks.forEach((stack, s) => {
		stack.items.forEach((entry, item) => {
			if (entry.kind !== 'card') return;
			const ref = { stack: s, item };
			if (entry.card.tags.length === 0) untagged.cards.push(ref);
			for (const tag of new Set(entry.card.tags)) {
				let group = groups.get(tag);
				if (!group) {
					group = { key: { kind: 'tag', tag }, name: tag, dividers: [], cards: [], movable: false };
					groups.set(tag, group);
				}
				group.cards.push(ref);
			}
		});
	});
	const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
	if (untagged.cards.length > 0 || sorted.length === 0) sorted.push(untagged);
	return sorted;
}

/** Named sections in list order — what a move is expressed against (§4.1). */
export function sectionOrder(board: Board): string[] {
	return sectionsOf(board)
		.filter((section) => section.key.kind === 'named')
		.map((section) => section.name);
}

/**
 * The section a card belongs to, by walking back to the divider above it: the
 * nearest named one, past any `---` (§1.5), or the sectionless group.
 */
export function sectionOf(board: Board, ref: ItemRef): SectionKey {
	const stack = board.stacks[ref.stack];
	if (!stack) return { kind: 'none' };
	const entry = stack.items[namedDividerAbove(stack, ref.item)];
	return entry?.kind === 'divider'
		? { kind: 'named', name: sectionName(entry.divider.name) }
		: { kind: 'none' };
}

/** Index of the divider named `name` in this stack, or -1 when it has none. */
export function dividerIndex(stack: Stack, name: string): number {
	return stack.items.findIndex(
		(entry) => entry.kind === 'divider' && sectionName(entry.divider.name) === name,
	);
}

/** End of the list's sectionless group in this stack. */
export function sectionHeadEnd(stack: Stack): number {
	const first = stack.items.findIndex((entry) => entry.kind === 'divider' && isNamedDivider(entry.divider));
	return first === -1 ? stack.items.length : first;
}

/**
 * The half-open range of items a group covers: the items after the divider at
 * `at` (or from the top for the head group, `at === null`) up to the next
 * divider of at least its rank, or the end of the stack. A named divider's
 * group runs to the next named divider. The head group and a plain rule's
 * own run end at any divider. The opening divider is outside the range.
 */
export function groupRange(stack: Stack, at: number | null): { start: number; end: number } {
	const start = at === null ? 0 : at + 1;
	const head = at === null ? undefined : stack.items[at];
	const namedOnly = head?.kind === 'divider' && isNamedDivider(head.divider);
	let end = start;
	for (; end < stack.items.length; end++) {
		const entry = stack.items[end];
		if (entry?.kind === 'divider' && (!namedOnly || isNamedDivider(entry.divider))) break;
	}
	return { start, end };
}

/** One run of a stack as the board draws it: `at` is the named divider heading
 * it (`null` for the sectionless head), `[start, end)` the items under it. */
export interface StackRun {
	at: number | null;
	start: number;
	end: number;
}

/**
 * A stack cut into the runs the board drags as wholes (kanban-view.md §6.4a):
 * the sectionless head — always first, possibly empty — then one run per named
 * divider, each holding its nested `---` (§1.5).
 */
export function stackRuns(stack: Stack): StackRun[] {
	const runs: StackRun[] = [];
	let at: number | null = null;
	for (let i = 0; i <= stack.items.length; i++) {
		const entry = stack.items[i];
		const named = entry?.kind === 'divider' && isNamedDivider(entry.divider);
		if (i < stack.items.length && !named) continue;
		runs.push({ at, start: at === null ? 0 : at + 1, end: i });
		at = i;
	}
	return runs;
}

/**
 * Every card's stack and named section, for the `@stack` / `@section` filter
 * fields (digest-and-reminders.md §7). The index is built on the first question
 * and only then, so a filter that never names either field costs nothing.
 */
export function placesOf(board: Board): (card: Card) => CardPlace | undefined {
	let index: Map<Card, CardPlace> | null = null;
	return (card) => {
		if (!index) {
			const built = new Map<Card, CardPlace>();
			for (const stack of board.stacks) {
				let section = '';
				for (const entry of stack.items) {
					if (entry.kind === 'card') built.set(entry.card, { stack: stack.name, section });
					else if (isNamedDivider(entry.divider)) section = sectionName(entry.divider.name);
				}
			}
			index = built;
		}
		return index.get(card);
	};
}

/** Stack names and named-section names, de-duplicated, in board order. */
export function boardNames(board: Board): { stacks: string[]; sections: string[] } {
	const stacks: string[] = [];
	for (const stack of board.stacks) {
		if (stack.name && !stacks.includes(stack.name)) stacks.push(stack.name);
	}
	const sections = sectionsOf(board)
		.filter((section) => section.key.kind === 'named')
		.map((section) => section.name);
	return { stacks, sections };
}
