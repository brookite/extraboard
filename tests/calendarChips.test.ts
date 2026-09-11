// How a day cell's chips share its room. Spec: docs/specs/calendar-view.md
// §3.1 (the budget and the wrapped title), §3.3 (a timespan's height).

import { describe, expect, it } from 'vitest';
import { chipUnits, durationOf, planChips } from '../src/model/calendarChips';
import type { Occurrence } from '../src/model/calendar';

const ref = { stack: 0, item: 0 };

/** A one-day occurrence, optionally from `from` to `to` minutes. */
function day(from?: number, to?: number): Occurrence {
	const start = { y: 2026, m: 8, d: 4, ...(from !== undefined && { minutes: from }) };
	const end = { y: 2026, m: 8, d: 4, ...(to !== undefined && { minutes: to }) };
	return { ref, sources: [], start, end, hasTime: from !== undefined, length: 1 };
}

/** A multi-day occurrence, which is a bar rather than a chip. */
function span(days: number): Occurrence {
	return {
		ref,
		sources: [],
		start: { y: 2026, m: 8, d: 4 },
		end: { y: 2026, m: 8, d: 4 + days - 1 },
		hasTime: false,
		length: days,
	};
}

const rows = (plans: { units: number; lines: number }[]): number =>
	plans.reduce((sum, p) => sum + Math.max(p.units, p.lines), 0);

describe('durationOf / chipUnits', () => {
	it('is the minutes between the two clocks of a timespan', () => {
		expect(durationOf(day(9 * 60, 10 * 60 + 30))).toBe(90);
		expect(chipUnits(day(9 * 60, 10 * 60 + 30))).toBe(3);
	});

	it('is nothing for a moment, a bare day, or a multi-day span', () => {
		expect(durationOf(day(9 * 60))).toBe(0);
		expect(durationOf(day())).toBe(0);
		expect(durationOf(span(3))).toBe(0);
		expect(chipUnits(day(9 * 60))).toBe(1);
	});

	it('is capped at four hours, so one card cannot take the whole cell', () => {
		expect(chipUnits(day(0, 12 * 60))).toBe(8);
		expect(chipUnits(day(0, 10))).toBe(1);
	});
});

describe('planChips', () => {
	it('never wraps a plain chip to a second line, however roomy the cell is', () => {
		const plan = planChips([day(), day()], 5, false);
		expect(plan.map((p) => p.lines)).toEqual([1, 1]);
		expect(rows(plan)).toBeLessThanOrEqual(5);
	});

	it('leaves spare rows unused rather than handing them to plain chips', () => {
		const plan = planChips([day(), day(), day(), day()], 5, false);
		expect(plan.map((p) => p.lines)).toEqual([1, 1, 1, 1]);
		expect(rows(plan)).toBeLessThanOrEqual(5);
	});

	it('never wraps a title in a cell that is already full', () => {
		// Three chips fill three rows exactly: nothing is hidden, nothing spare.
		expect(planChips([day(), day(), day()], 3, false).map((p) => p.lines)).toEqual([1, 1, 1]);
		// A fourth does not fit, and the row it would have taken becomes the `+N`.
		const plan = planChips([day(), day(), day(), day()], 3, false);
		expect(plan.map((p) => p.lines)).toEqual([1, 1]);
	});

	it('keeps a row for `+N` only when something is actually hidden', () => {
		expect(planChips([day(), day(), day()], 3, true)).toHaveLength(3);
		expect(planChips([day(), day(), day(), day()], 3, true)).toHaveLength(2);
	});

	it('holds a timespan at its own height and lets its title fill it', () => {
		const plan = planChips([day(9 * 60, 11 * 60)], 8, true);
		expect(plan[0]).toMatchObject({ units: 4, lines: 4 });
		expect(rows(plan)).toBeLessThanOrEqual(8);
	});

	it('never spends more rows than the cell has, whatever it is given', () => {
		const many = [day(9 * 60, 13 * 60), day(9 * 60, 10 * 60), day(), day(), day()];
		for (const capacity of [1, 2, 3, 5, 8, 13]) {
			for (const stretch of [false, true]) {
				expect(rows(planChips(many, capacity, stretch))).toBeLessThanOrEqual(capacity);
			}
		}
	});

	it('draws nothing rather than overflowing a cell with room for one chip', () => {
		expect(planChips([day(), day()], 1, false)).toEqual([]);
		expect(planChips([day()], 1, false).map((p) => p.lines)).toEqual([1]);
	});
});
