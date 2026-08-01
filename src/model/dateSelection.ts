// Pure selection and month-grid helpers for the card property's calendar.

import {
	addDays,
	compareDates,
	startOfMonth,
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
