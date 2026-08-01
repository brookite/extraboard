// The tag universe a filter offers. Spec: docs/specs/filters-and-sorting.md §3.
// Pure; no `obsidian` imports.
//
// What is left of the M13 module: sorting and filtering moved to `sort.ts` and
// `filter.ts` when they stopped being per-section and stopped being about dates
// alone. It stays split from `sections.ts`, which knows the section *structure*
// and must not depend on `ops`.

import type { ItemRef } from './ops';
import { sectionsOf, type Section } from './sections';
import type { Board, Card } from './types';

function cardAt(board: Board, ref: ItemRef): Card | undefined {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'card' ? entry.card : undefined;
}

/** Every tag used by the cards of `refs`, sorted — what a filter menu offers. */
export function tagsOf(board: Board, refs: ItemRef[]): string[] {
	const seen = new Set<string>();
	for (const ref of refs) {
		for (const tag of cardAt(board, ref)?.tags ?? []) seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Named sections offered by a ListView card's move submenu. */
export function sectionMoveTargets(board: Board, _ref: ItemRef): Section[] {
	return sectionsOf(board).filter(
		(section): section is Section & { key: { kind: 'named'; name: string } } =>
			section.key.kind === 'named',
	);
}

/**
 * True when a stack boundary belongs between `rows[index - 1]` and
 * `rows[index]` — only meaningful in document order (list-view.md §4.3),
 * where a drag between rows of different stacks cannot actually carry a card
 * across it: it snaps back to the nearest row of its own stack.
 */
export function isStackBoundary(rows: ItemRef[], index: number, ordered: boolean): boolean {
	if (!ordered || index <= 0) return false;
	return rows[index - 1]?.stack !== rows[index]?.stack;
}
