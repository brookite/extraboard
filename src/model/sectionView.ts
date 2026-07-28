// Sorting and filtering the cards of a list section.
// Spec: docs/specs/list-view.md §3. Pure; no `obsidian` imports.
//
// Split from `sections.ts` so that module stays free of the date readers: `ops`
// depends on the section *structure*, and `calendar` depends on `ops`, so the
// date half has to live where it cannot close that circle.

import { anchorFor } from './calendar';
import { CalDate, compareDates, parseSpan } from './dates';
import type { ItemRef } from './ops';
import { parseRecurrence } from './recurrence';
import type { Board, Card, PropertyValue, SectionSort } from './types';

/** The raw date strings a property value contributes, in element order. */
function rawDates(pv: PropertyValue | undefined): string[] {
	if (!pv) return [];
	switch (pv.type) {
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return [pv.raw];
		case 'date-list':
			return pv.raw;
		default:
			return [];
	}
}

/**
 * The date a card sorts by: the **earliest** date its value can be read as — a
 * `date-list` therefore sorting by its first element in time and a `recurrence`
 * by its anchor (list-view.md §3.1). `undefined` means "unreadable", which
 * sorts last in both directions.
 */
export function sortKey(card: Card, property: string): CalDate | undefined {
	let best: CalDate | undefined;
	const consider = (date: CalDate | undefined): void => {
		if (date && (!best || compareDates(date, best) < 0)) best = date;
	};
	for (const raw of rawDates(card.properties.find((pv) => pv.name === property))) {
		const span = parseSpan(raw);
		if (span) {
			consider(span.start);
			continue;
		}
		const rule = parseRecurrence(raw);
		if (rule) consider(rule.start ?? anchorFor(card, property));
	}
	return best;
}

function cardAt(board: Board, ref: ItemRef): Card | undefined {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'card' ? entry.card : undefined;
}

/**
 * `refs` in sorted order (list-view.md §3.1). Stable: equal keys keep document
 * order, and a card with no readable date goes last **in both directions**, so
 * flipping the sort never drags the undated cards to the top.
 */
export function sortCards(board: Board, refs: ItemRef[], sort: SectionSort | undefined): ItemRef[] {
	if (!sort) return refs;
	const keyed = refs.map((ref, index) => {
		const card = cardAt(board, ref);
		return { ref, index, key: card ? sortKey(card, sort.property) : undefined };
	});
	const sign = sort.dir === 'desc' ? -1 : 1;
	keyed.sort((a, b) => {
		if (!a.key && !b.key) return a.index - b.index;
		if (!a.key) return 1;
		if (!b.key) return -1;
		return compareDates(a.key, b.key) * sign || a.index - b.index;
	});
	return keyed.map((entry) => entry.ref);
}

/** `refs` filtered to the cards carrying at least one of `tags` (§3.2). */
export function filterCards(board: Board, refs: ItemRef[], tags: string[] | undefined): ItemRef[] {
	if (!tags?.length) return refs;
	return refs.filter((ref) => {
		const card = cardAt(board, ref);
		return card ? card.tags.some((tag) => tags.includes(tag)) : false;
	});
}

/** Every tag used by the cards of `refs`, sorted — what a filter menu offers. */
export function tagsOf(board: Board, refs: ItemRef[]): string[] {
	const seen = new Set<string>();
	for (const ref of refs) {
		for (const tag of cardAt(board, ref)?.tags ?? []) seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}
