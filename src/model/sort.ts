// Sorting a list by any number of fields. Spec: docs/specs/filters-and-sorting.md §6.
// Pure; no `obsidian` imports.

import { compareDates } from './dates';
import { FieldCtx, FieldRef, FieldValue, readField } from './fieldValue';
import type { ItemRef } from './ops';
import type { Board, Card } from './types';

export interface SortRule {
	field: FieldRef;
	dir: 'asc' | 'desc';
}

/**
 * Two values of the same field. A card with nothing there is not "smallest" —
 * it is unanswered, and it goes **last in both directions** (§6.2), so flipping
 * a sort never drags the blanks to the top.
 */
function compareValues(a: FieldValue, b: FieldValue): number {
	if (a.kind === 'none' || b.kind === 'none') return 0;

	if (a.kind === 'date' && b.kind === 'date') {
		// The earliest date a value can be read as is the one it sorts by, which
		// is what makes a `date-list` sort by its first element in time.
		const left = a.spans.reduce<(typeof a.spans)[number] | null>(
			(best, span) => (!best || compareDates(span.start, best.start) < 0 ? span : best),
			null,
		);
		const right = b.spans.reduce<(typeof b.spans)[number] | null>(
			(best, span) => (!best || compareDates(span.start, best.start) < 0 ? span : best),
			null,
		);
		if (!left || !right) return 0;
		return compareDates(left.start, right.start);
	}

	if (a.kind === 'number' && b.kind === 'number') return a.value - b.value;
	if (a.kind === 'bool' && b.kind === 'bool') return Number(a.value) - Number(b.value);

	const text = (value: FieldValue): string => {
		if (value.kind === 'text') return value.text;
		if (value.kind === 'list') return value.values[0] ?? '';
		return '';
	};
	return text(a).localeCompare(text(b));
}

function cardAt(board: Board, ref: ItemRef): Card | undefined {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'card' ? entry.card : undefined;
}

/** True when this card has nothing to say about this field. */
function missing(value: FieldValue): boolean {
	return value.kind === 'none';
}

/**
 * `refs` in the order the rules ask for (§6.1): rule by rule, the first one
 * that separates two cards decides, and document order settles the rest — so
 * the sort is stable and a list never reshuffles under an edit that changed
 * none of its keys.
 */
export function sortCards(
	board: Board,
	refs: ItemRef[],
	sorts: readonly SortRule[] | undefined,
	ctx: FieldCtx,
): ItemRef[] {
	if (!sorts?.length) return refs;

	const keyed = refs.map((ref, index) => {
		const card = cardAt(board, ref);
		return {
			ref,
			index,
			values: sorts.map((rule): FieldValue =>
				card ? readField(card, rule.field, ctx) : { kind: 'none' },
			),
		};
	});

	keyed.sort((a, b) => {
		for (let i = 0; i < sorts.length; i++) {
			const left = a.values[i]!;
			const right = b.values[i]!;
			if (missing(left) !== missing(right)) return missing(left) ? 1 : -1;
			if (missing(left)) continue;
			const order = compareValues(left, right) * (sorts[i]!.dir === 'desc' ? -1 : 1);
			if (order !== 0) return order;
		}
		return a.index - b.index;
	});

	return keyed.map((entry) => entry.ref);
}
