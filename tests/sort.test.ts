// Sorting a list by any number of keys. Spec: docs/specs/filters-and-sorting.md §6.

import { describe, it, expect } from 'vitest';
import type { FieldCtx, FieldRef } from '../src/model/fieldValue';
import { sortCards, type SortRule } from '../src/model/sort';
import { parseBoard } from '../src/model/parse';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead({
	views: [{ id: 'v1', name: 'List', type: 'list' }],
	properties: [
		{ name: 'due', type: 'datetime' },
		{ name: 'days', type: 'date-list' },
		{ name: 'sprint', type: 'date-range' },
		{ name: 'points', type: 'integer' },
		{ name: 'owner', type: 'string' },
		{ name: 'urgent', type: 'checkbox' },
	],
});

const board = (...cards: string[]): Board =>
	parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const TODAY = { y: 2026, m: 8, d: 1 };
const ctxOf = (b: Board): FieldCtx => ({ config: b.config, today: TODAY });

const property = (name: string): SortRule['field'] => ({ kind: 'property', name });
const builtin = (id: 'title' | 'tags' | 'done' | 'note'): FieldRef => ({ kind: 'builtin', id });

/** Titles in the order the rules put them. */
function order(b: Board, ...sorts: SortRule[]): string[] {
	const refs = (b.stacks[0]?.items ?? []).map((_, item) => ({ stack: 0, item }));
	return sortCards(b, refs, sorts, ctxOf(b)).map((ref) => {
		const entry = b.stacks[0]?.items[ref.item];
		return entry?.kind === 'card' ? entry.card.title : '';
	});
}

describe('sorting: one key (§6.1)', () => {
	it('sorts dates earliest first, and flips with the direction', () => {
		const b = board('- C @{due|2026-08-10}', '- A @{due|2026-08-01}', '- B @{due|2026-08-05}');
		expect(order(b, { field: property('due'), dir: 'asc' })).toEqual(['A', 'B', 'C']);
		expect(order(b, { field: property('due'), dir: 'desc' })).toEqual(['C', 'B', 'A']);
	});

	it('takes the earliest element of a date list', () => {
		const b = board('- late @{days|2026-09-01; 2026-08-20}', '- early @{days|2026-08-25}');
		expect(order(b, { field: property('days'), dir: 'asc' })).toEqual(['late', 'early']);
	});

	it('takes a range by where it starts, not by where it ends', () => {
		// "short" ends first but starts later, so it sorts after "long".
		const b = board('- short @{sprint|2026-08-10 → 2026-08-12}', '- long @{sprint|2026-08-05 → 2026-08-30}');
		expect(order(b, { field: property('sprint'), dir: 'asc' })).toEqual(['long', 'short']);
	});

	it('sorts numbers numerically', () => {
		const b = board('- ten @{points|10}', '- two @{points|2}');
		expect(order(b, { field: property('points'), dir: 'asc' })).toEqual(['two', 'ten']);
	});

	it('sorts text and the card’s own title alphabetically', () => {
		const b = board('- b @{owner|Bob}', '- a @{owner|Ann}');
		expect(order(b, { field: property('owner'), dir: 'asc' })).toEqual(['a', 'b']);
		expect(order(b, { field: builtin('title'), dir: 'desc' })).toEqual(['b', 'a']);
	});

	it('sorts a checkbox false first, and the card’s own last', () => {
		const b = board('- [x] done', '- [ ] open');
		expect(order(b, { field: builtin('done'), dir: 'asc' })).toEqual(['open', 'done']);
		expect(order(b, { field: builtin('done'), dir: 'desc' })).toEqual(['done', 'open']);
	});
});

describe('sorting: missing values and stability (§6.2)', () => {
	it('puts cards with nothing there last in both directions', () => {
		const b = board('- has @{due|2026-08-10}', '- none', '- also @{due|2026-08-01}');
		expect(order(b, { field: property('due'), dir: 'asc' })).toEqual(['also', 'has', 'none']);
		expect(order(b, { field: property('due'), dir: 'desc' })).toEqual(['has', 'also', 'none']);
	});

	it('keeps document order for equal keys', () => {
		const b = board('- one @{due|2026-08-01}', '- two @{due|2026-08-01}', '- three @{due|2026-08-01}');
		expect(order(b, { field: property('due'), dir: 'asc' })).toEqual(['one', 'two', 'three']);
	});

	it('returns the very same array without rules', () => {
		const b = board('- one', '- two');
		const refs = [{ stack: 0, item: 0 }];
		expect(sortCards(b, refs, [], ctxOf(b))).toBe(refs);
		expect(sortCards(b, refs, undefined, ctxOf(b))).toBe(refs);
	});
});

describe('sorting: several keys (§6.1)', () => {
	it('breaks a tie with the next key', () => {
		const b = board(
			'- b @{points|1} @{owner|Bob}',
			'- a @{points|1} @{owner|Ann}',
			'- c @{points|0} @{owner|Cid}',
		);
		expect(
			order(b, { field: property('points'), dir: 'asc' }, { field: property('owner'), dir: 'asc' }),
		).toEqual(['c', 'a', 'b']);
	});

	it('each key carries its own direction', () => {
		const b = board(
			'- b @{points|1} @{owner|Bob}',
			'- a @{points|1} @{owner|Ann}',
			'- c @{points|0} @{owner|Cid}',
		);
		expect(
			order(b, { field: property('points'), dir: 'desc' }, { field: property('owner'), dir: 'desc' }),
		).toEqual(['b', 'a', 'c']);
	});

	it('a card missing the first key goes last, whatever the second says', () => {
		const b = board('- has @{points|5} @{owner|Zed}', '- none @{owner|Ann}');
		expect(
			order(b, { field: property('points'), dir: 'asc' }, { field: property('owner'), dir: 'asc' }),
		).toEqual(['has', 'none']);
	});
});
