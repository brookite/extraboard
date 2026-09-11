// Pure selection and month-grid helpers for the card property's calendar.

import {
	addDays,
	compareDates,
	formatClock,
	parseSpan,
	sameDay,
	startOfMonth,
	stripTime,
	toOrdinal,
	weekday,
	type CalDate,
} from './dates';

export interface DateSelection {
	start: CalDate;
	end?: CalDate;
}

/**
 * One click starts a selection. In range mode, a later second click completes
 * it; an earlier/equal click or a click after completion starts over.
 */
export function selectCalendarDay(
	selection: DateSelection | null,
	day: CalDate,
	allowRange: boolean,
): DateSelection {
	if (!allowRange) return { start: day };
	if (!selection || selection.end || compareDates(day, selection.start) <= 0) {
		return { start: day };
	}
	return { start: selection.start, end: day };
}

/** Six complete calendar rows, beginning on the configured weekday. */
export function monthGrid(month: CalDate, firstDay: number): CalDate[] {
	const first = startOfMonth(month);
	const lead = ((weekday(first) - firstDay) % 7 + 7) % 7;
	const gridStart = addDays(first, -lead);
	return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function inSelection(day: CalDate, selection: DateSelection | null): boolean {
	if (!selection) return false;
	const ordinal = toOrdinal(day);
	const start = toOrdinal(selection.start);
	const end = toOrdinal(selection.end ?? selection.start);
	return ordinal >= start && ordinal <= end;
}

export function isSameMonth(day: CalDate, month: CalDate): boolean {
	return day.y === month.y && day.m === month.m;
}

/** A stored entry read back into the calendar's own controls. */
export interface DateEntryEdit {
	selection: DateSelection;
	/** `HH:mm`, or `''` — a range never carries one. */
	time: string;
	/** The month the calendar should be showing to see the entry. */
	month: CalDate;
}

/**
 * Read one `date-list`/`date-range`/`datetime` entry back into a selection, so
 * tapping it in the list puts it back on the grid. `null` when the text is not
 * a date at all — a recurrence rule, or something hand-written and unparseable.
 */
export function readDateEntry(raw: string): DateEntryEdit | null {
	const span = parseSpan(raw);
	if (!span) return null;
	const oneDay = sameDay(span.start, span.end);
	return {
		selection: oneDay
			? { start: stripTime(span.start) }
			: { start: stripTime(span.start), end: stripTime(span.end) },
		time: oneDay ? formatClock(span.start) : '',
		month: stripTime(span.start),
	};
}

/** `list` with `raw` put back at `index` (appended when `index` is past the end). */
export function insertDateEntry(list: readonly string[], index: number, raw: string): string[] {
	const next = [...list];
	next.splice(Math.min(Math.max(index, 0), next.length), 0, raw);
	return next;
}
