import { describe, expect, it } from 'vitest';
import {
	inSelection,
	monthGrid,
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
