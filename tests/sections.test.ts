// M13: reading a board as sections (the list view's model).
// Spec: docs/specs/list-view.md §1, §3.

import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/model/parse';
import {
	dividerIndex,
	groupRange,
	sameKey,
	sectionOf,
	sectionOrder,
	sectionsOf,
	stateKeyOf,
	type Section,
} from '../src/model/sections';
import { filterCards, sortCards, sortKey, tagsOf } from '../src/model/sectionView';
import type { Board, Card } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead({ properties: [{ name: 'due', type: 'datetime' }] });

/**
 * Three stacks that between them exercise every shape §1 names: cards with no
 * section, a section in two stacks, a section in one, an anonymous divider, and
 * a stack whose sections appear in a different order from the first stack's.
 */
const BOARD = [
	FM,
	'## To do',
	'',
	'- Loose A',
	'',
	'### Backlog',
	'',
	'- B1 @{due|2026-08-03}',
	'- B2 @{due|2026-08-01} #bug',
	'',
	'### Review',
	'',
	'- R1 #bug',
	'',
	'## Doing',
	'',
	'- Loose B',
	'',
	'### Review',
	'',
	'- R2 @{due|2026-07-30}',
	'',
	'---',
	'',
	'- Anon card',
	'',
	'## Done',
	'',
	'### Backlog',
	'',
	'- B3',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);
const titles = (b: Board, section: Section): string[] =>
	section.cards.map((ref) => {
		const entry = b.stacks[ref.stack]?.items[ref.item];
		if (entry?.kind !== 'card') throw new Error('not a card');
		return entry.card.title;
	});
