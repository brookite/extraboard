// The localized recurrence sentence a property badge shows. The stored phrase
// itself (`model/recurrence.ts:formatRecurrence`) is untouched — this is only
// the presentation. Spec: docs/specs/i18n-and-dates.md §2.4, recurrence.md §5.

import { describe, it, expect, afterEach } from 'vitest';
import { describeRecurrence } from '../src/i18n/recurrenceText';
import { setLanguage } from '../src/i18n';
import type { Recurrence } from '../src/model/recurrence';
import type { DateTimeOpts } from '../src/i18n/dates';

afterEach(() => setLanguage('en'));

// `t()` reads the ambient language `setLanguage` sets; `opts.lang` (read by
// `Intl.PluralRules` for the freq/count buckets and by `formatCalDate`) always
// mirrors it in real use (`dateTimeOptsFor` derives both from the same
// `currentLanguage()`), so tests keep the two in sync explicitly.
function opts(lang: 'en' | 'ru'): DateTimeOpts {
	setLanguage(lang);
	return { dateFormat: 'built-in', timeFormat: 'built-in', lang };
}

describe('describeRecurrence: frequency + interval', () => {
	it('daily, interval 1', () => {
		const rule: Recurrence = { freq: 'day', interval: 1 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every day');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый день');
	});

	it('daily, interval 3, with a start date', () => {
		const rule: Recurrence = { freq: 'day', interval: 3, start: { y: 2026, m: 7, d: 27 } };
		expect(describeRecurrence(rule, opts('en'))).toBe('every 3 days from 2026-07-27');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждые 3 дня с 2026-07-27');
	});

	it('weekly with a weekday list, Monday-first regardless of input order', () => {
		const rule: Recurrence = { freq: 'week', interval: 1, weekdays: [5, 1, 3] };
		expect(describeRecurrence(rule, opts('en'))).toBe('every week on Mon, Wed, Fri');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждую неделю в Пн, Ср, Пт');
	});

	it('every 2 weeks on one weekday', () => {
		const rule: Recurrence = { freq: 'week', interval: 2, weekdays: [2] };
		expect(describeRecurrence(rule, opts('en'))).toBe('every 2 weeks on Tue');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждые 2 недели в Вт');
	});

	it('every 5 weeks (Russian "many" bucket)', () => {
		const rule: Recurrence = { freq: 'week', interval: 5 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every 5 weeks');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждые 5 недель');
	});

	it('every 2 months (Russian "few" bucket)', () => {
		const rule: Recurrence = { freq: 'month', interval: 2 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every 2 months');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждые 2 месяца');
	});

	it('every year, interval 1', () => {
		const rule: Recurrence = { freq: 'year', interval: 1 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every year');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый год');
	});
});

describe('describeRecurrence: monthly and yearly "on" clauses', () => {
	it('monthly by day of month', () => {
		const rule: Recurrence = { freq: 'month', interval: 1, monthDay: 15 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every month on day 15');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый месяц 15 числа');
	});

	it('monthly by nth weekday (last Friday)', () => {
		const rule: Recurrence = { freq: 'month', interval: 1, nth: { ordinal: -1, weekday: 5 } };
		expect(describeRecurrence(rule, opts('en'))).toBe('every month on the last Friday');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый месяц — последняя: пятница');
	});

	it('monthly by nth weekday (2nd Tuesday)', () => {
		const rule: Recurrence = { freq: 'month', interval: 1, nth: { ordinal: 2, weekday: 2 } };
		expect(describeRecurrence(rule, opts('en'))).toBe('every month on the 2nd Tuesday');
	});

	it('yearly on a specific month and day', () => {
		const rule: Recurrence = { freq: 'year', interval: 1, month: 7, day: 4 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every year on July 4');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый год 4 июля');
	});
});

describe('describeRecurrence: end conditions', () => {
	it('until a date', () => {
		const rule: Recurrence = { freq: 'week', interval: 1, until: { y: 2026, m: 12, d: 31 } };
		expect(describeRecurrence(rule, opts('en'))).toBe('every week until 2026-12-31');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждую неделю до 2026-12-31');
	});

	it('for 1 time', () => {
		const rule: Recurrence = { freq: 'day', interval: 1, count: 1 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every day for 1 time');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый день 1 раз');
	});

	it('for a "few" count (Russian 2-4)', () => {
		const rule: Recurrence = { freq: 'day', interval: 1, count: 2 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every day for 2 times');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый день 2 раза');
	});

	it('for a "many" count (Russian 5+)', () => {
		const rule: Recurrence = { freq: 'day', interval: 1, count: 10 };
		expect(describeRecurrence(rule, opts('en'))).toBe('every day for 10 times');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждый день 10 раз');
	});

	it('until takes precedence over count in the sentence when both would apply', () => {
		// Not a real rule (parseRecurrence rejects carrying both), but the
		// function itself just prioritizes `until`, matching formatRecurrence.
		const rule: Recurrence = {
			freq: 'day',
			interval: 1,
			until: { y: 2026, m: 12, d: 31 },
			count: 5,
		};
		expect(describeRecurrence(rule, opts('en'))).toBe('every day until 2026-12-31');
	});
});

