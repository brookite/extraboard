// Reminder triggers, sections, settings and device state.
// Spec: docs/specs/digest-and-reminders.md §4, §9.

import { describe, it, expect } from 'vitest';
import { configToPlain, toConfig } from '../src/model/boardSettings';
import { parseBoard } from '../src/model/parse';
import {
	cardTriggered,
	instantOf,
	reminderSections,
	shiftInstant,
	triggerAt,
	type ReminderDef,
	type ReminderRun,
} from '../src/model/reminders';
import type { Board, Card } from '../src/model/types';
import {
	deleteBoardState,
	pruneReminded,
	readBoardStates,
	renameBoardState,
} from '../src/schedule/state';
import { boardHead } from './boardFile';

const FM = boardHead({
	properties: [
		{ name: 'due', type: 'datetime', time: 'optional' },
		{ name: 'every', type: 'recurrence' },
	],
});

const board = (...cards: string[]): Board => parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const cardOf = (b: Board, index = 0): Card => {
	const entry = b.stacks[0]!.items[index]!;
	if (entry.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

const reminder = (patch: Partial<ReminderDef> = {}): ReminderDef => ({
	id: 'r1',
	comment: '',
	property: 'due',
	repeat: 'once',
	offsets: [{ dir: 'before', amount: 1, unit: 'day' }],
	...patch,
});

const ctxOf = (b: Board) => ({ config: b.config, today: { y: 2026, m: 10, d: 2 } });

describe('instants', () => {
	it('reads a date without a time as the start of its day', () => {
		expect(instantOf({ y: 2026, m: 10, d: 2 })).toBe(at(2026, 10, 2));
		expect(instantOf({ y: 2026, m: 10, d: 2, minutes: 9 * 60 + 30 })).toBe(at(2026, 10, 2, 9, 30));
	});

	it('shifts by calendar months, clamping the day', () => {
		expect(shiftInstant(at(2026, 1, 31, 10), 1, 'month')).toBe(at(2026, 2, 28, 10));
		expect(shiftInstant(at(2026, 3, 31), -1, 'month')).toBe(at(2026, 2, 28));
	});

	it('turns an offset into a trigger before or after', () => {
		const day = { y: 2026, m: 10, d: 10 };
		expect(triggerAt(day, { dir: 'before', amount: 2, unit: 'hour' })).toBe(at(2026, 10, 9, 22));
		expect(triggerAt(day, { dir: 'after', amount: 1, unit: 'week' })).toBe(at(2026, 10, 17));
	});
});

describe('cardTriggered (once)', () => {
	const b = board('- Due @{due|2026-10-10 12:00}');
	const card = cardOf(b);
	const def = reminder();

	it('fires when the trigger falls in (lastChecked, now]', () => {
		// Trigger = 2026-10-09 12:00.
		expect(cardTriggered(card, def, at(2026, 10, 9, 11), at(2026, 10, 9, 12))).toBe(true);
		expect(cardTriggered(card, def, at(2026, 10, 9, 12), at(2026, 10, 9, 13))).toBe(false);
		expect(cardTriggered(card, def, at(2026, 10, 9, 10), at(2026, 10, 9, 11))).toBe(false);
	});

	it('catches up after a long gap', () => {
		expect(cardTriggered(card, def, at(2026, 9, 1), at(2026, 10, 20))).toBe(true);
	});

	it('fires once per offset, and at the date when there are none', () => {
		const many = reminder({
			offsets: [
				{ dir: 'before', amount: 1, unit: 'day' },
				{ dir: 'after', amount: 30, unit: 'minute' },
			],
		});
		expect(cardTriggered(card, many, at(2026, 10, 10, 12, 10), at(2026, 10, 10, 12, 30))).toBe(true);
		const atDate = reminder({ offsets: [] });
		expect(cardTriggered(card, atDate, at(2026, 10, 10, 11), at(2026, 10, 10, 12))).toBe(true);
	});

	it('without offsets, a check after the date still catches it', () => {
		const atDate = reminder({ offsets: [] });
		// Last checked 11:59, the date is 12:00, the next check comes at 12:01.
		expect(cardTriggered(card, atDate, at(2026, 10, 10, 11, 59), at(2026, 10, 10, 12, 1))).toBe(true);
		// Or days later, the app having been closed in between.
		expect(cardTriggered(card, atDate, at(2026, 10, 10, 11, 59), at(2026, 10, 14, 9))).toBe(true);
		// Only a check already past the date has nothing new to say.
		expect(cardTriggered(card, atDate, at(2026, 10, 10, 12, 1), at(2026, 10, 10, 12, 2))).toBe(false);
	});

	it('expands a repetition rule over the interval', () => {
		const rb = board('- Weekly @{every|every week from 2026-09-04 09:00}');
		const weekly = reminder({ property: 'every', offsets: [{ dir: 'before', amount: 1, unit: 'hour' }] });
		expect(cardTriggered(cardOf(rb), weekly, at(2026, 10, 2, 7), at(2026, 10, 2, 8))).toBe(true);
		expect(cardTriggered(cardOf(rb), weekly, at(2026, 10, 3), at(2026, 10, 8))).toBe(false);
		// Month offsets reach across the month into the next one's occurrences.
		const monthly = reminder({ property: 'every', offsets: [{ dir: 'before', amount: 1, unit: 'month' }] });
		expect(cardTriggered(cardOf(rb), monthly, at(2026, 10, 6, 8), at(2026, 10, 6, 9))).toBe(true);
		expect(cardTriggered(cardOf(rb), monthly, at(2026, 10, 6, 9), at(2026, 10, 7, 9))).toBe(false);
	});
});

describe('reminderSections', () => {
	const b = board(
		'- [ ] Overdue @{due|2026-09-30}',
		'- [x] Overdue but done @{due|2026-09-29}',
		'- [ ] Future @{due|2026-12-01}',
		'- [ ] Soon @{due|2026-10-03}',
		'- No date',
	);
	const now = at(2026, 10, 2, 12);

	it('launch: every past trigger until the end filter', () => {
		const run: ReminderRun = {
			def: reminder({
				repeat: 'launch',
				offsets: [],
				endFilter: {
					kind: 'group',
					op: 'and',
					children: [{ kind: 'condition', field: { kind: 'builtin', id: 'done' }, op: 'isSet' }],
				},
			}),
			since: -Infinity,
			until: now,
		};
		const sections = reminderSections(b, [run], ctxOf(b));
		expect(sections).toHaveLength(1);
		expect(sections[0]!.refs.map((r) => r.item)).toEqual([0]);
	});

	it('groups by comment, lists a card once, drops empty sections', () => {
		const runs: ReminderRun[] = [
			{ def: reminder({ id: 'a', comment: 'Soon', repeat: 'launch' }), since: -Infinity, until: now },
			{ def: reminder({ id: 'b', comment: ' Soon ', repeat: 'launch', offsets: [] }), since: -Infinity, until: now },
			{ def: reminder({ id: 'c', comment: 'Never' }), since: now, until: now },
		];
		const sections = reminderSections(b, runs, ctxOf(b));
		expect(sections.map((s) => s.comment)).toEqual(['Soon']);
		expect(sections[0]!.refs.map((r) => r.item)).toEqual([0, 1, 3]);
	});

	it('applies the reminder filter, then the session view', () => {
		const run: ReminderRun = {
			def: reminder({
				repeat: 'launch',
				offsets: [],
				filter: {
					kind: 'group',
					op: 'and',
					children: [{ kind: 'condition', field: { kind: 'builtin', id: 'title' }, op: 'contains', value: 'overdue' }],
				},
			}),
			since: -Infinity,
			until: now,
		};
		expect(reminderSections(b, [run], ctxOf(b))[0]!.refs.map((r) => r.item)).toEqual([0, 1]);
		const sorted = reminderSections(b, [run], ctxOf(b), {
			sorts: [{ field: { kind: 'property', name: 'due' }, dir: 'asc' }],
		});
		expect(sorted[0]!.refs.map((r) => r.item)).toEqual([1, 0]);
	});
});

describe('reminder settings', () => {
	it('round-trips, generating missing and duplicate ids', () => {
		const config = toConfig({
			reminders: [
				{ id: 'r1', property: 'due', repeat: 'launch', offsets: [{ dir: 'after', amount: 2, unit: 'day' }], endFilter: { op: 'and', children: [{ field: '@done', op: 'isSet' }] } },
				{ id: 'r1', comment: ' Soon ', property: 'due', offsets: [{ amount: -1, unit: 'day' }, { dir: 'before', amount: 3, unit: 'hour' }] },
				{ comment: 'No property' },
				{ property: 'due', repeat: 'once', endFilter: { op: 'and', children: [{ field: '@done', op: 'isSet' }] } },
			],
		});
		expect(config.reminders?.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
		expect(config.reminders?.[1]).toEqual({
			id: 'r2',
			comment: 'Soon',
			property: 'due',
			repeat: 'once',
			offsets: [{ dir: 'before', amount: 3, unit: 'hour' }],
		});
		// `once` has no end filter to keep.
		expect(config.reminders?.[2]?.endFilter).toBeUndefined();
		const plain = configToPlain(config).reminders as Record<string, unknown>[];
		expect(plain[0]).toEqual({
			id: 'r1',
			property: 'due',
			repeat: 'launch',
			offsets: [{ dir: 'after', amount: 2, unit: 'day' }],
			endFilter: { op: 'and', children: [{ field: '@done', op: 'isSet' }] },
		});
		expect(toConfig(configToPlain(config)).reminders).toEqual(config.reminders);
	});

	it('writes nothing for no reminders', () => {
		expect(configToPlain(toConfig({ reminders: [] })).reminders).toBeUndefined();
	});
});

describe('board state', () => {
	it('reads an owned, cleaned copy', () => {
		const raw = {
			'a.md': {
				digest: { daily: '2026-10-02', weekly: 3 },
				reminded: { r1: 5, r2: 'x' },
				collapsed: { 'digest:daily:done': false, bad: 1 },
			},
			'b.md': 'junk',
		};
		expect(readBoardStates(raw)).toEqual({
			'a.md': {
				digest: { daily: '2026-10-02' },
				reminded: { r1: 5 },
				collapsed: { 'digest:daily:done': false },
			},
		});
		expect(readBoardStates(undefined)).toEqual({});
	});

	it('follows a rename and goes with a delete', () => {
		const states = { 'a.md': { reminded: { r1: 1 } } };
		expect(renameBoardState(states, 'a.md', 'b.md')).toEqual({ 'b.md': { reminded: { r1: 1 } } });
		expect(renameBoardState(states, 'x.md', 'y.md')).toBe(states);
		expect(deleteBoardState(states, 'a.md')).toEqual({});
		expect(deleteBoardState(states, 'x.md')).toBe(states);
	});

	it('prunes timestamps of reminders that no longer exist', () => {
		expect(pruneReminded({ r1: 1, r2: 2 }, ['r2'])).toEqual({ r2: 2 });
		expect(pruneReminded({ r1: 1 }, [])).toBeUndefined();
	});
});
