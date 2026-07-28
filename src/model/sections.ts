// Reading a board as sections rather than as stacks — the list view's model.
// Spec: docs/specs/list-view.md §1. Pure; no `obsidian` imports.
//
// A section *is* a divider: `### name` gathered across every stack (one
// section), `---` standing alone (one section per divider), and everything
// before a stack's first divider (the sectionless group, one per board).

import type { ItemRef } from './ops';
import type { Board, Stack } from './types';

/**
 * What identifies a section. `named` merges across stacks and is the only kind
 * that survives a rename; `anon` is one divider, addressed by where it sits, so
 * it is only valid against the board it was computed from.
 */
export type SectionKey =
	| { kind: 'none' }
	| { kind: 'named'; name: string }
	| { kind: 'anon'; ref: ItemRef };

export interface Section {
	key: SectionKey;
	/** The user's label: the divider name, or `''` for the two nameless kinds. */
	name: string;
	/** Every divider behind this section, in board order; empty for `none`. */
	dividers: ItemRef[];
	/** Every card in it, in board order (stack by stack, top to bottom). */
	cards: ItemRef[];
	/** Only a named section can be reordered (list-view.md §1.3, §1.4). */
	movable: boolean;
}

export function sameKey(a: SectionKey, b: SectionKey): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'named' && b.kind === 'named') return a.name === b.name;
	if (a.kind === 'anon' && b.kind === 'anon') {
		return a.ref.stack === b.ref.stack && a.ref.item === b.ref.item;
	}
	return true;
}

/** The divider name as a section is keyed by it: trimmed, case kept. */
export function sectionName(name: string | undefined): string {
	return (name ?? '').trim();
}

/**
 * The key under which a section's display state is stored in the view
 * definition (list-view.md §5): the empty string for the sectionless group, the
 * name for a named section — and `null` for an anonymous one, which has no
 * stable key and therefore no persisted state (§1.4).
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
			if (!name) {
				current = {
					key: { kind: 'anon', ref },
					name: '',
					dividers: [ref],
					cards: [],
					movable: false,
				};
				sections.push(current);
				return;
			}
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

/** Named sections in list order — what a move is expressed against (§4.1). */
export function sectionOrder(board: Board): string[] {
	return sectionsOf(board)
		.filter((section) => section.key.kind === 'named')
		.map((section) => section.name);
}

/** The section a card belongs to, by walking back to the divider above it. */
export function sectionOf(board: Board, ref: ItemRef): SectionKey {
	const stack = board.stacks[ref.stack];
	if (!stack) return { kind: 'none' };
	for (let i = ref.item - 1; i >= 0; i--) {
		const entry = stack.items[i];
		if (entry?.kind !== 'divider') continue;
		const name = sectionName(entry.divider.name);
		return name ? { kind: 'named', name } : { kind: 'anon', ref: { stack: ref.stack, item: i } };
	}
	return { kind: 'none' };
}

/** Index of the divider named `name` in this stack, or -1 when it has none. */
export function dividerIndex(stack: Stack, name: string): number {
	return stack.items.findIndex(
		(entry) => entry.kind === 'divider' && sectionName(entry.divider.name) === name,
	);
}

/**
 * The half-open range of items a group covers: the items after the divider at
 * `at` (or from the top for the head group, `at === null`) up to the next
 * divider or the end of the stack. The divider itself is **not** in the range.
 */
export function groupRange(stack: Stack, at: number | null): { start: number; end: number } {
	const start = at === null ? 0 : at + 1;
	let end = start;
	while (end < stack.items.length && stack.items[end]?.kind !== 'divider') end++;
	return { start, end };
}
