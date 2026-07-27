// The one date/time formatting pipeline every rendered date goes through.
// Spec: docs/specs/i18n-and-dates.md §2. Display only — the stored Markdown
// value never changes; only its presentation does.

import type { CalDate, DateSpan } from '../model/dates';
import { RANGE_SEPARATOR, dayKey, daysBetween, formatDate as formatBuiltIn, today } from '../model/dates';
import { currentLanguage, type Lang } from './index';
import { dateTimeFormat, relativeTimeFormat } from './intl';

export type DateFormatMode = 'system' | 'built-in' | 'relative' | 'custom';

export interface DateTimeOpts {
	dateFormat: DateFormatMode;
	timeFormat: DateFormatMode;
	datePattern?: string;
	timePattern?: string;
	lang: Lang;
}

/** Reads the settings this pipeline needs, resolved against the current UI language. */
export function dateTimeOptsFor(settings: {
	dateFormat: DateFormatMode;
	timeFormat: DateFormatMode;
	datePattern?: string;
	timePattern?: string;
}): DateTimeOpts {
	return {
		dateFormat: settings.dateFormat,
		timeFormat: settings.timeFormat,
		datePattern: settings.datePattern,
		timePattern: settings.timePattern,
		lang: currentLanguage(),
	};
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function builtInTime(minutes: number): string {
	return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A calendar date/time as a local-time-zone `Date`, never through a UTC epoch or a string. */
function toNativeDate(date: CalDate): Date {
	const hour = date.minutes !== undefined ? Math.floor(date.minutes / 60) : 0;
	const minute = date.minutes !== undefined ? date.minutes % 60 : 0;
	return new Date(date.y, date.m - 1, date.d, hour, minute);
}

function toNativeTime(minutes: number): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minutes / 60), minutes % 60);
}

interface MomentFactory {
	(input?: {
		year?: number;
		month?: number;
		date?: number;
		hour?: number;
		minute?: number;
	}): { format(pattern: string): string };
	/** Present in Obsidian's bundled moment; absent under plain Node (tests). */
	localeData?(lang?: string): { firstDayOfWeek(): number } | null;
}

/** `window.moment`, guarded so this module stays importable under plain Node (tests). */
function hostMoment(): MomentFactory | undefined {
	return typeof window !== 'undefined'
		? (window as { moment?: MomentFactory }).moment
		: undefined;
}

/**
 * The `weekStart` setting: an explicit weekday number (0 = Sunday … 6 =
 * Saturday, the `Date.getDay()` numbering the model already uses) or `auto`,
 * which follows the locale's own convention (i18n-and-dates.md §2.6).
 */
export type WeekStart = 'auto' | 0 | 1 | 2 | 3 | 4 | 5 | 6;

const isWeekday = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

/**
 * Which day the calendar's week grid starts on. `auto` reads the locale of the
 * **plugin's** language rather than Obsidian's ambient one, like the rest of
 * this module, and falls back to Monday when moment is unavailable (tests) or
 * the locale carries no data. Anything unexpected in the stored setting is
 * treated as `auto` rather than allowed to skew the grid.
 */
export function resolveWeekStart(setting: WeekStart | undefined, lang: Lang = currentLanguage()): number {
	if (isWeekday(setting)) return setting;
	try {
		const day = hostMoment()?.localeData?.(lang)?.firstDayOfWeek();
		return isWeekday(day) ? day : 1;
	} catch {
		return 1;
	}
}

/** A weekday's name in the given language. `day` is 0 = Sunday … 6 = Saturday. */
export function weekdayName(day: number, lang: Lang, width: 'long' | 'short' = 'long'): string {
	// 2024-01-07 was a Sunday, so it anchors the names to weekday numbers.
	return dateTimeFormat(lang, { weekday: width }).format(new Date(2024, 0, 7 + day));
}

function formatCustomDate(date: CalDate, pattern: string | undefined): string {
	if (!pattern) return dayKey(date);
	const moment = hostMoment();
	if (!moment) return dayKey(date);
	try {
		return moment({ year: date.y, month: date.m - 1, date: date.d }).format(pattern);
	} catch {
		return dayKey(date);
	}
}

