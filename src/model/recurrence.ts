// Repetition rules: the readable phrase, its model, and its expansion.
// Spec: docs/specs/recurrence.md. Pure; no `obsidian` imports.
//
// The value stored in a card is a phrase — `every 2 weeks on Mon, Wed from
// 2026-07-27` — not an iCalendar RRULE, because `;` is the property list
// separator and the file is meant to be hand-editable (§1). The grammar maps
// onto RRULE one-to-one, so an exporter stays possible.

import {
	CalDate,
	addDays,
	compareDates,
	daysInMonth,
	formatDate,
	parseDate,
	toOrdinal,
	weekday,
} from './dates';

export type Freq = 'day' | 'week' | 'month' | 'year';

export interface Recurrence {
	freq: Freq;
	/** Periods between occurrences, ≥ 1. */
	interval: number;
	/** Weekly: 0 = Sunday … 6 = Saturday, ascending. */
	weekdays?: number[];
	/** Monthly: day of month, 1–31. */
	monthDay?: number;
	/** Monthly: "the second Tuesday"; `-1` is "last". */
	nth?: { ordinal: 1 | 2 | 3 | 4 | -1; weekday: number };
	/** Yearly: 1–12. */
	month?: number;
	/** Yearly: 1–31. */
	day?: number;
	/** `from` — the series anchor; absent means "resolve it" (§1.2). */
	start?: CalDate;
	/** `until`, inclusive. */
	until?: CalDate;
	/** `for N times`, counted from the first occurrence. */
	count?: number;
}

/** Guard against a rule that would otherwise expand without end (§2.1). */
export const EXPANSION_CAP = 400;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];
const ORDINALS: Record<string, 1 | 2 | 3 | 4 | -1> = {
	first: 1,
	second: 2,
	third: 3,
	fourth: 4,
	last: -1,
};

/** Monday-first order, which is how the canonical phrase lists weekdays. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayFrom(word: string): number | null {
	const w = word.toLowerCase();
	const full = WEEKDAY_FULL.indexOf(w);
	if (full !== -1) return full;
	const short = WEEKDAY_FULL.findIndex((name) => name.slice(0, 3) === w);
	return short === -1 ? null : short;
}

function monthFrom(word: string): number | null {
	const w = word.toLowerCase();
	const full = MONTH_FULL.indexOf(w);
	if (full !== -1) return full + 1;
	const short = MONTH_FULL.findIndex((name) => name.slice(0, 3) === w);
	return short === -1 ? null : short + 1;
}

// --- parsing ----------------------------------------------------------------

const HEAD_RE = /^every(?:\s+(\d+))?\s+(day|days|week|weeks|month|months|year|years)\b/i;
const SECTION_RE = /\b(on|from|until|for)\b/gi;

const UNITS: Record<string, Freq> = {
	day: 'day',
	days: 'day',
	week: 'week',
	weeks: 'week',
	month: 'month',
	months: 'month',
	year: 'year',
	years: 'year',
};

/** Split the tail into its `on` / `from` / `until` / `for` sections. */
function sections(rest: string): Map<string, string> | null {
	const found = new Map<string, string>();
	const marks: { key: string; at: number; end: number }[] = [];
	SECTION_RE.lastIndex = 0;
	for (let m = SECTION_RE.exec(rest); m; m = SECTION_RE.exec(rest)) {
		marks.push({ key: m[1]!.toLowerCase(), at: m.index, end: m.index + m[0].length });
	}
	// Anything before the first keyword is not part of the grammar.
	if (marks.length === 0) return rest.trim() === '' ? found : null;
	if (rest.slice(0, marks[0]!.at).trim() !== '') return null;

	marks.forEach((mark, i) => {
		const next = marks[i + 1];
		const value = rest.slice(mark.end, next ? next.at : rest.length).trim();
		if (found.has(mark.key)) return;
		found.set(mark.key, value);
	});
	return found;
}

