// M9: repetition rules. Spec: docs/specs/recurrence.md.

import { describe, it, expect } from 'vitest';
import {
	expandRecurrence,
	formatRecurrence,
	nextOccurrence,
	parseRecurrence,
	shiftRecurrence,
	singleDayRule,
	type Recurrence,
} from '../src/model/recurrence';
import { formatDate, parseDate, type CalDate } from '../src/model/dates';
import { placeCards, moveOccurrence, setCardDay } from '../src/model/calendar';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const d = (text: string): CalDate => parseDate(text)!;

const rule = (text: string): Recurrence => {
	const parsed = parseRecurrence(text);
	if (!parsed) throw new Error(`did not parse: ${text}`);
	return parsed;
};

const days = (text: string, from: string, to: string, limit?: number): string[] => {
	const r = rule(text);
	return expandRecurrence(r, r.start ?? d(from), d(from), d(to), limit).map(formatDate);
};

describe('recurrence: grammar (§1.1)', () => {
	it('parses the shapes the form writes', () => {
		expect(rule('every day')).toEqual({ freq: 'day', interval: 1 });
		expect(rule('every 3 days from 2026-07-27 for 10 times')).toEqual({
			freq: 'day',
			interval: 3,
			start: { y: 2026, m: 7, d: 27 },
			count: 10,
		});
		expect(rule('every week on Mon, Wed, Fri')).toEqual({
			freq: 'week',
			interval: 1,
			weekdays: [1, 3, 5],
		});
		expect(rule('every month on day 15')).toEqual({ freq: 'month', interval: 1, monthDay: 15 });
		expect(rule('every month on the last Friday')).toEqual({
			freq: 'month',
			interval: 1,
			nth: { ordinal: -1, weekday: 5 },
		});
		expect(rule('every year on Jul 4 until 2030-01-01')).toEqual({
			freq: 'year',
			interval: 1,
			month: 7,
			day: 4,
			until: { y: 2030, m: 1, d: 1 },
		});
	});

	it('is case- and spacing-insensitive, and takes full names', () => {
		expect(parseRecurrence('EVERY  2   WEEKS  ON  monday , wednesday')).toEqual({
			freq: 'week',
			interval: 2,
			weekdays: [1, 3],
		});
		expect(parseRecurrence('every year on July 4')).toEqual({
			freq: 'year',
			interval: 1,
			month: 7,
			day: 4,
		});
	});

	it('round-trips through the canonical phrase', () => {
		for (const text of [
			'every day',
			'every 2 weeks on Mon, Wed',
			'every week on Sun',
			'every month on day 15 from 2026-08-15',
			'every month on the second Tuesday',
			'every year on Jul 4 until 2030-01-01',
			'every 3 days from 2026-07-27 09:30 for 10 times',
			'every day from 2026-07-27 for 1 time',
		]) {
			expect(formatRecurrence(rule(text))).toBe(text);
		}
	});

	it('rejects what is not a rule instead of guessing', () => {
		for (const text of [
			'',
			'weekly',
			'every fortnight',
			'every 0 days',
			'every week on Blursday',
			'every month on day 41',
			'every week from not-a-date',
			'every day until 2026-01-01 for 3 times',
			'2026-07-28',
		]) {
			expect(parseRecurrence(text)).toBeNull();
		}
	});
});