describe('describeRecurrence: dates route through the shared formatter', () => {
	it('the start/until dates honor the configured dateFormat', () => {
		const rule: Recurrence = {
			freq: 'day',
			interval: 1,
			start: { y: 2026, m: 7, d: 27 },
			until: { y: 2026, m: 12, d: 31 },
		};
		const custom: DateTimeOpts = { dateFormat: 'built-in', timeFormat: 'built-in', lang: 'en' };
		expect(describeRecurrence(rule, custom)).toBe('every day from 2026-07-27 until 2026-12-31');
	});
});

// The badge's own form (recurrence.md §5): no "every" — its `repeat` icon says
// that — abbreviated units, and no absolute date at all.
describe('describeRecurrence: compact form', () => {
	const compact = { compact: true };

	it('drops "every" and abbreviates the unit', () => {
		const week: Recurrence = { freq: 'week', interval: 1 };
		expect(describeRecurrence(week, opts('en'), compact)).toBe('wk');
		expect(describeRecurrence(week, opts('ru'), compact)).toBe('нед.');

		const month: Recurrence = { freq: 'month', interval: 1 };
		expect(describeRecurrence(month, opts('en'), compact)).toBe('mo');
		expect(describeRecurrence(month, opts('ru'), compact)).toBe('мес.');

		// Day and year are short enough to stay whole in Russian.
		const day: Recurrence = { freq: 'day', interval: 1 };
		expect(describeRecurrence(day, opts('ru'), compact)).toBe('день');
		const year: Recurrence = { freq: 'year', interval: 1 };
		expect(describeRecurrence(year, opts('ru'), compact)).toBe('год');
	});

	it('keeps the interval, still bucketed by the Russian plural rules', () => {
		const two: Recurrence = { freq: 'week', interval: 2 };
		expect(describeRecurrence(two, opts('en'), compact)).toBe('2 wks');
		expect(describeRecurrence(two, opts('ru'), compact)).toBe('2 нед.');

		const twoYears: Recurrence = { freq: 'year', interval: 2 };
		expect(describeRecurrence(twoYears, opts('ru'), compact)).toBe('2 года');
		const fiveYears: Recurrence = { freq: 'year', interval: 5 };
		expect(describeRecurrence(fiveYears, opts('ru'), compact)).toBe('5 лет');
	});

	it('keeps the weekday list', () => {
		const rule: Recurrence = { freq: 'week', interval: 1, weekdays: [2] };
		expect(describeRecurrence(rule, opts('en'), compact)).toBe('wk on Tue');
		expect(describeRecurrence(rule, opts('ru'), compact)).toBe('нед. в Вт');
	});

	it('drops the start date — the tooltip has the full sentence', () => {
		const rule: Recurrence = {
			freq: 'week',
			interval: 1,
			weekdays: [2],
			start: { y: 2026, m: 7, d: 28 },
		};
		expect(describeRecurrence(rule, opts('ru'), compact)).toBe('нед. в Вт');
		expect(describeRecurrence(rule, opts('ru'))).toBe('каждую неделю в Вт с 2026-07-28');
	});

	it('drops the end date too, but keeps a count', () => {
		const until: Recurrence = { freq: 'week', interval: 1, until: { y: 2026, m: 12, d: 31 } };
		expect(describeRecurrence(until, opts('ru'), compact)).toBe('нед.');

		const counted: Recurrence = { freq: 'day', interval: 1, count: 3 };
		expect(describeRecurrence(counted, opts('en'), compact)).toBe('day for 3 times');
		expect(describeRecurrence(counted, opts('ru'), compact)).toBe('день 3 раза');
	});

	it('keeps the monthly clauses, with the weekday of an nth rule abbreviated', () => {
		const monthDay: Recurrence = { freq: 'month', interval: 1, monthDay: 15 };
		expect(describeRecurrence(monthDay, opts('ru'), compact)).toBe('мес. 15 числа');

		const nth: Recurrence = { freq: 'month', interval: 1, nth: { ordinal: -1, weekday: 5 } };
		expect(describeRecurrence(nth, opts('en'), compact)).toBe('mo on the last Fri');
		expect(describeRecurrence(nth, opts('ru'), compact)).toBe('мес. — последняя: Пт');
	});

	it('keeps the yearly day and month', () => {
		const rule: Recurrence = { freq: 'year', interval: 1, month: 7, day: 4 };
		expect(describeRecurrence(rule, opts('en'), compact)).toBe('yr on July 4');
		expect(describeRecurrence(rule, opts('ru'), compact)).toBe('год 4 июля');
	});
});