/** Parse an `on …` clause against the frequency it belongs to. */
function parseOn(text: string, freq: Freq, rule: Recurrence): boolean {
	if (freq === 'week') {
		const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
		if (parts.length === 0) return false;
		const days: number[] = [];
		for (const part of parts) {
			const day = weekdayFrom(part);
			if (day === null) return false;
			if (!days.includes(day)) days.push(day);
		}
		rule.weekdays = days.sort((a, b) => a - b);
		return true;
	}

	if (freq === 'month') {
		const byDay = /^day\s+(\d{1,2})$/i.exec(text);
		if (byDay) {
			const day = Number(byDay[1]);
			if (day < 1 || day > 31) return false;
			rule.monthDay = day;
			return true;
		}
		const byNth = /^the\s+(first|second|third|fourth|last)\s+(\w+)$/i.exec(text);
		if (byNth) {
			const ordinal = ORDINALS[byNth[1]!.toLowerCase()];
			const day = weekdayFrom(byNth[2]!);
			if (ordinal === undefined || day === null) return false;
			rule.nth = { ordinal, weekday: day };
			return true;
		}
		return false;
	}

	if (freq === 'year') {
		const byDate = /^(\w+)\s+(\d{1,2})$/.exec(text);
		if (!byDate) return false;
		const month = monthFrom(byDate[1]!);
		const day = Number(byDate[2]);
		if (month === null || day < 1 || day > daysInMonth(2024, month)) return false;
		rule.month = month;
		rule.day = day;
		return true;
	}

	// A daily rule has nothing to qualify.
	return false;
}

/**
 * Parse a phrase into a rule, or `null` when it is not one. An unparseable
 * value is never an error: the card keeps its text and reads as having no rule
 * (§1.1).
 */
export function parseRecurrence(text: string): Recurrence | null {
	const trimmed = text.trim().replace(/\s+/g, ' ');
	const head = HEAD_RE.exec(trimmed);
	if (!head) return null;

	const freq = UNITS[head[2]!.toLowerCase()];
	if (!freq) return null;
	const interval = head[1] === undefined ? 1 : Number(head[1]);
	if (!Number.isInteger(interval) || interval < 1) return null;

	const parts = sections(trimmed.slice(head[0].length));
	if (!parts) return null;

	const rule: Recurrence = { freq, interval };

	const on = parts.get('on');
	if (on !== undefined && !parseOn(on, freq, rule)) return null;

	const from = parts.get('from');
	if (from !== undefined) {
		const start = parseDate(from);
		if (!start) return null;
		rule.start = start;
	}

	const until = parts.get('until');
	if (until !== undefined) {
		const end = parseDate(until);
		if (!end) return null;
		rule.until = end;
	}

	const times = parts.get('for');
	if (times !== undefined) {
		const match = /^(\d+)\s+times?$/i.exec(times);
		if (!match) return null;
		const count = Number(match[1]);
		if (count < 1) return null;
		rule.count = count;
	}

	// "until" and "for N times" are two ways to end; carrying both is ambiguous.
	if (rule.until && rule.count !== undefined) return null;
	return rule;
}

/** The canonical phrase — `parseRecurrence(formatRecurrence(r))` equals `r`. */
export function formatRecurrence(rule: Recurrence): string {
	const unit = rule.interval === 1 ? rule.freq : `${rule.freq}s`;
	let out = rule.interval === 1 ? `every ${unit}` : `every ${String(rule.interval)} ${unit}`;

	if (rule.freq === 'week' && rule.weekdays?.length) {
		const names = WEEK_ORDER.filter((d) => rule.weekdays?.includes(d)).map((d) => WEEKDAY_NAMES[d]);
		out += ` on ${names.join(', ')}`;
	} else if (rule.freq === 'month' && rule.monthDay !== undefined) {
		out += ` on day ${String(rule.monthDay)}`;
	} else if (rule.freq === 'month' && rule.nth) {
		const ordinal = Object.keys(ORDINALS).find((key) => ORDINALS[key] === rule.nth?.ordinal) ?? 'first';
		const name = WEEKDAY_FULL[rule.nth.weekday] ?? 'monday';
		out += ` on the ${ordinal} ${name[0]!.toUpperCase()}${name.slice(1)}`;
	} else if (rule.freq === 'year' && rule.month !== undefined && rule.day !== undefined) {
		out += ` on ${MONTH_NAMES[rule.month - 1] ?? 'Jan'} ${String(rule.day)}`;
	}

	if (rule.start) out += ` from ${formatDate(rule.start)}`;
	if (rule.until) out += ` until ${formatDate(rule.until)}`;
	else if (rule.count !== undefined) {
		out += ` for ${String(rule.count)} ${rule.count === 1 ? 'time' : 'times'}`;
	}
	return out;
}

