// How a day cell's chips share the room it has: how tall a timespan is drawn,
// and how many lines each chip may wrap to. Pure; no `preact`, no `obsidian`.
// Spec: docs/specs/calendar-view.md §3.1, §3.3.

import type { Occurrence } from './calendar';

/**
 * How a timespan is drawn in **week** mode (§3.3): one chip height per half
 * hour, so a two-hour value is visibly twice a one-hour one. An imitation of
 * duration, not a time axis — the week grid has no hour ruler to hang one on,
 * and a cell that is one day tall cannot hold a whole day to scale.
 */
const SPAN_UNIT_MINUTES = 30;

/** Four hours of chip is as much as one cell can give a single card. */
const MAX_SPAN_UNITS = 8;

/** At most this many lines for a chip with no duration to fill. */
const MAX_CHIP_LINES = 2;

/**
 * The minutes a timespan covers, or 0 when the occurrence is not one — a single
 * day, whatever time it carries, has no duration to draw (`dates.parseTimespan`).
 */
export function durationOf(occurrence: Occurrence): number {
	if (occurrence.length !== 1) return 0;
	const from = occurrence.start.minutes;
	const to = occurrence.end.minutes;
	if (from === undefined || to === undefined || to <= from) return 0;
	return to - from;
}

/** A chip's height in chip rows: 1 for anything without a duration. */
export function chipUnits(occurrence: Occurrence): number {
	const minutes = durationOf(occurrence);
	if (!minutes) return 1;
	return Math.max(1, Math.min(MAX_SPAN_UNITS, Math.round(minutes / SPAN_UNIT_MINUTES)));
}

/** One chip's share of a cell: the rows it takes, and the lines it may use. */
export interface ChipPlan {
	occurrence: Occurrence;
	/**
	 * Rows the chip is **held** at — a duration's height (§3.3). `0` leaves it
	 * as tall as its text needs.
	 */
	units: number;
	/** Lines of title it may wrap to (§3.1). */
	lines: number;
}

/**
 * Spend the cell's budget. It is a **height**, not a count: a stretched chip
 * costs as many rows as it is tall, and the last row is kept for `+N` whenever
 * anything is left behind.
 *
 * Rows the cell does not need are then handed back as **second lines**, in
 * order, so a title too long for one line wraps wherever there is room for it
 * to and nowhere else — a chip is never drawn outside its cell, and what the
 * plan cannot pay for the `+N` accounts for. A chip granted two lines is not
 * made two rows tall, only allowed to be: a short title still draws one row,
 * and the row it did not use is simply not filled.
 */
export function planChips(
	occurrences: Occurrence[],
	capacity: number,
	stretch: boolean,
): ChipPlan[] {
	let used = 0;
	const shown: { occurrence: Occurrence; units: number }[] = [];
	for (const occurrence of occurrences) {
		const units = stretch ? chipUnits(occurrence) : 1;
		const room = shown.length === occurrences.length - 1 ? capacity : capacity - 1;
		if (used + units > room) break;
		used += units;
		shown.push({ occurrence, units });
	}

	let spare = capacity - used - (shown.length < occurrences.length ? 1 : 0);
	return shown.map(({ occurrence, units }) => {
		// A duration already says how tall the chip is; its text simply fills it.
		if (units > 1) return { occurrence, units, lines: units };
		const extra = Math.max(0, Math.min(MAX_CHIP_LINES - 1, spare));
		spare -= extra;
		return { occurrence, units: 0, lines: 1 + extra };
	});
}