const named = (b: Board, name: string): Section => {
	const found = sectionsOf(b).find((s) => s.name === name);
	if (!found) throw new Error(`no section ${name}`);
	return found;
};
const cardAt = (b: Board, stack: number, item: number): Card => {
	const entry = b.stacks[stack]?.items[item];
	if (entry?.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

describe('sections: grouping', () => {
	it('lists the sectionless group first, then sections by first appearance', () => {
		const b = board();
		expect(sectionsOf(b).map((s) => s.key.kind)).toEqual(['none', 'named', 'named', 'anon']);
		expect(sectionOrder(b)).toEqual(['Backlog', 'Review']);
	});

	it('gathers the cards before every stack’s first divider into one group', () => {
		const b = board();
		const none = sectionsOf(b)[0]!;
		expect(none.key.kind).toBe('none');
		expect(titles(b, none)).toEqual(['Loose A', 'Loose B']);
		expect(none.movable).toBe(false);
		expect(none.dividers).toEqual([]);
	});

	it('merges a named section across stacks, in board order', () => {
		const b = board();
		const backlog = named(b, 'Backlog');
		expect(titles(b, backlog)).toEqual(['B1', 'B2', 'B3']);
		expect(backlog.dividers).toEqual([
			{ stack: 0, item: 1 },
			{ stack: 2, item: 0 },
		]);
		expect(backlog.movable).toBe(true);
	});

	it('gives every unnamed divider a section of its own', () => {
		const b = board();
		const anon = sectionsOf(b).find((s) => s.key.kind === 'anon')!;
		expect(anon.dividers).toHaveLength(1);
		expect(titles(b, anon)).toEqual(['Anon card']);
		expect(anon.movable).toBe(false);
		expect(stateKeyOf(anon.key)).toBeNull();
	});

	it('always offers the sectionless group, even when no card is in it', () => {
		const b = parseBoard([FM, '## To do', '', '### Backlog', '', '- B', ''].join('\n'));
		const sections = sectionsOf(b);
		expect(sections[0]!.key.kind).toBe('none');
		expect(sections[0]!.cards).toEqual([]);
	});

	it('reads a board with no dividers at all as one sectionless group', () => {
		const b = parseBoard([FM, '## To do', '', '- A', '- B', '', '## Done', '', '- C', ''].join('\n'));
		const sections = sectionsOf(b);
		expect(sections).toHaveLength(1);
		expect(titles(b, sections[0]!)).toEqual(['A', 'B', 'C']);
	});

	it('reads an empty board as the sectionless group alone', () => {
		const b = parseBoard(FM + '\n');
		expect(sectionsOf(b)).toHaveLength(1);
		expect(sectionOrder(b)).toEqual([]);
	});

	it('lets the first stack holding both settle a conflicting order', () => {
		const b = parseBoard(
			[
				FM,
				'## One',
				'',
				'### B',
				'',
				'- x',
				'',
				'### A',
				'',
				'- y',
				'',
				'## Two',
				'',
				'### A',
				'',
				'- z',
				'',
				'### B',
				'',
				'- w',
				'',
			].join('\n'),
		);
		expect(sectionOrder(b)).toEqual(['B', 'A']);
	});

	it('treats names case-sensitively and trims them', () => {
		const b = parseBoard(
			[FM, '## S', '', '### Backlog', '', '- a', '', '### backlog', '', '- b', ''].join('\n'),
		);
		expect(sectionOrder(b)).toEqual(['Backlog', 'backlog']);
	});
});

describe('sections: addressing', () => {
	it('names the section a card belongs to', () => {
		const b = board();
		expect(sectionOf(b, { stack: 0, item: 0 })).toEqual({ kind: 'none' });
		expect(sectionOf(b, { stack: 0, item: 2 })).toEqual({ kind: 'named', name: 'Backlog' });
		expect(sectionOf(b, { stack: 1, item: 4 })).toEqual({ kind: 'anon', ref: { stack: 1, item: 3 } });
	});

	it('compares keys by kind, name and position', () => {
		expect(sameKey({ kind: 'none' }, { kind: 'none' })).toBe(true);
		expect(sameKey({ kind: 'named', name: 'a' }, { kind: 'named', name: 'b' })).toBe(false);
		expect(
			sameKey({ kind: 'anon', ref: { stack: 1, item: 3 } }, { kind: 'anon', ref: { stack: 1, item: 3 } }),
		).toBe(true);
		expect(sameKey({ kind: 'none' }, { kind: 'named', name: '' })).toBe(false);
	});

	it('finds a divider by name and bounds its group', () => {
		const b = board();
		const stack = b.stacks[0]!;
		expect(dividerIndex(stack, 'Review')).toBe(4);
		expect(dividerIndex(stack, 'Absent')).toBe(-1);
		expect(groupRange(stack, null)).toEqual({ start: 0, end: 1 });
		expect(groupRange(stack, 1)).toEqual({ start: 2, end: 4 });
		expect(groupRange(stack, 4)).toEqual({ start: 5, end: 6 });
	});

	it('keys state by name, by the empty string, and not at all for anonymous', () => {
		expect(stateKeyOf({ kind: 'none' })).toBe('');
		expect(stateKeyOf({ kind: 'named', name: 'Backlog' })).toBe('Backlog');
		expect(stateKeyOf({ kind: 'anon', ref: { stack: 0, item: 0 } })).toBeNull();
	});
});

describe('sections: sort', () => {
	const sorted = (b: Board, dir: 'asc' | 'desc'): string[] => {
		const section = named(b, 'Backlog');
		return sortCards(b, section.cards, { property: 'due', dir }).map(
			(ref) => cardAt(b, ref.stack, ref.item).title,
		);
	};

	it('leaves document order alone without a sort', () => {
		const b = board();
		const section = named(b, 'Backlog');
		expect(sortCards(b, section.cards, undefined)).toBe(section.cards);
	});

	it('sorts ascending, undated last', () => {
		expect(sorted(board(), 'asc')).toEqual(['B2', 'B1', 'B3']);
	});

	it('keeps undated cards last when the direction flips', () => {
		expect(sorted(board(), 'desc')).toEqual(['B1', 'B2', 'B3']);
	});

	it('is stable for equal keys', () => {
		const b = parseBoard(
			[
				FM,
				'## S',
				'',
				'- one @{due|2026-08-01}',
				'- two @{due|2026-08-01}',
				'- three @{due|2026-08-01}',
				'',
			].join('\n'),
		);
		const refs = sectionsOf(b)[0]!.cards;
		expect(sortCards(b, refs, { property: 'due', dir: 'asc' }).map((r) => cardAt(b, r.stack, r.item).title)).toEqual(
			['one', 'two', 'three'],
		);
	});

	it('takes the earliest element of a date-list and the start of a range', () => {
		const head = boardHead({
			properties: [
				{ name: 'days', type: 'date-list' },
				{ name: 'span', type: 'date-range' },
			],
		});
		const b = parseBoard(
			[head, '## S', '', '- list @{days|2026-09-05; 2026-08-02}', '- range @{span|2026-08-10 → 2026-08-20}', ''].join(
				'\n',
			),
		);
		expect(sortKey(cardAt(b, 0, 0), 'days')).toEqual({ y: 2026, m: 8, d: 2 });
		expect(sortKey(cardAt(b, 0, 1), 'span')).toEqual({ y: 2026, m: 8, d: 10 });
	});

	it('has no key for a value that is not a date, and none for a missing property', () => {
		const head = boardHead({ properties: [{ name: 'note', type: 'string' }] });
		const b = parseBoard([head, '## S', '', '- a @{note|hello}', '- b', ''].join('\n'));
		expect(sortKey(cardAt(b, 0, 0), 'note')).toBeUndefined();
		expect(sortKey(cardAt(b, 0, 1), 'due')).toBeUndefined();
	});
});

describe('sections: filter', () => {
	it('shows a card carrying any of the tags', () => {
		const b = board();
		const backlog = named(b, 'Backlog');
		expect(filterCards(b, backlog.cards, ['bug']).map((r) => cardAt(b, r.stack, r.item).title)).toEqual(['B2']);
	});

	it('filters nothing with an empty or absent tag list', () => {
		const b = board();
		const backlog = named(b, 'Backlog');
		expect(filterCards(b, backlog.cards, [])).toBe(backlog.cards);
		expect(filterCards(b, backlog.cards, undefined)).toBe(backlog.cards);
	});

	it('collects the tags a section actually uses', () => {
		const b = board();
		expect(tagsOf(b, named(b, 'Backlog').cards)).toEqual(['bug']);
		expect(tagsOf(b, sectionsOf(b)[0]!.cards)).toEqual([]);
	});
});
