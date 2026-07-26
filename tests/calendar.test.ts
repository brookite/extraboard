// M8 part B: the date reader and card placement.
// Spec: docs/specs/calendar-view.md §1, §5.3, §6.

import { describe, it, expect } from 'vitest';
import {
	addDays,
	addMonths,
	compareDates,
	daysBetween,
	daysInMonth,
	formatDate,
	formatSpan,
	fromOrdinal,
	parseDate,
	parseSpan,
	startOfWeek,
	toOrdinal,
	weekday,
} from '../src/model/dates';
import {
	clearOccurrence,
	moveOccurrence,
	placeCards,
	setCardDay,
	type Occurrence,
} from '../src/model/calendar';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';

const FM = [
	'---',
	'extraboard:',
	'  version: 1',
	'  views:',
	'    - { id: v1, name: Due, type: calendar, dateProperty: due, mode: month }',
	'  properties:',
	'    - { name: due, type: datetime }',
	'    - { name: sprint, type: date-range }',
	'    - { name: dates, type: date-list }',
	'---',
].join('\n');

const board = (...cards: string[]): Board =>
	parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);

describe('dates: parsing (§1.1)', () => {
	it('reads a plain date and a date with a time', () => {
		expect(parseDate('2026-07-28')).toEqual({ y: 2026, m: 7, d: 28 });
		expect(parseDate('2026-07-28 09:30')).toEqual({ y: 2026, m: 7, d: 28, minutes: 570 });
		expect(parseDate('2026-07-28T09:30:15')).toEqual({ y: 2026, m: 7, d: 28, minutes: 570 });
	});

	it('rejects impossible dates and times instead of guessing', () => {
		expect(parseDate('2026-02-30')).toBeNull();
		expect(parseDate('2026-13-01')).toBeNull();
		expect(parseDate('2026-07-28 25:00')).toBeNull();
		expect(parseDate('next tuesday')).toBeNull();
		expect(parseDate('')).toBeNull();
	});

	it('knows leap years', () => {
		expect(parseDate('2024-02-29')).not.toBeNull();
		expect(parseDate('2026-02-29')).toBeNull();
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2100, 2)).toBe(28);
	});

	it('reads every accepted range separator and normalizes a reversed one', () => {
		for (const sep of ['→', '->', '..', '–', '—']) {
			expect(parseSpan(`2026-07-24 ${sep} 2026-08-07`)).toEqual({
				start: { y: 2026, m: 7, d: 24 },
				end: { y: 2026, m: 8, d: 7 },
			});
		}
		expect(parseSpan('2026-08-07 → 2026-07-24')?.start).toEqual({ y: 2026, m: 7, d: 24 });
	});

	it('formats canonically', () => {
		expect(formatDate({ y: 2026, m: 7, d: 5 })).toBe('2026-07-05');
		expect(formatDate({ y: 2026, m: 7, d: 5, minutes: 545 })).toBe('2026-07-05 09:05');
		expect(formatSpan({ start: { y: 2026, m: 7, d: 5 }, end: { y: 2026, m: 7, d: 9 } })).toBe(
			'2026-07-05 → 2026-07-09',
		);
		// A one-day *range* stays a range: the property's shape is the user's.
		expect(formatSpan({ start: { y: 2026, m: 7, d: 5 }, end: { y: 2026, m: 7, d: 5 } })).toBe(
			'2026-07-05 → 2026-07-05',
		);
	});
});

