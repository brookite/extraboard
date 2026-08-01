// The filter tree: every operator against every kind of field, and the way
// groups join their children. Spec: docs/specs/filters-and-sorting.md §3, §4.

import { describe, it, expect } from 'vitest';
import {
	FilterNode,
	countConditions,
	emptyGroup,
	filterCards,
	insertInto,
	isEmptyFilter,
	matchCard,
	moveNode,
	nodeAt,
	removeAt,
	replaceNode,
} from '../src/model/filter';
import { OPS_BY_KIND, defaultOp, editorFor, needsSecondValue, supportsOp } from '../src/model/filterOps';
import { fieldKind, readField, type FieldCtx, type FieldRef } from '../src/model/fieldValue';
import { parseBoard } from '../src/model/parse';
import type { Board, Card } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead({
	views: [{ id: 'v1', name: 'List', type: 'list' }],
	properties: [
		{ name: 'due', type: 'datetime' },
		{ name: 'sprint', type: 'date-range' },
		{ name: 'repeat', type: 'recurrence' },
		{ name: 'points', type: 'integer' },
		{ name: 'progress', type: 'percent' },
		{ name: 'owner', type: 'string' },
		{ name: 'areas', type: 'string-list' },
		{ name: 'urgent', type: 'checkbox' },
	],
});

const board = (...cards: string[]): Board =>
	parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const TODAY = { y: 2026, m: 8, d: 1 };

