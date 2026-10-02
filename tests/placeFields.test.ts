// The `@stack` and `@section` filter fields. Spec:
// docs/specs/digest-and-reminders.md §7, filters-and-sorting.md §2.2.

import { describe, it, expect } from 'vitest';
import { configToPlain, toConfig } from '../src/model/boardSettings';
import { filterCards, type FilterNode } from '../src/model/filter';
import { OPS_BY_KIND } from '../src/model/filterOps';
import { fieldKind, readField, type FieldCtx } from '../src/model/fieldValue';
import { parseBoard } from '../src/model/parse';
import { boardNames, placesOf } from '../src/model/sections';
import { sortCards } from '../src/model/sort';
import type { Board, Card } from '../src/model/types';
import { toFieldRef } from '../src/model/views';
import { boardHead } from './boardFile';

const board: Board = parseBoard(
	[
		boardHead(),
		'',
		'## To do',
		'',
		'- Loose',
		'',
		'### Frontend',
		'',
		'- Button',
		'',
		'---',
		'',
		'- Nested under a rule',
		'',
		'## Done',
		'',
		'---',
		'',
		'- Under a plain rule',
		'',
		'### Frontend',
		'',
		'- Header',
		'',
	].join('\n'),
);

const refs = board.stacks.flatMap((stack, s) =>
	stack.items.flatMap((entry, item) => (entry.kind === 'card' ? [{ stack: s, item }] : [])),
);

const cardAt = (index: number): Card => {
	const ref = refs[index]!;
	const entry = board.stacks[ref.stack]!.items[ref.item]!;
	if (entry.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

const ctx: FieldCtx = { config: board.config, today: { y: 2026, m: 10, d: 2 }, where: placesOf(board) };
const titles = (list: typeof refs): string[] => list.map((ref) => {
	const entry = board.stacks[ref.stack]!.items[ref.item]!;
	return entry.kind === 'card' ? entry.card.title : '';
});

const condition = (field: string, op: string, value?: string): FilterNode => ({
	kind: 'group',
	op: 'and',
	children: [
		{ kind: 'condition', field: toFieldRef(field)!, op: op as 'equals', ...(value !== undefined && { value }) },
	],
});

describe('@stack and @section', () => {
	it('read the card\'s stack and its named section past a `---`', () => {
		expect(readField(cardAt(0), { kind: 'builtin', id: 'stack' }, ctx)).toEqual({ kind: 'text', text: 'To do' });
		expect(readField(cardAt(0), { kind: 'builtin', id: 'section' }, ctx)).toEqual({ kind: 'none' });
		expect(readField(cardAt(2), { kind: 'builtin', id: 'section' }, ctx)).toEqual({
			kind: 'text',
			text: 'Frontend',
		});
		// A plain rule is not a named section.
		expect(readField(cardAt(3), { kind: 'builtin', id: 'section' }, ctx)).toEqual({ kind: 'none' });
	});

	it('are unanswered without a place reader', () => {
		const bare: FieldCtx = { config: board.config, today: ctx.today };
		expect(readField(cardAt(0), { kind: 'builtin', id: 'stack' }, bare)).toEqual({ kind: 'none' });
	});

	it('are choice fields with equals, contains and is set', () => {
		expect(fieldKind(board.config, { kind: 'builtin', id: 'stack' })).toBe('choice');
		expect(OPS_BY_KIND.choice).toEqual(['equals', 'contains', 'isSet']);
	});

	it('filter by stack and by section', () => {
		expect(titles(filterCards(board, refs, condition('@stack', 'equals', 'done'), ctx))).toEqual([
			'Under a plain rule',
			'Header',
		]);
		expect(titles(filterCards(board, refs, condition('@section', 'equals', 'Frontend'), ctx))).toEqual([
			'Button',
			'Nested under a rule',
			'Header',
		]);
		expect(titles(filterCards(board, refs, condition('@section', 'isSet'), ctx))).toHaveLength(3);
	});

	it('sort by stack name', () => {
		const sorted = sortCards(board, refs, [{ field: { kind: 'builtin', id: 'stack' }, dir: 'desc' }], ctx);
		expect(titles(sorted).slice(0, 3)).toEqual(['Loose', 'Button', 'Nested under a rule']);
	});

	it('round-trip through the settings block', () => {
		const config = toConfig({
			version: 1,
			views: [
				{
					id: 'v1',
					name: 'List',
					type: 'list',
					filter: { op: 'and', children: [{ field: '@section', op: 'equals', value: 'Frontend' }] },
					sorts: [{ field: '@stack', dir: 'asc' }],
				},
			],
		});
		const view = config.views[0]!;
		expect(view.type === 'list' && view.sorts?.[0]?.field).toEqual({ kind: 'builtin', id: 'stack' });
		const plain = configToPlain(config) as { views: Record<string, unknown>[] };
		expect(plain.views[0]!.filter).toEqual({
			op: 'and',
			children: [{ field: '@section', op: 'equals', value: 'Frontend' }],
		});
		expect(plain.views[0]!.sorts).toEqual([{ field: '@stack', dir: 'asc' }]);
	});

	it('lists the board\'s stack and section names once each', () => {
		expect(boardNames(board)).toEqual({ stacks: ['To do', 'Done'], sections: ['Frontend'] });
	});
});
