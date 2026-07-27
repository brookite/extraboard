// A localized human sentence for a `recurrence` rule, read by the property
// badge. Spec: docs/specs/recurrence.md §5, i18n-and-dates.md §2.4 — the
// stored phrase (`model/recurrence.ts:formatRecurrence`) keeps its frozen
// English grammar; only this presentation localizes.
//
// Known, accepted limitation: Russian weekday names have three different
// genders (понедельник m, среда f, воскресенье n), so a single declined
// "ordinal" adjective cannot agree with all seven — same limitation the
// rule form's ordinal dropdown already has. The monthly nth-weekday clause
// sidesteps it with a plain label ("Последний: Пятница") rather than forcing
// an adjective to agree with a noun it sometimes cannot.

import type { Recurrence } from '../model/recurrence';
import { formatCalDate, type DateTimeOpts } from './dates';
import { t } from './index';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday..Sunday, matching formatRecurrence's own order

function weekdayAbbrev(day: number): string {
	switch (day) {
		case 0:
			return t('modal.recurrence.weekday.sun');
		case 1:
			return t('modal.recurrence.weekday.mon');
		case 2:
			return t('modal.recurrence.weekday.tue');
		case 3:
			return t('modal.recurrence.weekday.wed');
		case 4:
			return t('modal.recurrence.weekday.thu');
		case 5:
			return t('modal.recurrence.weekday.fri');
		default:
			return t('modal.recurrence.weekday.sat');
	}
}

function weekdayFull(day: number): string {
	switch (day) {
		case 0:
			return t('recurrenceText.weekdayFull.sun');
		case 1:
			return t('recurrenceText.weekdayFull.mon');
		case 2:
			return t('recurrenceText.weekdayFull.tue');
		case 3:
			return t('recurrenceText.weekdayFull.wed');
		case 4:
			return t('recurrenceText.weekdayFull.thu');
		case 5:
			return t('recurrenceText.weekdayFull.fri');
		default:
			return t('recurrenceText.weekdayFull.sat');
	}
}

function monthFull(month: number): string {
	switch (month) {
		case 1:
			return t('modal.recurrence.month.jan');
		case 2:
			return t('modal.recurrence.month.feb');
		case 3:
			return t('modal.recurrence.month.mar');
		case 4:
			return t('modal.recurrence.month.apr');
		case 5:
			return t('modal.recurrence.month.may');
		case 6:
			return t('modal.recurrence.month.jun');
		case 7:
			return t('modal.recurrence.month.jul');
		case 8:
			return t('modal.recurrence.month.aug');
		case 9:
			return t('modal.recurrence.month.sep');
		case 10:
			return t('modal.recurrence.month.oct');
		case 11:
			return t('modal.recurrence.month.nov');
		default:
			return t('modal.recurrence.month.dec');
	}
}

function monthGenitive(month: number): string {
	switch (month) {
		case 1:
			return t('recurrenceText.monthGenitive.jan');
		case 2:
			return t('recurrenceText.monthGenitive.feb');
		case 3:
			return t('recurrenceText.monthGenitive.mar');
		case 4:
			return t('recurrenceText.monthGenitive.apr');
		case 5:
			return t('recurrenceText.monthGenitive.may');
		case 6:
			return t('recurrenceText.monthGenitive.jun');
		case 7:
			return t('recurrenceText.monthGenitive.jul');
		case 8:
			return t('recurrenceText.monthGenitive.aug');
		case 9:
			return t('recurrenceText.monthGenitive.sep');
		case 10:
			return t('recurrenceText.monthGenitive.oct');
		case 11:
			return t('recurrenceText.monthGenitive.nov');
		default:
			return t('recurrenceText.monthGenitive.dec');
	}
}

function ordinalLabel(ordinal: 1 | 2 | 3 | 4 | -1): string {
	switch (ordinal) {
		case 1:
			return t('recurrenceText.ordinalLabel.first');
		case 2:
			return t('recurrenceText.ordinalLabel.second');
		case 3:
			return t('recurrenceText.ordinalLabel.third');
		case 4:
			return t('recurrenceText.ordinalLabel.fourth');
		default:
			return t('recurrenceText.ordinalLabel.last');
	}
}

function freqClause(rule: Recurrence, lang: 'en' | 'ru'): string {
	const unit = rule.freq;
	if (rule.interval === 1) {
		switch (unit) {
			case 'day':
				return t('recurrenceText.freqOne.day');
			case 'week':
				return t('recurrenceText.freqOne.week');
			case 'month':
				return t('recurrenceText.freqOne.month');
			default:
				return t('recurrenceText.freqOne.year');
		}
	}
	const category = new Intl.PluralRules(lang).select(rule.interval);
	const bucket = category === 'few' ? 'few' : 'many';
	const key =
		unit === 'day'
			? bucket === 'few'
				? 'recurrenceText.freqMany.day.few'
				: 'recurrenceText.freqMany.day.many'
			: unit === 'week'
				? bucket === 'few'
					? 'recurrenceText.freqMany.week.few'
					: 'recurrenceText.freqMany.week.many'
				: unit === 'month'
					? bucket === 'few'
						? 'recurrenceText.freqMany.month.few'
						: 'recurrenceText.freqMany.month.many'
					: bucket === 'few'
						? 'recurrenceText.freqMany.year.few'
						: 'recurrenceText.freqMany.year.many';
	return t(key, { n: rule.interval });
}

function timesClause(count: number, lang: 'en' | 'ru'): string {
	const category = new Intl.PluralRules(lang).select(count);
	if (category === 'one') return t('recurrenceText.timesOne');
	if (category === 'few') return t('recurrenceText.timesFew', { n: count });
	return t('recurrenceText.timesMany', { n: count });
}

/**
 * A human sentence for a rule ("every 2 weeks on Mon, Wed from 2026-07-27"),
 * describing only what the rule itself specifies — same scope as
 * `formatRecurrence`, just localized. Embedded dates go through the shared
 * pipeline, so they honor the user's own `dateFormat`.
 */
export function describeRecurrence(rule: Recurrence, opts: DateTimeOpts): string {
	let out = freqClause(rule, opts.lang);

	if (rule.freq === 'week' && rule.weekdays?.length) {
		const list = DAY_ORDER.filter((d) => rule.weekdays?.includes(d))
			.map(weekdayAbbrev)
			.join(', ');
		out += t('recurrenceText.onWeekdays', { list });
	} else if (rule.freq === 'month' && rule.monthDay !== undefined) {
		out += t('recurrenceText.onMonthDay', { n: rule.monthDay });
	} else if (rule.freq === 'month' && rule.nth) {
		out += t('recurrenceText.onNth', {
			ordinal: ordinalLabel(rule.nth.ordinal),
			weekday: weekdayFull(rule.nth.weekday),
		});
	} else if (rule.freq === 'year' && rule.month !== undefined && rule.day !== undefined) {
		out +=
			opts.lang === 'ru'
				? t('recurrenceText.onYearly', { day: rule.day, month: monthGenitive(rule.month) })
				: t('recurrenceText.onYearly', { day: rule.day, month: monthFull(rule.month) });
	}

	if (rule.start) out += t('recurrenceText.from', { date: formatCalDate(rule.start, opts) });
	if (rule.until) out += t('recurrenceText.until', { date: formatCalDate(rule.until, opts) });
	else if (rule.count !== undefined) out += timesClause(rule.count, opts.lang);

	return out;
}