/**
 * Move the whole series by `delta` days (recurrence.md §3.1). The parts that
 * name a day — the weekday set, the day of month, the yearly date — are
 * recomputed from the new anchor, so the phrase keeps describing what the
 * calendar shows. `until` is a boundary the user set and does not move.
 */
export function shiftRecurrence(rule: Recurrence, anchor: CalDate, delta: number): Recurrence {
	const start = addDays(rule.start ?? anchor, delta);
	const next: Recurrence = { ...rule, start };
	if (rule.freq === 'week' && rule.weekdays?.length) {
		next.weekdays = rule.weekdays
			.map((day) => (((day + delta) % 7) + 7) % 7)
			.sort((a, b) => a - b);
	}
	if (rule.freq === 'month') {
		if (rule.monthDay !== undefined) next.monthDay = start.d;
		if (rule.nth) {
			next.nth = {
				// "Last" stays "last"; a numbered one is re-read from the new date.
				ordinal: rule.nth.ordinal === -1 ? -1 : (Math.min(4, Math.ceil(start.d / 7)) as 1 | 2 | 3 | 4),
				weekday: weekday(start),
			};
		}
	}
	if (rule.freq === 'year' && rule.month !== undefined) {
		next.month = start.m;
		next.day = start.d;
	}
	return next;
}

/**
 * A rule that fires on exactly one day. It is what a calendar driven by a
 * `recurrence` property writes when a card is given a day by the composer or a
 * drag out of the tray: inventing a frequency would be worse, and this reads in
 * the form as "daily, ends after 1 time" — an obvious thing to edit.
 */
export function singleDayRule(day: CalDate): Recurrence {
	return { freq: 'day', interval: 1, start: day, count: 1 };
}

/** True iff the phrase parses; used to tell a rule from any other text. */
export function isRecurrence(text: string): boolean {
	return parseRecurrence(text) !== null;
}

// --- expansion --------------------------------------------------------------

/** The nth (or last) weekday of a month; `null` when the month has no such day. */
function nthWeekdayOf(y: number, m: number, ordinal: number, day: number): CalDate | null {
	if (ordinal === -1) {
		const last = { y, m, d: daysInMonth(y, m) };
		return addDays(last, -(((weekday(last) - day) % 7 + 7) % 7));
	}
	const first = { y, m, d: 1 };
	const offset = ((day - weekday(first)) % 7 + 7) % 7;
	const date = { y, m, d: 1 + offset + (ordinal - 1) * 7 };
	return date.d > daysInMonth(y, m) ? null : date;
}

/** Occurrences of one period, ascending; a period may host none (skipped). */
function periodDates(rule: Recurrence, anchor: CalDate, index: number): CalDate[] {
	switch (rule.freq) {
		case 'day':
			return [addDays(anchor, index * rule.interval)];
		case 'week': {
			const weekStart = addDays(anchor, index * 7 * rule.interval);
			const days = rule.weekdays?.length ? rule.weekdays : [weekday(anchor)];
			// The week runs from the anchor's own weekday, so the file's meaning
			// never depends on the reader's locale (§2.1).
			return days
				.map((day) => addDays(weekStart, ((day - weekday(weekStart)) % 7 + 7) % 7))
				.sort(compareDates);
		}
		case 'month': {
			const total = anchor.y * 12 + (anchor.m - 1) + index * rule.interval;
			const y = Math.floor(total / 12);
			const m = total - y * 12 + 1;
			if (rule.nth) {
				const date = nthWeekdayOf(y, m, rule.nth.ordinal, rule.nth.weekday);
				return date ? [date] : [];
			}
			const day = rule.monthDay ?? anchor.d;
			// A month that cannot host the day is skipped, not clamped (§2.1).
			return day > daysInMonth(y, m) ? [] : [{ y, m, d: day }];
		}
		case 'year': {
			const y = anchor.y + index * rule.interval;
			const m = rule.month ?? anchor.m;
			const d = rule.day ?? anchor.d;
			return d > daysInMonth(y, m) ? [] : [{ y, m, d }];
		}
	}
}

