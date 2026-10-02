// Digest periods, due-ness and sections. Spec: docs/specs/digest-and-reminders.md §3.

import { describe, it, expect } from 'vitest';
import { configToPlain, toConfig } from '../src/model/boardSettings';
import { dayKey } from '../src/model/dates';
import { digestDue, digestSections, periodKey, periodWindow, type DigestDef } from '../src/model/digest';
import { parseBoard } from '../src/model/parse';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead({
	properties: [
		{ name: 'due', type: 'datetime', time: 'optional' },
		{ name: 'span', type: 'date-range' },
		{ name: 'many', type: 'date-list' },
		{ name: 'every', type: 'recurrence' },
		{ name: 'note', type: 'string' },
	],
});

const board = (...cards: string[]): Board => parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const titles = (b: Board, refs: { stack: number; item: number }[]): string[] =>
	refs.map((ref) => {
		const entry = b.stacks[ref.stack]!.items[ref.item]!;
		return entry.kind === 'card' ? entry.card.title : '';
	});

// Friday 2026-10-02.
const FRI = { y: 2026, m: 10, d: 2 };
const def: DigestDef = { time: '08:00' };

describe('periodWindow', () => {
	it('is one day for a daily digest, and the day before for offset -1', () => {
		expect(periodWindow('daily', FRI, 1)).toEqual({ from: FRI, to: FRI });
		expect(dayKey(periodWindow('daily', { y: 2026, m: 3, d: 1 }, 1, -1).from)).toBe('2026-02-28');
	});

	it('starts a week on any weekday', () => {
		const range = (ws: number) => {
			const w = periodWindow('weekly', FRI, ws);
			return `${dayKey(w.from)}..${dayKey(w.to)}`;
		};
		expect(range(1)).toBe('2026-09-28..2026-10-04');
		expect(range(0)).toBe('2026-09-27..2026-10-03');
		expect(range(5)).toBe('2026-10-02..2026-10-08');
		expect(range(6)).toBe('2026-09-26..2026-10-02');
	});

	it('crosses a year boundary', () => {
		const w = periodWindow('weekly', { y: 2027, m: 1, d: 1 }, 1, -1);
		expect(dayKey(w.from)).toBe('2026-12-21');
		expect(dayKey(w.to)).toBe('2026-12-27');
	});
});

describe('digestDue', () => {
	it('waits for the time on the first day, then catches up', () => {
		expect(digestDue('daily', def, { date: FRI, minutes: 7 * 60 + 59 }, 1, undefined)).toBe(false);
		expect(digestDue('daily', def, { date: FRI, minutes: 8 * 60 }, 1, undefined)).toBe(true);
	});

	it('is not due twice in one period', () => {
		const key = periodKey('daily', FRI, 1);
		expect(digestDue('daily', def, { date: FRI, minutes: 23 * 60 }, 1, key)).toBe(false);
		expect(digestDue('daily', def, { date: { y: 2026, m: 10, d: 3 }, minutes: 9 * 60 }, 1, key)).toBe(true);
	});

	it('weekly: due any time after the first day, even before the time', () => {
		// Monday-start week: Friday is day five, so 00:30 is past "Monday 08:00".
		expect(digestDue('weekly', def, { date: FRI, minutes: 30 }, 1, undefined)).toBe(true);
		// Friday-start week: today is the first day and it is not 08:00 yet.
		expect(digestDue('weekly', def, { date: FRI, minutes: 30 }, 5, undefined)).toBe(false);
		expect(digestDue('weekly', def, { date: FRI, minutes: 30 }, 1, '2026-09-28')).toBe(false);
	});
});

describe('digestSections', () => {
	const ctx = { config: toConfig({}), today: FRI, weekStart: 1 };

	it('lists dates, ranges, list elements and recurrences of today, once each', () => {
		const b = board(
			'- Due today @{due|2026-10-02 09:00}',
			'- Tomorrow @{due|2026-10-03}',
			'- Range @{span|2026-09-30 → 2026-10-05}',
			'- List @{many|2026-09-01; 2026-10-02}',
			'- Weekly @{every|every week on Friday from 2026-09-04}',
			'- Two props @{due|2026-10-02} @{span|2026-10-02 → 2026-10-02}',
		);
		const { current } = digestSections(b, 'daily', def, { ...ctx, config: b.config });
		expect(titles(b, current).sort()).toEqual(
			['Due today', 'List', 'Range', 'Two props', 'Weekly'].sort(),
		);
	});

	it('counts the previous period, done cards listed, rules left out', () => {
		const b = board(
			'- [x] Done yesterday @{due|2026-10-01}',
			'- [ ] Missed yesterday @{due|2026-10-01}',
			'- [x] Weekly @{every|every day from 2026-09-01}',
			'- [x] Older @{due|2026-09-20}',
		);
		const { previous } = digestSections(b, 'daily', def, { ...ctx, config: b.config });
		expect(titles(b, previous.done)).toEqual(['Done yesterday']);
		expect(previous.total).toBe(2);
	});

	it('reads only the chosen properties, then filters and sorts', () => {
		const b = board(
			'- B @{due|2026-10-02} #work',
			'- A @{due|2026-10-02} #work',
			'- C @{due|2026-10-02}',
			'- Span only @{span|2026-10-02 → 2026-10-02} #work',
		);
		const chosen: DigestDef = {
			time: '00:00',
			properties: ['due'],
			filter: {
				kind: 'group',
				op: 'and',
				children: [{ kind: 'condition', field: { kind: 'builtin', id: 'tags' }, op: 'contains', value: 'work' }],
			},
			sorts: [{ field: { kind: 'builtin', id: 'title' }, dir: 'asc' }],
		};
		const { current } = digestSections(b, 'daily', chosen, { ...ctx, config: b.config });
		expect(titles(b, current)).toEqual(['A', 'B']);
	});

	it('weekly covers the whole week', () => {
		const b = board('- Mon @{due|2026-09-28}', '- Sun @{due|2026-10-04}', '- Next Mon @{due|2026-10-05}');
		const { current } = digestSections(b, 'weekly', def, { ...ctx, config: b.config });
		expect(titles(b, current)).toEqual(['Mon', 'Sun']);
	});
});

describe('digest settings', () => {
	it('round-trips both kinds, normalizing the time', () => {
		const config = toConfig({
			version: 1,
			digest: {
				daily: { time: '8:05', properties: ['due', 'due', ''] },
				weekly: { time: 'nonsense', weekStart: 0, sorts: [{ field: '@title', dir: 'desc' }] },
			},
		});
		expect(config.digest).toEqual({
			daily: { time: '08:05', properties: ['due'] },
			weekly: {
				time: '00:00',
				weekStart: 0,
				sorts: [{ field: { kind: 'builtin', id: 'title' }, dir: 'desc' }],
			},
		});
		expect(configToPlain(config).digest).toEqual({
			daily: { time: '08:05', properties: ['due'] },
			weekly: { time: '00:00', weekStart: 0, sorts: [{ field: '@title', dir: 'desc' }] },
		});
	});

	it('drops a bad weekly first day and a non-object kind', () => {
		const config = toConfig({ digest: { daily: true, weekly: { weekStart: 9 } } });
		expect(config.digest).toEqual({ weekly: { time: '00:00' } });
		expect(toConfig({ digest: {} }).digest).toBeUndefined();
		expect(configToPlain(toConfig({})).digest).toBeUndefined();
	});
});