describe('recurrence: expansion (§2.1)', () => {
	it('walks days and weeks from the anchor', () => {
		expect(days('every 3 days from 2026-07-27', '2026-07-27', '2026-08-05')).toEqual([
			'2026-07-27',
			'2026-07-30',
			'2026-08-02',
			'2026-08-05',
		]);
		expect(days('every week on Mon, Fri from 2026-07-27', '2026-07-27', '2026-08-09')).toEqual([
			'2026-07-27',
			'2026-07-31',
			'2026-08-03',
			'2026-08-07',
		]);
	});

	it('counts weeks from the anchor, not from the locale week start', () => {
		// Anchored on a Wednesday, every 2 weeks, firing on Monday: the Monday of
		// each active week is the one *after* the anchor's Wednesday.
		expect(days('every 2 weeks on Mon from 2026-07-29', '2026-07-29', '2026-09-01')).toEqual([
			'2026-08-03',
			'2026-08-17',
			'2026-08-31',
		]);
	});

	it('keeps the anchor time on every occurrence', () => {
		const r = rule('every week from 2026-07-27 09:30');
		const out = expandRecurrence(r, d('2026-07-27'), d('2026-07-27'), d('2026-08-10'));
		expect(out.map(formatDate)).toEqual([
			'2026-07-27 09:30',
			'2026-08-03 09:30',
			'2026-08-10 09:30',
		]);
	});

	it('skips a period that cannot host the day rather than clamping it', () => {
		expect(days('every month on day 31 from 2026-01-31', '2026-01-01', '2026-06-30')).toEqual([
			'2026-01-31',
			'2026-03-31',
			'2026-05-31',
		]);
		expect(days('every year on Feb 29 from 2024-02-29', '2024-01-01', '2033-12-31')).toEqual([
			'2024-02-29',
			'2028-02-29',
			'2032-02-29',
		]);
	});

	it('finds the nth and the last weekday of a month', () => {
		expect(days('every month on the second Tuesday from 2026-07-01', '2026-07-01', '2026-09-30')).toEqual([
			'2026-07-14',
			'2026-08-11',
			'2026-09-08',
		]);
		expect(days('every month on the last Friday from 2026-07-01', '2026-07-01', '2026-09-30')).toEqual([
			'2026-07-31',
			'2026-08-28',
			'2026-09-25',
		]);
	});

	it('honours until (inclusive) and count', () => {
		expect(days('every week from 2026-07-27 until 2026-08-10', '2026-07-01', '2026-12-31')).toEqual([
			'2026-07-27',
			'2026-08-03',
			'2026-08-10',
		]);
		expect(days('every day from 2026-07-27 for 3 times', '2026-07-01', '2026-12-31')).toEqual([
			'2026-07-27',
			'2026-07-28',
			'2026-07-29',
		]);
		// A count is spent even by occurrences before the window.
		expect(days('every day from 2026-07-27 for 3 times', '2026-07-29', '2026-12-31')).toEqual([
			'2026-07-29',
		]);
	});

	it('never yields anything before the anchor', () => {
		expect(days('every week from 2026-07-27', '2026-06-01', '2026-08-03')).toEqual([
			'2026-07-27',
			'2026-08-03',
		]);
	});

	it('jumps to a far window without walking every period', () => {
		const out = days('every day from 2000-01-01', '2026-07-27', '2026-07-29');
		expect(out).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
	});

	it('respects the expansion cap', () => {
		expect(days('every day from 2026-01-01', '2026-01-01', '2026-12-31', 5)).toHaveLength(5);
	});

	it('nextOccurrence finds the next day, or nothing past the end', () => {
		const weekly = rule('every week on Mon from 2026-07-27');
		expect(formatDate(nextOccurrence(weekly, d('2026-07-27'), d('2026-07-27'))!)).toBe('2026-08-03');
		const ended = rule('every day from 2026-07-27 for 2 times');
		expect(nextOccurrence(ended, d('2026-07-27'), d('2026-07-28'))).toBeNull();
	});
});

describe('recurrence: shifting the series (§3.1)', () => {
	it('moves the anchor and the weekday set together', () => {
		const shifted = shiftRecurrence(rule('every week on Mon, Wed, Fri from 2026-07-27'), d('2026-07-27'), 2);
		expect(formatRecurrence(shifted)).toBe('every week on Wed, Fri, Sun from 2026-07-29');
	});

	it('recomputes the day of month and the yearly date', () => {
		expect(formatRecurrence(shiftRecurrence(rule('every month on day 15 from 2026-08-15'), d('2026-08-15'), 3))).toBe(
			'every month on day 18 from 2026-08-18',
		);
		expect(formatRecurrence(shiftRecurrence(rule('every year on Jul 4 from 2026-07-04'), d('2026-07-04'), 1))).toBe(
			'every year on Jul 5 from 2026-07-05',
		);
	});

	it('keeps "last" as last, and leaves the end date alone', () => {
		const shifted = shiftRecurrence(
			rule('every month on the last Friday from 2026-07-31 until 2027-01-01'),
			d('2026-07-31'),
			1,
		);
		expect(formatRecurrence(shifted)).toBe(
			'every month on the last Saturday from 2026-08-01 until 2027-01-01',
		);
	});

	it('gives a rule with no `from` one on the first shift', () => {
		const shifted = shiftRecurrence(rule('every week on Mon'), d('2026-07-27'), 1);
		expect(shifted.start).toEqual({ y: 2026, m: 7, d: 28 });
	});
});

