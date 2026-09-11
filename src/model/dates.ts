// The minimal date reader the calendar view places cards with.
// Spec: docs/specs/calendar-view.md §1. Pure; no `obsidian` imports.
//
// A date here is a **calendar date, not an instant**: `{ y, m, d, minutes? }`
// with no timezone anywhere. Day arithmetic runs on a day ordinal (days since
// 1970-01-01) rather than through `Date`, so a board shows the same days
// wherever it is opened and nothing shifts across a DST boundary.
//
// M9 replaces this with the structured date family (recurrence included); until
// then the model keeps date values as raw text and this module interprets it.

export interface CalDate {
	/** Full year. */
	y: number;
	/** Month, 1–12. */
	m: number;
	/** Day of month, 1–31. */
	d: number;
	/** Minutes since midnight when the value carried a time. */
	minutes?: number;
}

/** A single-day date or an inclusive range. */
export interface DateSpan {
	start: CalDate;
	end: CalDate;
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

/** Range separators accepted on input; `" → "` is what the plugin writes. */
const RANGE_RE = /\s*(?:→|->|\.\.|–|—)\s*/;

export const RANGE_SEPARATOR = ' → ';

// --- day arithmetic ---------------------------------------------------------

/** Days since 1970-01-01 (Howard Hinnant's civil algorithm; proleptic Gregorian). */
export function toOrdinal(date: CalDate): number {
	const y = date.y - (date.m <= 2 ? 1 : 0);
	const era = Math.floor(y / 400);
	const yoe = y - era * 400;
	const mp = (date.m + 9) % 12;
	const doy = Math.floor((153 * mp + 2) / 5) + date.d - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

/** Inverse of {@link toOrdinal}; the result carries no time. */
export function fromOrdinal(days: number): CalDate {
	const z = days + 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const m = mp < 10 ? mp + 3 : mp - 9;
	return { y: y + (m <= 2 ? 1 : 0), m, d };
}

export function addDays(date: CalDate, days: number): CalDate {
	const next = fromOrdinal(toOrdinal(date) + days);
	return date.minutes === undefined ? next : { ...next, minutes: date.minutes };
}

/** Day difference `a - b`, ignoring any time. */
export function daysBetween(a: CalDate, b: CalDate): number {
	return toOrdinal(a) - toOrdinal(b);
}

export function sameDay(a: CalDate, b: CalDate): boolean {
	return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Compare by day, then by time (a value without a time sorts first). */
export function compareDates(a: CalDate, b: CalDate): number {
	const day = toOrdinal(a) - toOrdinal(b);
	if (day !== 0) return day;
	return (a.minutes ?? -1) - (b.minutes ?? -1);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: CalDate): number {
	return (((toOrdinal(date) + 4) % 7) + 7) % 7;
}

export function startOfWeek(date: CalDate, firstDay: number): CalDate {
	const shift = (((weekday(date) - firstDay) % 7) + 7) % 7;
	return addDays(stripTime(date), -shift);
}

export function startOfMonth(date: CalDate): CalDate {
	return { y: date.y, m: date.m, d: 1 };
}

export function addMonths(date: CalDate, months: number): CalDate {
	const total = date.y * 12 + (date.m - 1) + months;
	const y = Math.floor(total / 12);
	const m = total - y * 12 + 1;
	return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

export function daysInMonth(y: number, m: number): number {
	const next = m === 12 ? { y: y + 1, m: 1, d: 1 } : { y, m: m + 1, d: 1 };
	return toOrdinal(next) - toOrdinal({ y, m, d: 1 });
}

export function stripTime(date: CalDate): CalDate {
	return date.minutes === undefined ? date : { y: date.y, m: date.m, d: date.d };
}

/** Today, as a calendar date in the user's own timezone. */
export function today(now: Date = new Date()): CalDate {
	return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

// --- parsing and formatting -------------------------------------------------

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` — the key a day cell is indexed by. */
export function dayKey(date: CalDate): string {
	return `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}`;
}

/** Canonical text of a date, with ` HH:mm` only when it carries a time. */
export function formatDate(date: CalDate): string {
	const day = dayKey(date);
	if (date.minutes === undefined) return day;
	return `${day} ${pad(Math.floor(date.minutes / 60))}:${pad(date.minutes % 60)}`;
}

/**
 * Always the two-ended form, even for one day: a `date-range` property that
 * reads `d → d` must stay a range when it moves, and the callers that want the
 * short form ask for `formatDate` instead.
 */
export function formatSpan(span: DateSpan): string {
	return `${formatDate(span.start)}${RANGE_SEPARATOR}${formatDate(span.end)}`;
}

/** `HH:mm` when the date carries a time, `''` when it does not. */
export function formatClock(date: CalDate): string {
	if (date.minutes === undefined) return '';
	return `${pad(Math.floor(date.minutes / 60))}:${pad(date.minutes % 60)}`;
}

/** Parse one date; `null` when the text is not one (§1.1 — never an error). */
export function parseDate(raw: string): CalDate | null {
	const match = DATE_RE.exec(raw.trim());
	if (!match) return null;
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
	const date: CalDate = { y, m, d };
	if (match[4] !== undefined && match[5] !== undefined) {
		const hours = Number(match[4]);
		const mins = Number(match[5]);
		if (hours > 23 || mins > 59) return null;
		date.minutes = hours * 60 + mins;
	}
	return date;
}

/**
 * Parse a date or a range into an inclusive span. A reversed range is
 * normalized by swapping its ends rather than dropped.
 */
export function parseSpan(raw: string): DateSpan | null {
	const text = raw.trim();
	if (!text) return null;
	const parts = text.split(RANGE_RE);
	if (parts.length === 1) {
		const only = parseDate(text);
		return only ? { start: only, end: only } : null;
	}
	if (parts.length !== 2) return null;
	const start = parseDate(parts[0] ?? '');
	const end = parseDate(parts[1] ?? '');
	if (!start || !end) return null;
	return compareDates(start, end) <= 0 ? { start, end } : { start: end, end: start };
}