describe('dates: arithmetic (§1.2)', () => {
	it('round-trips the day ordinal across eras', () => {
		for (const text of ['1970-01-01', '1999-12-31', '2000-02-29', '2026-07-26', '2100-03-01']) {
			const date = parseDate(text)!;
			expect(fromOrdinal(toOrdinal(date))).toEqual(date);
		}
		expect(toOrdinal({ y: 1970, m: 1, d: 1 })).toBe(0);
	});

	it('adds days across month, year and leap boundaries', () => {
		expect(addDays({ y: 2026, m: 7, d: 31 }, 1)).toEqual({ y: 2026, m: 8, d: 1 });
		expect(addDays({ y: 2026, m: 1, d: 1 }, -1)).toEqual({ y: 2025, m: 12, d: 31 });
		expect(addDays({ y: 2024, m: 2, d: 28 }, 1)).toEqual({ y: 2024, m: 2, d: 29 });
		expect(daysBetween({ y: 2026, m: 8, d: 7 }, { y: 2026, m: 7, d: 24 })).toBe(14);
	});

	it('keeps the time when a dated value moves', () => {
		expect(addDays({ y: 2026, m: 7, d: 28, minutes: 570 }, 3)).toEqual({
			y: 2026,
			m: 7,
			d: 31,
			minutes: 570,
		});
	});

	it('clamps the day when adding months', () => {
		expect(addMonths({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 28 });
		expect(addMonths({ y: 2026, m: 12, d: 15 }, 1)).toEqual({ y: 2027, m: 1, d: 15 });
	});

	it('knows weekdays and honours the locale first day', () => {
		// 2026-07-26 is a Sunday.
		expect(weekday({ y: 2026, m: 7, d: 26 })).toBe(0);
		expect(startOfWeek({ y: 2026, m: 7, d: 26 }, 1)).toEqual({ y: 2026, m: 7, d: 20 });
		expect(startOfWeek({ y: 2026, m: 7, d: 26 }, 0)).toEqual({ y: 2026, m: 7, d: 26 });
	});

	it('sorts a timed value after a plain one on the same day', () => {
		expect(compareDates({ y: 2026, m: 7, d: 5 }, { y: 2026, m: 7, d: 5, minutes: 60 })).toBeLessThan(0);
	});
});

describe('calendar: placement (§1.3)', () => {
	it('places a datetime once and keeps its time', () => {
		const { occurrences, undated } = placeCards(board('- Ship @{due|2026-07-28 09:00}'), 'due');
		expect(occurrences).toHaveLength(1);
		expect(occurrences[0]?.hasTime).toBe(true);
		expect(occurrences[0]?.length).toBe(1);
		expect(undated).toHaveLength(0);
	});

	it('spans a range inclusively', () => {
		const { occurrences } = placeCards(board('- Sprint @{sprint|2026-07-24 → 2026-08-07}'), 'sprint');
		expect(occurrences[0]?.length).toBe(15);
	});

	it('places every element of a date list, each with its own index', () => {
		const { occurrences } = placeCards(
			board('- Standup @{dates|2026-07-25; 2026-07-28; 2026-08-01 → 2026-08-02}'),
			'dates',
		);
		expect(occurrences.map((o) => o.index)).toEqual([0, 1, 2]);
		expect(occurrences[2]?.length).toBe(2);
	});

	it('treats a missing, unparseable or non-date value as undated', () => {
		const b = board(
			'- No value',
			'- Broken @{due|sometime next week}',
			'- Recurring @{repeat|every week}',
		);
		const { occurrences, undated } = placeCards(b, 'due');
		expect(occurrences).toHaveLength(0);
		expect(undated).toHaveLength(3);
	});

	it('places cards in collapsed stacks and groups like any other (§1.4)', () => {
		const b = parseBoard(
			[FM, '', '## Done %%collapsed%%', '', '### Later %%collapsed%%', '', '- Late @{due|2026-07-28}', ''].join('\n'),
		);
		expect(placeCards(b, 'due').occurrences).toHaveLength(1);
	});

	it('sorts by start, then by length', () => {
		const b = board(
			'- Later @{due|2026-07-30}',
			'- Long @{due|2026-07-28 → 2026-07-31}',
			'- Short @{due|2026-07-28}',
		);
		const { occurrences } = placeCards(b, 'due');
		expect(occurrences.map((o) => o.length)).toEqual([4, 1, 1]);
	});
});

describe('calendar: date edits (§5.3, §6)', () => {
	const day = { y: 2026, m: 8, d: 3 };
	const only = (b: Board, property: string): Occurrence => placeCards(b, property).occurrences[0]!;

	it('setCardDay writes the shape the property type asks for', () => {
		const b = board('- Ship');
		const ref = { stack: 0, item: 0 };
		expect(body(setCardDay(b, ref, 'due', 'datetime', day))).toContain('@{due|2026-08-03}');
		expect(body(setCardDay(b, ref, 'sprint', 'date-range', day))).toContain(
			'@{sprint|2026-08-03 → 2026-08-03}',
		);
		expect(body(setCardDay(b, ref, 'dates', 'date-list', day))).toContain('@{dates|2026-08-03}');
	});

	it('setCardDay drops any time, because a day cell has none', () => {
		const b = board('- Ship @{due|2026-07-28 09:00}');
		expect(body(setCardDay(b, { stack: 0, item: 0 }, 'due', 'datetime', day))).toContain(
			'@{due|2026-08-03}',
		);
	});

	it('moving a datetime keeps its time', () => {
		const b = board('- Ship @{due|2026-07-28 09:00}');
		const moved = moveOccurrence(b, only(b, 'due'), 'due', 'datetime', { y: 2026, m: 7, d: 28 }, day);
		expect(body(moved)).toContain('@{due|2026-08-03 09:00}');
	});

	it('moving a range shifts it by the drag delta and keeps its length', () => {
		const b = board('- Sprint @{sprint|2026-07-24 → 2026-08-07}');
		// Dragged from its third day (2026-07-26) onto 2026-08-03: +8 days.
		const moved = moveOccurrence(
			b,
			only(b, 'sprint'),
			'sprint',
			'date-range',
			{ y: 2026, m: 7, d: 26 },
			day,
		);
		expect(body(moved)).toContain('@{sprint|2026-08-01 → 2026-08-15}');
	});

	it('moving one element of a date list leaves the others alone', () => {
		const b = board('- Standup @{dates|2026-07-25; 2026-07-28}');
		const second = placeCards(b, 'dates').occurrences[1]!;
		const moved = moveOccurrence(b, second, 'dates', 'date-list', { y: 2026, m: 7, d: 28 }, day);
		expect(body(moved)).toContain('@{dates|2026-07-25; 2026-08-03}');
	});

	it('a move onto the same day changes nothing', () => {
		const b = board('- Ship @{due|2026-07-28}');
		const from = { y: 2026, m: 7, d: 28 };
		expect(moveOccurrence(b, only(b, 'due'), 'due', 'datetime', from, from)).toBe(b);
	});

	it('clearing removes the property, or just the dragged element of a list', () => {
		const single = board('- Ship @{due|2026-07-28}');
		expect(body(clearOccurrence(single, only(single, 'due'), 'due', 'datetime'))).not.toContain('@{due');

		const list = board('- Standup @{dates|2026-07-25; 2026-07-28}');
		const first = placeCards(list, 'dates').occurrences[0]!;
		expect(body(clearOccurrence(list, first, 'dates', 'date-list'))).toContain('@{dates|2026-07-28}');

		const one = board('- Standup @{dates|2026-07-25}');
		const solo = placeCards(one, 'dates').occurrences[0]!;
		expect(body(clearOccurrence(one, solo, 'dates', 'date-list'))).not.toContain('@{dates');
	});
});