// --- on a board -------------------------------------------------------------

const FM = boardHead({
	views: [{ id: 'v1', name: 'Repeats', type: 'calendar', dateProperty: 'repeat', mode: 'month' }],
	properties: [
		{ name: 'repeat', type: 'recurrence' },
		{ name: 'due', type: 'datetime' },
		{ name: 'dates', type: 'date-list' },
	],
});

const board = (...cards: string[]): Board =>
	parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));
const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);
const july = { from: d('2026-07-01'), to: d('2026-07-31') };

describe('recurrence: on the calendar (§3)', () => {
	it('expands a rule inside the window only', () => {
		const b = board('- Standup @{repeat|every week on Mon from 2026-07-06}');
		const { occurrences } = placeCards(b, 'repeat', july);
		expect(occurrences.map((o) => formatDate(o.start))).toEqual([
			'2026-07-06',
			'2026-07-13',
			'2026-07-20',
			'2026-07-27',
		]);
		expect(occurrences.every((o) => o.repeating)).toBe(true);
	});

	it('a rule with no hit in the window is still dated, not tray material', () => {
		const b = board('- Yearly @{repeat|every year on Dec 25 from 2026-12-25}');
		const { occurrences, undated } = placeCards(b, 'repeat', july);
		expect(occurrences).toHaveLength(0);
		expect(undated).toHaveLength(0);
	});

	it('anchors a rule with no `from` to the card\'s other date (§1.2)', () => {
		const b = board('- Review @{repeat|every week} @{due|2026-07-08}');
		const { occurrences, undated } = placeCards(b, 'repeat', july);
		expect(occurrences.map((o) => formatDate(o.start))).toEqual([
			'2026-07-08',
			'2026-07-15',
			'2026-07-22',
			'2026-07-29',
		]);
		expect(undated).toHaveLength(0);
	});

	it('leaves an unanchored rule undated rather than starting it today', () => {
		const b = board('- Floating @{repeat|every week}');
		const placement = placeCards(b, 'repeat', july);
		expect(placement.occurrences).toHaveLength(0);
		expect(placement.undated).toHaveLength(1);
	});

	it('places a rule inside a date list beside plain dates (§2.2)', () => {
		const b = board('- Mixed @{dates|2026-07-03; every week on Fri from 2026-07-10}');
		const { occurrences } = placeCards(b, 'dates', july);
		expect(occurrences.map((o) => formatDate(o.start))).toEqual([
			'2026-07-03',
			'2026-07-10',
			'2026-07-17',
			'2026-07-24',
			'2026-07-31',
		]);
		expect(occurrences[0]?.repeating).toBeUndefined();
		expect(occurrences[1]?.index).toBe(1);
	});

	it('dragging an occurrence shifts the whole series', () => {
		const b = board('- Standup @{repeat|every week on Mon from 2026-07-06}');
		const occurrence = placeCards(b, 'repeat', july).occurrences[1]!;
		const moved = moveOccurrence(b, occurrence, 'repeat', 'recurrence', d('2026-07-13'), d('2026-07-15'));
		expect(body(moved)).toContain('@{repeat|every week on Wed from 2026-07-08}');
	});

	it('a day dropped on a recurrence property becomes a one-day rule (§3.2)', () => {
		const b = board('- Once');
		const out = setCardDay(b, { stack: 0, item: 0 }, 'repeat', 'recurrence', d('2026-08-03'));
		expect(body(out)).toContain('@{repeat|every day from 2026-08-03 for 1 time}');
		const { occurrences } = placeCards(out, 'repeat', { from: d('2026-08-01'), to: d('2026-08-31') });
		expect(occurrences.map((o) => formatDate(o.start))).toEqual(['2026-08-03']);
	});

	it('the one-day rule is what singleDayRule builds', () => {
		expect(formatRecurrence(singleDayRule(d('2026-08-03')))).toBe('every day from 2026-08-03 for 1 time');
	});
});