function formatCustomTime(minutes: number, pattern: string | undefined): string {
	if (!pattern) return builtInTime(minutes);
	const moment = hostMoment();
	if (!moment) return builtInTime(minutes);
	try {
		return moment({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).format(pattern);
	} catch {
		return builtInTime(minutes);
	}
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH_APPROX = 30 * DAY;
const YEAR_APPROX = 365 * DAY;

/**
 * "in 3 days" / "3 days ago". Unit picked by magnitude (§2.2); verified
 * empirically that `Intl.RelativeTimeFormat('ru', …)` already pluralizes
 * correctly (день/дня/дней) — no separate `Intl.PluralRules` table needed.
 *
 * A date with **no time** is compared by **calendar day**, not by millisecond
 * distance from the current instant: comparing a date's midnight against
 * "right now" (which carries whatever hour it happens to be) would make
 * "tomorrow" read as "in 12 hours" depending on when you looked. A date that
 * **does** carry a time is compared against the instant, so an event later
 * today can read "in 3 hours".
 */
function formatRelativeDate(date: CalDate, lang: Lang): string {
	const rtf = relativeTimeFormat(lang);
	if (date.minutes === undefined) {
		const diffDays = daysBetween(date, today());
		const abs = Math.abs(diffDays);
		if (abs < 7) return rtf.format(diffDays, 'day');
		if (abs < 30) return rtf.format(Math.round(diffDays / 7), 'week');
		if (abs < 365) return rtf.format(Math.round(diffDays / 30), 'month');
		return rtf.format(Math.round(diffDays / 365), 'year');
	}
	const diffMs = toNativeDate(date).getTime() - Date.now();
	const abs = Math.abs(diffMs);
	if (abs < HOUR) return rtf.format(Math.round(diffMs / MINUTE), 'minute');
	if (abs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
	if (abs < WEEK) return rtf.format(Math.round(diffMs / DAY), 'day');
	if (abs < MONTH_APPROX) return rtf.format(Math.round(diffMs / WEEK), 'week');
	if (abs < YEAR_APPROX) return rtf.format(Math.round(diffMs / MONTH_APPROX), 'month');
	return rtf.format(Math.round(diffMs / YEAR_APPROX), 'year');
}

/** The date half of a `CalDate`, in the chosen mode. */
export function formatDatePart(date: CalDate, opts: DateTimeOpts): string {
	switch (opts.dateFormat) {
		case 'system':
			return dateTimeFormat(opts.lang, { dateStyle: 'medium' }).format(toNativeDate(date));
		case 'built-in':
			return dayKey(date);
		case 'relative':
			return formatRelativeDate(date, opts.lang);
		case 'custom':
			return formatCustomDate(date, opts.datePattern);
	}
}

/** A bare time of day, in the chosen mode. `relative` has no date to be relative
 * to, so it falls back to `built-in` (§2.1). */
export function formatTimePart(minutes: number, opts: DateTimeOpts): string {
	switch (opts.timeFormat) {
		case 'system':
			return dateTimeFormat(opts.lang, { timeStyle: 'short' }).format(toNativeTime(minutes));
		case 'built-in':
			return builtInTime(minutes);
		case 'relative':
			return builtInTime(minutes);
		case 'custom':
			return formatCustomTime(minutes, opts.timePattern);
	}
}

/** A full `CalDate`, date part plus time part when it carries one. */
export function formatCalDate(date: CalDate, opts: DateTimeOpts): string {
	const datePart = formatDatePart(date, opts);
	if (date.minutes === undefined) return datePart;
	return `${datePart} ${formatTimePart(date.minutes, opts)}`;
}

/**
 * Always both ends, even for a one-day span (dates.ts:formatSpan's invariant
 * carries over): a `date-range` that reads `d → d` must still read that way.
 */
export function formatCalSpan(span: DateSpan, opts: DateTimeOpts): string {
	return `${formatCalDate(span.start, opts)}${RANGE_SEPARATOR}${formatCalDate(span.end, opts)}`;
}

/**
 * The absolute, unambiguous form — always `built-in` — for a tooltip whenever
 * the visible form is relative or an abbreviated custom pattern. Nothing is
 * ever lost, just not shown by default.
 */
export function absoluteTooltip(date: CalDate): string {
	return formatBuiltIn(date);
}