/** How many periods to skip to reach `from` without walking them one by one. */
function firstPeriod(rule: Recurrence, anchor: CalDate, from: CalDate): number {
	const ahead = (value: number): number => Math.max(0, Math.floor(value));
	switch (rule.freq) {
		case 'day':
			return ahead((toOrdinal(from) - toOrdinal(anchor)) / rule.interval);
		case 'week':
			return ahead((toOrdinal(from) - toOrdinal(anchor)) / (7 * rule.interval));
		case 'month': {
			const months = (from.y - anchor.y) * 12 + (from.m - anchor.m);
			return ahead(months / rule.interval);
		}
		case 'year':
			return ahead((from.y - anchor.y) / rule.interval);
	}
}

function withTime(date: CalDate, anchor: CalDate): CalDate {
	return anchor.minutes === undefined ? date : { ...date, minutes: anchor.minutes };
}

/**
 * Occurrences in `[from, to]`, ascending. `anchor` is the resolved series start
 * (`rule.start` when it has one — see §1.2 for the rest).
 */
export function expandRecurrence(
	rule: Recurrence,
	anchor: CalDate,
	from: CalDate,
	to: CalDate,
	limit = EXPANSION_CAP,
): CalDate[] {
	const start = rule.start ?? anchor;
	const out: CalDate[] = [];
	if (compareDates(from, to) > 0) return out;

	// A `count` has to be honoured from the first occurrence, so the walk starts
	// at period 0; without one it jumps straight to the window. Periods ascend,
	// so the first date past `to` ends the walk either way.
	const counted = rule.count !== undefined;
	let period = counted ? 0 : firstPeriod(rule, start, from);
	let produced = 0;
	// Skipped periods are real (`every month on day 31`, `every year on Feb 29`),
	// but a long run of them means the rule can never fire again.
	let skipped = 0;

	while (out.length < limit && skipped < 100) {
		const dates = periodDates(rule, start, period);
		period++;
		if (dates.length === 0) {
			skipped++;
			continue;
		}
		skipped = 0;
		for (const date of dates) {
			// Bounds are compared by day: an occurrence at 09:30 still belongs to a
			// window whose last day carries no time.
			const day = toOrdinal(date);
			if (day < toOrdinal(start)) continue;
			if (rule.until && day > toOrdinal(rule.until)) return out;
			if (counted && produced >= (rule.count ?? 0)) return out;
			produced++;
			if (day < toOrdinal(from)) continue;
			if (day > toOrdinal(to)) return out;
			out.push(withTime(date, start));
			if (out.length >= limit) return out;
		}
	}
	return out;
}

/** The first occurrence strictly after `after`, or `null` when the series ends. */
export function nextOccurrence(
	rule: Recurrence,
	anchor: CalDate,
	after: CalDate,
	horizonYears = 20,
): CalDate | null {
	const from = addDays(after, 1);
	const to = { y: from.y + horizonYears, m: from.m, d: from.d };
	return expandRecurrence(rule, anchor, from, to, 1)[0] ?? null;
}

/**
 * The sentence the rule form previews. English for now; M11 localizes what is
 * shown without touching what is stored (§5).
 */
export function describeRecurrence(rule: Recurrence): string {
	return formatRecurrence(rule);
}
