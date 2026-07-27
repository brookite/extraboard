// The one date/time formatting pipeline. Spec: docs/specs/i18n-and-dates.md §2.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	formatDatePart,
	formatTimePart,
	formatCalDate,
	formatCalSpan,
	absoluteTooltip,
	dateTimeOptsFor,
	type DateTimeOpts,
} from '../src/i18n/dates';
import type { CalDate } from '../src/model/dates';

const DUE: CalDate = { y: 2026, m: 7, d: 27 };
const DUE_TIMED: CalDate = { y: 2026, m: 7, d: 27, minutes: 9 * 60 + 5 };

function opts(over: Partial<DateTimeOpts> = {}): DateTimeOpts {
	return { dateFormat: 'built-in', timeFormat: 'built-in', lang: 'en', ...over };
}

describe('formatDatePart', () => {
	it('built-in is the stable YYYY-MM-DD form, unaffected by locale', () => {
		expect(formatDatePart(DUE, opts({ dateFormat: 'built-in', lang: 'en' }))).toBe('2026-07-27');
		expect(formatDatePart(DUE, opts({ dateFormat: 'built-in', lang: 'ru' }))).toBe('2026-07-27');
	});

	it('system follows Intl.DateTimeFormat in the resolved language', () => {
		const en = formatDatePart(DUE, opts({ dateFormat: 'system', lang: 'en' }));
		const ru = formatDatePart(DUE, opts({ dateFormat: 'system', lang: 'ru' }));
		expect(en).not.toBe(ru);
		expect(en.length).toBeGreaterThan(0);
	});

	it('custom falls back to built-in when there is no window.moment (e.g. under Node)', () => {
		expect(formatDatePart(DUE, opts({ dateFormat: 'custom', datePattern: 'DD.MM.YYYY' }))).toBe(
			'2026-07-27',
		);
	});

	it('custom falls back to built-in when the pattern is empty', () => {
		expect(formatDatePart(DUE, opts({ dateFormat: 'custom', datePattern: '' }))).toBe('2026-07-27');
	});
});

describe('formatTimePart', () => {
	it('built-in is 24-hour HH:mm', () => {
		expect(formatTimePart(9 * 60 + 5, opts({ timeFormat: 'built-in' }))).toBe('09:05');
		expect(formatTimePart(23 * 60 + 59, opts({ timeFormat: 'built-in' }))).toBe('23:59');
	});

	it('system follows Intl.DateTimeFormat in the resolved language', () => {
		const en = formatTimePart(9 * 60 + 5, opts({ timeFormat: 'system', lang: 'en' }));
		const ru = formatTimePart(9 * 60 + 5, opts({ timeFormat: 'system', lang: 'ru' }));
		expect(en.length).toBeGreaterThan(0);
		expect(ru.length).toBeGreaterThan(0);
	});

	it('relative has no date to be relative to, so it behaves as built-in', () => {
		expect(formatTimePart(9 * 60 + 5, opts({ timeFormat: 'relative' }))).toBe('09:05');
	});

	it('custom falls back to built-in without window.moment', () => {
		expect(formatTimePart(9 * 60 + 5, opts({ timeFormat: 'custom', timePattern: 'HH.mm' }))).toBe(
			'09:05',
		);
	});
});

describe('relative dates', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 27, 12, 0));
	});
	afterEach(() => vi.useRealTimers());

	it('picks the unit by magnitude and reads naturally in English', () => {
		expect(formatDatePart({ y: 2026, m: 7, d: 30 }, opts({ dateFormat: 'relative', lang: 'en' }))).toBe(
			'in 3 days',
		);
		expect(formatDatePart({ y: 2026, m: 7, d: 24 }, opts({ dateFormat: 'relative', lang: 'en' }))).toBe(
			'3 days ago',
		);
	});

	it('pluralizes correctly in Russian (день/дня/дней) via Intl.RelativeTimeFormat', () => {
		expect(formatDatePart({ y: 2026, m: 7, d: 28 }, opts({ dateFormat: 'relative', lang: 'ru' }))).toBe(
			'завтра',
		);
		expect(formatDatePart({ y: 2026, m: 7, d: 30 }, opts({ dateFormat: 'relative', lang: 'ru' }))).toBe(
			'через 3 дня',
		);
		expect(formatDatePart({ y: 2026, m: 8, d: 1 }, opts({ dateFormat: 'relative', lang: 'ru' }))).toBe(
			'через 5 дней',
		);
	});

	it('renders a value more than a year away rather than clamping it', () => {
		const farFuture = formatDatePart(
			{ y: 2028, m: 1, d: 27 },
			opts({ dateFormat: 'relative', lang: 'en' }),
		);
		expect(farFuture).toContain('year');
	});
});

describe('formatCalDate', () => {
	it('appends the time part only when the date carries one', () => {
		expect(formatCalDate(DUE, opts())).toBe('2026-07-27');
		expect(formatCalDate(DUE_TIMED, opts())).toBe('2026-07-27 09:05');
	});
});

describe('formatCalSpan', () => {
	it('never collapses a one-day span', () => {
		expect(formatCalSpan({ start: DUE, end: DUE }, opts())).toBe('2026-07-27 → 2026-07-27');
	});

	it('formats both ends independently', () => {
		expect(
			formatCalSpan({ start: DUE, end: { y: 2026, m: 7, d: 29 } }, opts()),
		).toBe('2026-07-27 → 2026-07-29');
	});
});

describe('absoluteTooltip', () => {
	it('is always the built-in form, regardless of the configured mode', () => {
		expect(absoluteTooltip(DUE_TIMED)).toBe('2026-07-27 09:05');
	});
});

describe('dateTimeOptsFor', () => {
	it('threads the settings through and resolves the current language', () => {
		const resolved = dateTimeOptsFor({
			dateFormat: 'custom',
			timeFormat: 'system',
			datePattern: 'DD.MM',
			timePattern: undefined,
		});
		expect(resolved).toMatchObject({
			dateFormat: 'custom',
			timeFormat: 'system',
			datePattern: 'DD.MM',
		});
		expect(['en', 'ru']).toContain(resolved.lang);
	});
});
