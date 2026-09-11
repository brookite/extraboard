import { describe, expect, it } from 'vitest';
import {
	inSelection,
	insertDateEntry,
	monthGrid,
	readDateEntry,
	selectCalendarDay,
} from '../src/model/dateSelection';
import { dayKey, type CalDate } from '../src/model/dates';

const date = (d: number, m = 8, y = 2026): CalDate => ({ y, m, d });

describe('calendar property selection', () => {
	it('selects only one day when ranges are disabled', () => {
		const first = selectCalendarDay(null, date(4), false);
		expect(first).toEqual({ start: date(4) });
		expect(selectCalendarDay(first, date(9), false)).toEqual({ start: date(9) });
	});

	it('turns two increasing clicks into an inclusive range', () => {
		const first = selectCalendarDay(null, date(4), true);
		const range = selectCalendarDay(first, date(9), true);
		expect(range).toEqual({ start: date(4), end: date(9) });
		expect(inSelection(date(4), range)).toBe(true);
		expect(inSelection(date(7), range)).toBe(true);
		expect(inSelection(date(9), range)).toBe(true);
		expect(inSelection(date(10), range)).toBe(false);
	});

	it('starts over after an earlier/equal click or a completed range', () => {
		const first = { start: date(4) };
		expect(selectCalendarDay(first, date(4), true)).toEqual({ start: date(4) });
		expect(selectCalendarDay(first, date(2), true)).toEqual({ start: date(2) });
		expect(selectCalendarDay({ start: date(4), end: date(9) }, date(12), true)).toEqual({
			start: date(12),
		});
	});

	it('builds six full weeks from the configured first weekday', () => {
		const monday = monthGrid(date(1), 1);
		expect(monday).toHaveLength(42);
		expect(dayKey(monday[0]!)).toBe('2026-07-27');
		expect(dayKey(monday[41]!)).toBe('2026-09-06');

		const sunday = monthGrid(date(1), 0);
		expect(dayKey(sunday[0]!)).toBe('2026-07-26');
	});
});

describe('editing a stored date entry', () => {
	it('reads a single day back, with its time', () => {
		expect(readDateEntry('2026-08-04')).toEqual({
			selection: { start: date(4) },
			time: '',
			month: date(4),
		});
		expect(readDateEntry('2026-08-04 09:05')).toEqual({
			selection: { start: date(4) },
			time: '09:05',
			month: date(4),
		});
	});

	it('reads a range back as a two-ended selection and drops any time', () => {
		expect(readDateEntry('2026-08-04 09:05 → 2026-08-09')).toEqual({
			selection: { start: date(4), end: date(9) },
			time: '',
			month: date(4),
		});
	});

	it('opens the calendar on the month the entry starts in', () => {
		expect(readDateEntry('2026-07-30 → 2026-08-02')?.month).toEqual(date(30, 7));
	});

	it('refuses what the calendar cannot show', () => {
		expect(readDateEntry('every week on Mon')).toBeNull();
		expect(readDateEntry('')).toBeNull();
	});

	it('puts an entry back where it came from', () => {
		const list = ['2026-08-01', '2026-08-03', '2026-08-07'];
		expect(insertDateEntry(list, 1, '2026-08-02')).toEqual([
			'2026-08-01',
			'2026-08-02',
			'2026-08-03',
			'2026-08-07',
		]);
		expect(insertDateEntry(list, 9, '2026-08-09')).toEqual([...list, '2026-08-09']);
		expect(insertDateEntry([], 3, '2026-08-09')).toEqual(['2026-08-09']);
		expect(list).toHaveLength(3);
	});
});
