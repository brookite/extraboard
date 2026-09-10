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
	groupsOf,
	stackGroupsOf,
	stateKeyOf,
	type Section,
} from '../src/model/sections';
import { isStackBoundary, sectionMoveTargets, tagsOf } from '../src/model/sectionView';
import { filterCards } from '../src/model/filter';
import { sortCards } from '../src/model/sort';
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

// The other axis the same list can be read along (list-view.md §1.0).
describe('sections: grouping by stack', () => {
	it('gives every stack one group, in board order', () => {
		const b = board();
		const groups = stackGroupsOf(b);
		expect(groups.map((g) => g.key.kind)).toEqual(['stack', 'stack', 'stack']);
		expect(groups.map((g) => g.name)).toEqual(['To do', 'Doing', 'Done']);
	});

	it('holds every card of its stack, whatever divider it sits under', () => {
		const b = board();
		const groups = stackGroupsOf(b);
		expect(titles(b, groups[0]!)).toEqual(['Loose A', 'B1', 'B2', 'R1']);
		expect(titles(b, groups[1]!)).toEqual(['Loose B', 'R2', 'Anon card']);
		expect(titles(b, groups[2]!)).toEqual(['B3']);
	});

	it('carries no dividers and is always movable', () => {
		const b = board();
		for (const group of stackGroupsOf(b)) {
			expect(group.dividers).toEqual([]);
			expect(group.movable).toBe(true);
		}
	});

	it('keeps an empty stack as a group, since a card can still be dropped in it', () => {
		const b = parseBoard([FM, '## Empty', ''].join('\n'));
		expect(stackGroupsOf(b).map((g) => g.cards.length)).toEqual([0]);
	});

	it('stores no per-view state: a stack group’s collapse is the stack’s own flag', () => {
		expect(stateKeyOf({ kind: 'stack', index: 0 })).toBeNull();
	});

	it('compares stack keys by index', () => {
		expect(sameKey({ kind: 'stack', index: 1 }, { kind: 'stack', index: 1 })).toBe(true);
		expect(sameKey({ kind: 'stack', index: 1 }, { kind: 'stack', index: 2 })).toBe(false);
		expect(sameKey({ kind: 'stack', index: 0 }, { kind: 'none' })).toBe(false);
	});

	it('is what `groupsOf` dispatches to', () => {
		const b = board();
		expect(groupsOf(b, 'stack')).toEqual(stackGroupsOf(b));
		expect(groupsOf(b, 'section')).toEqual(sectionsOf(b));
	});
});

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

	it('offers only named sections to the card menu', () => {
		const b = board();
		const targets = sectionMoveTargets(b, { stack: 0, item: 2 });
		expect(
			targets.map((section) =>
				section.key.kind === 'named' ? section.key.name : section.key.kind,
			),
		).toEqual(['Backlog', 'Review']);
	});

	it('never offers anonymous sections, including inside their own stack', () => {
		const b = board();
		const fromOtherStack = sectionMoveTargets(b, { stack: 0, item: 2 });
		const fromAnonymousStack = sectionMoveTargets(b, { stack: 1, item: 4 });
		expect(fromOtherStack.some((section) => section.key.kind === 'anon')).toBe(false);
		expect(fromAnonymousStack.some((section) => section.key.kind === 'anon')).toBe(false);
	});
});

describe('sections: sort', () => {
	const ctx = { config: board().config, today: { y: 2026, m: 8, d: 1 } };
	const by = (property: string, dir: 'asc' | 'desc') => [
		{ field: { kind: 'property' as const, name: property }, dir },
	];
	const sorted = (b: Board, dir: 'asc' | 'desc'): string[] =>
		sortCards(b, named(b, 'Backlog').cards, by('due', dir), { ...ctx, config: b.config }).map(
			(ref) => cardAt(b, ref.stack, ref.item).title,
		);

	it('leaves document order alone without a sort', () => {
		const b = board();
		const section = named(b, 'Backlog');
		expect(sortCards(b, section.cards, undefined, { ...ctx, config: b.config })).toBe(section.cards);
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
		expect(
			sortCards(b, refs, by('due', 'asc'), { ...ctx, config: b.config }).map(
				(r) => cardAt(b, r.stack, r.item).title,
			),
		).toEqual(['one', 'two', 'three']);
	});
});

describe('sections: filter', () => {
	const tagFilter = (...tags: string[]) => ({
		kind: 'group' as const,
		op: 'or' as const,
		children: tags.map((value) => ({
			kind: 'condition' as const,
			field: { kind: 'builtin' as const, id: 'tags' as const },
			op: 'contains' as const,
			value,
		})),
	});

	it('shows a card carrying any of the tags', () => {
		const b = board();
		const backlog = named(b, 'Backlog');
		const ctx = { config: b.config, today: { y: 2026, m: 8, d: 1 } };
		expect(
			filterCards(b, backlog.cards, tagFilter('bug'), ctx).map(
				(r) => cardAt(b, r.stack, r.item).title,
			),
		).toEqual(['B2']);
	});

	it('filters nothing with an empty filter or none at all', () => {
		const b = board();
		const backlog = named(b, 'Backlog');
		const ctx = { config: b.config, today: { y: 2026, m: 8, d: 1 } };
		expect(filterCards(b, backlog.cards, tagFilter(), ctx)).toBe(backlog.cards);
		expect(filterCards(b, backlog.cards, undefined, ctx)).toBe(backlog.cards);
	});

	it('collects the tags a section actually uses', () => {
		const b = board();
		expect(tagsOf(b, named(b, 'Backlog').cards)).toEqual(['bug']);
		expect(tagsOf(b, sectionsOf(b)[0]!.cards)).toEqual([]);
	});
});

describe('sections: stack boundary (list-view.md §4.3)', () => {
	const rows = [
		{ stack: 0, item: 0 },
		{ stack: 0, item: 1 },
		{ stack: 1, item: 0 },
		{ stack: 1, item: 1 },
	];

	it('never marks the first row', () => {
		expect(isStackBoundary(rows, 0, true)).toBe(false);
	});

	it('marks where the stack changes, in document order', () => {
		expect(isStackBoundary(rows, 1, true)).toBe(false);
		expect(isStackBoundary(rows, 2, true)).toBe(true);
		expect(isStackBoundary(rows, 3, true)).toBe(false);
	});

	it('marks nothing once rows are sorted, even across a stack change', () => {
		expect(isStackBoundary(rows, 2, false)).toBe(false);
	});
});
