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
import { pluralRules } from './intl';

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

// Keys spelled out rather than assembled from parts, so `t()` still checks each
// one against `en.ts`'s shape at compile time.
const FREQ_ONE = {
	full: {
		day: 'recurrenceText.freqOne.day',
		week: 'recurrenceText.freqOne.week',
		month: 'recurrenceText.freqOne.month',
		year: 'recurrenceText.freqOne.year',
	},
	compact: {
		day: 'recurrenceText.unitOne.day',
		week: 'recurrenceText.unitOne.week',
		month: 'recurrenceText.unitOne.month',
		year: 'recurrenceText.unitOne.year',
	},
} as const;

const FREQ_MANY = {
	full: {
		day: { few: 'recurrenceText.freqMany.day.few', many: 'recurrenceText.freqMany.day.many' },
		week: { few: 'recurrenceText.freqMany.week.few', many: 'recurrenceText.freqMany.week.many' },
		month: { few: 'recurrenceText.freqMany.month.few', many: 'recurrenceText.freqMany.month.many' },
		year: { few: 'recurrenceText.freqMany.year.few', many: 'recurrenceText.freqMany.year.many' },
	},
	compact: {
		day: { few: 'recurrenceText.unitMany.day.few', many: 'recurrenceText.unitMany.day.many' },
		week: { few: 'recurrenceText.unitMany.week.few', many: 'recurrenceText.unitMany.week.many' },
		month: { few: 'recurrenceText.unitMany.month.few', many: 'recurrenceText.unitMany.month.many' },
		year: { few: 'recurrenceText.unitMany.year.few', many: 'recurrenceText.unitMany.year.many' },
	},
} as const;

/**
 * "every 2 weeks" / «каждые 2 недели», or its compact form ("2 wks", «2 нед.»),
 * where the badge's `repeat` icon already says "every".
 */
function freqClause(rule: Recurrence, lang: 'en' | 'ru', compact: boolean): string {
	const form = compact ? 'compact' : 'full';
	if (rule.interval === 1) return t(FREQ_ONE[form][rule.freq]);
	const category = pluralRules(lang).select(rule.interval);
	const bucket = category === 'few' ? 'few' : 'many';
	return t(FREQ_MANY[form][rule.freq][bucket], { n: rule.interval });
}

function timesClause(count: number, lang: 'en' | 'ru'): string {
	const category = pluralRules(lang).select(count);
	if (category === 'one') return t('recurrenceText.timesOne');
	if (category === 'few') return t('recurrenceText.timesFew', { n: count });
	return t('recurrenceText.timesMany', { n: count });
}

export interface DescribeOptions {
	/**
	 * The badge's form: no "every" (its `repeat` icon says that), abbreviated
	 * units, and **no absolute dates at all** — a start or end date is the
	 * longest clause of the sentence and would not fit a card, so both stay in
	 * the badge's tooltip, which shows the full form (recurrence.md §5).
	 */
	compact?: boolean;
}

/**
 * A human sentence for a rule ("every 2 weeks on Mon, Wed from 2026-07-27"),
 * describing only what the rule itself specifies — same scope as
 * `formatRecurrence`, just localized. Embedded dates go through the shared
 * pipeline, so they honor the user's own `dateFormat`.
 */
export function describeRecurrence(
	rule: Recurrence,
	opts: DateTimeOpts,
	{ compact = false }: DescribeOptions = {},
): string {
	let out = freqClause(rule, opts.lang, compact);

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
			// The label pair stays (see the gender note above); only its weekday
			// shortens, so «— последняя: Пт» fits a badge.
			weekday: compact ? weekdayAbbrev(rule.nth.weekday) : weekdayFull(rule.nth.weekday),
		});
	} else if (rule.freq === 'year' && rule.month !== undefined && rule.day !== undefined) {
		out +=
			opts.lang === 'ru'
				? t('recurrenceText.onYearly', { day: rule.day, month: monthGenitive(rule.month) })
				: t('recurrenceText.onYearly', { day: rule.day, month: monthFull(rule.month) });
	}

	if (!compact && rule.start) {
		out += t('recurrenceText.from', { date: formatCalDate(rule.start, opts) });
	}
	if (rule.until) {
		if (!compact) out += t('recurrenceText.until', { date: formatCalDate(rule.until, opts) });
	} else if (rule.count !== undefined) {
		// A count is short and bounds the series, so it survives the compaction.
		out += timesClause(rule.count, opts.lang);
	}

	return out;
}