const cardOf = (b: Board, index = 0): Card => {
	const entry = b.stacks[0]?.items[index];
	if (entry?.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

const ctxOf = (b: Board): FieldCtx => ({ config: b.config, today: TODAY });

/** One condition against one card, written the way a row reads. */
function match(
	line: string,
	field: FieldRef,
	op: FilterNode extends never ? never : Parameters<typeof cond>[1],
	value?: string,
	value2?: string,
): boolean {
	const b = board(line);
	return matchCard(cardOf(b), cond(field, op, value, value2), ctxOf(b));
}

function cond(
	field: FieldRef,
	op: 'equals' | 'contains' | 'between' | 'lt' | 'lte' | 'gt' | 'gte' | 'isSet' | 'linksTo',
	value?: string,
	value2?: string,
): FilterNode {
	return {
		kind: 'condition',
		field,
		op,
		...(value !== undefined && { value }),
		...(value2 !== undefined && { value2 }),
	};
}

const property = (name: string): FieldRef => ({ kind: 'property', name });
const builtin = (id: 'title' | 'tags' | 'done' | 'note'): FieldRef => ({ kind: 'builtin', id });

describe('fields: what a card holds (§2)', () => {
	it('knows the kind of every declared property and of the built-in fields', () => {
		const b = board('- x');
		const kind = (field: FieldRef) => fieldKind(b.config, field);
		expect(kind(property('due'))).toBe('date');
		expect(kind(property('sprint'))).toBe('date');
		expect(kind(property('repeat'))).toBe('date');
		expect(kind(property('points'))).toBe('number');
		expect(kind(property('progress'))).toBe('number');
		expect(kind(property('owner'))).toBe('text');
		expect(kind(property('areas'))).toBe('list');
		expect(kind(property('urgent'))).toBe('bool');
		// An undeclared property is text: that is what an unread token is.
		expect(kind(property('nope'))).toBe('text');
		expect(kind(builtin('title'))).toBe('text');
		expect(kind(builtin('tags'))).toBe('list');
		expect(kind(builtin('done'))).toBe('bool');
		expect(kind(builtin('note'))).toBe('link');
	});

	it('reads the card text without its link, and the link as the note', () => {
		const b = board('- Call [[People/Ann|Ann]] about it #billing');
		const ctx = ctxOf(b);
		// The tag is a field of its own, so the text does not carry it twice.
		expect(readField(cardOf(b), builtin('title'), ctx)).toEqual({
			kind: 'text',
			text: 'Call Ann about it',
		});
		expect(readField(cardOf(b), builtin('note'), ctx)).toEqual({
			kind: 'text',
			text: 'People/Ann',
		});
		expect(readField(cardOf(b), builtin('tags'), ctx)).toEqual({ kind: 'list', values: ['billing'] });
	});

	it('reads a repetition rule as its anchor and its next hit (§2.3)', () => {
		const b = board('- Standup @{repeat|every week on Mon from 2026-07-06}');
		const value = readField(cardOf(b), property('repeat'), ctxOf(b));
		expect(value.kind).toBe('date');
		if (value.kind !== 'date') return;
		expect(value.spans[0]?.start).toEqual({ y: 2026, m: 7, d: 6 });
		expect(value.spans[1]?.start).toEqual({ y: 2026, m: 8, d: 3 });
	});

	it('has nothing to say about a property the card does not carry', () => {
		const b = board('- Bare');
		expect(readField(cardOf(b), property('due'), ctxOf(b))).toEqual({ kind: 'none' });
	});
});

describe('operators: text and lists (§3.1)', () => {
	it('contains is a case-insensitive substring, equals is the whole value', () => {
		expect(match('- Ship it @{owner|Ann Lee}', property('owner'), 'contains', 'ann')).toBe(true);
		expect(match('- Ship it @{owner|Ann Lee}', property('owner'), 'equals', 'ann lee')).toBe(true);
		expect(match('- Ship it @{owner|Ann Lee}', property('owner'), 'equals', 'Ann')).toBe(false);
	});

	it('matches an element of a list, not the joined text', () => {
		expect(match('- x @{areas|api; docs}', property('areas'), 'contains', 'docs')).toBe(true);
		expect(match('- x @{areas|api; docs}', property('areas'), 'contains', 'ui')).toBe(false);
	});

	it('matches a tag without its hash', () => {
		expect(match('- Fix #bug', builtin('tags'), 'contains', 'bug')).toBe(true);
		expect(match('- Fix #bug', builtin('tags'), 'contains', 'ops')).toBe(false);
	});

	it('searches the card text', () => {
		expect(match('- Rewrite the parser', builtin('title'), 'contains', 'parser')).toBe(true);
	});
});

describe('operators: numbers (§3.2)', () => {
	const card = '- Task @{points|5} @{progress|40}';
	it('compares numerically, not as text', () => {
		expect(match(card, property('points'), 'equals', '5')).toBe(true);
		expect(match(card, property('points'), 'lt', '10')).toBe(true);
		expect(match(card, property('points'), 'gt', '10')).toBe(false);
		expect(match(card, property('points'), 'lte', '5')).toBe(true);
		expect(match(card, property('points'), 'gte', '6')).toBe(false);
		expect(match(card, property('progress'), 'between', '30', '50')).toBe(true);
		expect(match(card, property('progress'), 'between', '50', '60')).toBe(false);
	});
});

describe('operators: dates (§3.2)', () => {
	const day = '- Ship @{due|2026-08-10}';
	const range = '- Sprint @{sprint|2026-08-05 → 2026-08-15}';

	it('compares a single date against a bound', () => {
		expect(match(day, property('due'), 'lt', '2026-08-11')).toBe(true);
		expect(match(day, property('due'), 'lt', '2026-08-10')).toBe(false);
		expect(match(day, property('due'), 'lte', '2026-08-10')).toBe(true);
		expect(match(day, property('due'), 'gt', '2026-08-09')).toBe(true);
		expect(match(day, property('due'), 'gte', '2026-08-10')).toBe(true);
	});

	it('between is an overlap, so a range that straddles a bound is caught', () => {
		expect(match(range, property('sprint'), 'between', '2026-08-01', '2026-08-06')).toBe(true);
		expect(match(range, property('sprint'), 'between', '2026-08-14', '2026-08-20')).toBe(true);
		expect(match(range, property('sprint'), 'between', '2026-08-16', '2026-08-20')).toBe(false);
	});

	it('reads a range by its ends: after its end, before its start', () => {
		expect(match(range, property('sprint'), 'gt', '2026-08-14')).toBe(true);
		expect(match(range, property('sprint'), 'lt', '2026-08-06')).toBe(true);
	});

	it('an unparseable date matches nothing rather than everything', () => {
		expect(match('- x @{due|whenever}', property('due'), 'lt', '2026-08-11')).toBe(false);
	});
});

describe('operators: is set and links to (§3.3, §3.4)', () => {
	it('is set means "true" for a checkbox and "has a value" for the rest', () => {
		expect(match('- x @{urgent|true}', property('urgent'), 'isSet')).toBe(true);
		expect(match('- x @{urgent|false}', property('urgent'), 'isSet')).toBe(false);
		expect(match('- x @{owner|Ann}', property('owner'), 'isSet')).toBe(true);
		expect(match('- x', property('owner'), 'isSet')).toBe(false);
		expect(match('- [x] done', builtin('done'), 'isSet')).toBe(true);
		expect(match('- [ ] not done', builtin('done'), 'isSet')).toBe(false);
		expect(match('- [[Note]]', builtin('note'), 'isSet')).toBe(true);
		expect(match('- plain', builtin('note'), 'isSet')).toBe(false);
	});

	it('links to matches by basename or by full path, ignoring the subpath', () => {
		expect(match('- [[People/Ann#Today|Ann]]', builtin('note'), 'linksTo', 'Ann')).toBe(true);
		expect(match('- [[People/Ann]]', builtin('note'), 'linksTo', 'People/Ann')).toBe(true);
		expect(match('- [[People/Ann]]', builtin('note'), 'linksTo', 'ann.md')).toBe(true);
		expect(match('- [[People/Bob]]', builtin('note'), 'linksTo', 'Ann')).toBe(false);
	});

	it('finds a link inside a text property, not only in the title', () => {
		expect(match('- x @{owner|see [[People/Ann]]}', property('owner'), 'linksTo', 'Ann')).toBe(true);
		expect(match('- x @{owner|Ann}', property('owner'), 'linksTo', 'Ann')).toBe(true);
	});
});

describe('groups (§4)', () => {
	const b = board(
		'- One #bug @{points|3}',
		'- Two #ops @{points|8}',
		'- Three @{points|13}',
	);
	const refs = [0, 1, 2].map((item) => ({ stack: 0, item }));
	const titles = (filter: FilterNode | undefined): string[] =>
		filterCards(b, refs, filter, ctxOf(b)).map((ref) => cardOf(b, ref.item).title);

	it('AND keeps what every child keeps', () => {
		expect(
			titles({
				kind: 'group',
				op: 'and',
				children: [cond(builtin('tags'), 'contains', 'bug'), cond(property('points'), 'lt', '5')],
			}),
		).toEqual(['One']);
	});

	it('OR keeps what any child keeps, NOT keeps what none does', () => {
		const any: FilterNode = {
			kind: 'group',
			op: 'or',
			children: [cond(builtin('tags'), 'contains', 'bug'), cond(builtin('tags'), 'contains', 'ops')],
		};
		expect(titles(any)).toHaveLength(2);
		expect(titles({ kind: 'group', op: 'not', children: any.kind === 'group' ? any.children : [] })).toHaveLength(1);
	});

	it('nests: a group inside a group is one child of it', () => {
		const filter: FilterNode = {
			kind: 'group',
			op: 'and',
			children: [
				cond(property('points'), 'gt', '2'),
				{
					kind: 'group',
					op: 'or',
					children: [cond(builtin('tags'), 'contains', 'ops'), cond(property('points'), 'gte', '13')],
				},
			],
		};
		expect(titles(filter)).toHaveLength(2);
	});

	it('an empty group and an empty operand hide nothing', () => {
		expect(titles(emptyGroup('and'))).toHaveLength(3);
		expect(titles(emptyGroup('not'))).toHaveLength(3);
		expect(titles(undefined)).toHaveLength(3);
		// A condition still being typed matches everything (§4.3).
		expect(titles({ kind: 'group', op: 'and', children: [cond(property('owner'), 'contains', '')] })).toHaveLength(3);
	});

	it('counts its conditions at any depth', () => {
		expect(countConditions(emptyGroup())).toBe(0);
		expect(
			countConditions({
				kind: 'group',
				op: 'and',
				children: [
					cond(builtin('tags'), 'contains', 'bug'),
					{ kind: 'group', op: 'or', children: [cond(property('due'), 'isSet')] },
				],
			}),
		).toBe(2);
		expect(isEmptyFilter(emptyGroup())).toBe(true);
	});
});

describe('the tree (§4.2)', () => {
	const tree = (): FilterNode => ({
		kind: 'group',
		op: 'and',
		children: [
			cond(builtin('tags'), 'contains', 'bug'),
			{ kind: 'group', op: 'or', children: [cond(property('due'), 'isSet')] },
		],
	});

	it('addresses a node by path', () => {
		expect(nodeAt(tree(), [])?.kind).toBe('group');
		expect(nodeAt(tree(), [0])?.kind).toBe('condition');
		expect(nodeAt(tree(), [1, 0])?.kind).toBe('condition');
		expect(nodeAt(tree(), [9])).toBeNull();
		expect(nodeAt(tree(), [0, 0])).toBeNull();
	});

	it('replaces, removes and inserts by path', () => {
		const replaced = replaceNode(tree(), [0], cond(property('owner'), 'equals', 'Ann'));
		expect(nodeAt(replaced, [0])).toEqual(cond(property('owner'), 'equals', 'Ann'));

		const removed = removeAt(tree(), [1, 0]);
		expect(countConditions(removed)).toBe(1);

		const added = insertInto(tree(), [1], cond(property('points'), 'gt', '3'));
		expect(countConditions(added)).toBe(3);
		expect(nodeAt(added, [1, 1])).toEqual(cond(property('points'), 'gt', '3'));
	});

	it('moves a node into another group, and refuses to put a group inside itself', () => {
		const moved = moveNode(tree(), [0], [1], null);
		expect(nodeAt(moved, [0])?.kind).toBe('group');
		expect(countConditions(nodeAt(moved, [0]) ?? emptyGroup())).toBe(2);

		// The group at [1] cannot swallow itself.
		expect(moveNode(tree(), [1], [1], null)).toEqual(tree());
		// Nor can the root move.
		expect(moveNode(tree(), [], [1], null)).toEqual(tree());
	});

	it('moving down inside one group accounts for the removal', () => {
		const flat: FilterNode = {
			kind: 'group',
			op: 'and',
			children: [
				cond(property('owner'), 'equals', 'a'),
				cond(property('owner'), 'equals', 'b'),
				cond(property('owner'), 'equals', 'c'),
			],
		};
		const moved = moveNode(flat, [0], [], 2);
		const values = moved.kind === 'group' ? moved.children.map((c) => (c.kind === 'condition' ? c.value : '')) : [];
		expect(values).toEqual(['b', 'a', 'c']);
	});
});

describe('the operator catalogue (§3)', () => {
	it('offers only operators the matcher understands', () => {
		for (const [kind, ops] of Object.entries(OPS_BY_KIND)) {
			for (const op of ops) expect(supportsOp(kind as keyof typeof OPS_BY_KIND, op)).toBe(true);
			expect(ops.includes('isSet')).toBe(true);
			expect(defaultOp(kind as keyof typeof OPS_BY_KIND)).toBe(ops[0]);
		}
	});

	it('asks for the operand the operator needs', () => {
		expect(editorFor('text', 'isSet', false)).toBe('none');
		expect(editorFor('text', 'contains', false)).toBe('text');
		expect(editorFor('text', 'contains', true)).toBe('option');
		expect(editorFor('text', 'linksTo', false)).toBe('file');
		expect(editorFor('date', 'between', false)).toBe('date');
		expect(editorFor('number', 'gt', false)).toBe('number');
		expect(needsSecondValue('between')).toBe(true);
		expect(needsSecondValue('lt')).toBe(false);
	});
});
