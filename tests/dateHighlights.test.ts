// Date highlight rules: the matcher, the two-level resolution, validation, the
// frontmatter round trip, and the contrast helper.
// Spec: docs/specs/i18n-and-dates.md §3.

import { describe, it, expect } from 'vitest';
import {
	cloneRules,
	highlightsFor,
	isDateFamily,
	matchHighlight,
	nowStamp,
	validateDateHighlights,
	type DateHighlightRule,
	type Now,
} from '../src/model/dateHighlights';
import { addDays, type CalDate, type DateSpan } from '../src/model/dates';
import { nextOccurrence, parseRecurrence } from '../src/model/recurrence';
import { defaultBoardConfig, type BoardConfig } from '../src/model/types';
import { parseFrontmatter, serializeFrontmatter, writeConfig } from '../src/model/frontmatter';
import { contrastText } from '../src/util/color';

/** Noon on 2026-07-27, the moment every case below is measured from. */
const NOW: Now = { date: { y: 2026, m: 7, d: 27 }, minutes: 12 * 60 };

function rule(over: Partial<DateHighlightRule> = {}): DateHighlightRule {
	return { when: 'before', amount: 1, unit: 'day', color: '#e0ac00', ...over };
}

/** A single date, as every badge collapses one: a one-day span. */
function on(date: CalDate): DateSpan {
	return { start: date, end: date };
}

function at(y: number, m: number, d: number, minutes?: number): CalDate {
	return minutes === undefined ? { y, m, d } : { y, m, d, minutes };
}

describe('nowStamp', () => {
	it('splits a clock into a calendar day and minutes since its midnight', () => {
		expect(nowStamp(new Date(2026, 6, 27, 12, 30))).toEqual({
			date: { y: 2026, m: 7, d: 27 },
			minutes: 12 * 60 + 30,
		});
	});
});

describe('matchHighlight — a date with no time is the end of its day', () => {
	it('a date due today is still approaching, not overdue', () => {
		const due = on(at(2026, 7, 27));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'day' })], 'due', due, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'day' })], 'due', due, NOW)).toBeUndefined();
	});

	it('the same date is overdue the next day', () => {
		const due = on(at(2026, 7, 27));
		const tomorrow: Now = { date: at(2026, 7, 28), minutes: 12 * 60 };
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'day' })], 'due', due, tomorrow)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'day' })], 'due', due, tomorrow)).toBeUndefined();
	});

	it('a time on the date is honored instead of the end of the day', () => {
		// 09:05 today is already past at noon, unlike the bare date.
		const passed = on(at(2026, 7, 27, 9 * 60 + 5));
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'hour' })], 'due', passed, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'day' })], 'due', passed, NOW)).toBeUndefined();
	});
});

describe('matchHighlight — thresholds', () => {
	it('before matches at exactly the threshold and not one minute beyond it', () => {
		// 14:00 today is two hours away from noon.
		const due = on(at(2026, 7, 27, 14 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 2, unit: 'hour' })], 'due', due, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'hour' })], 'due', due, NOW)).toBeUndefined();
	});

	it('after matches once at least the threshold has elapsed', () => {
		// 09:00 today is three hours behind noon.
		const past = on(at(2026, 7, 27, 9 * 60));
		expect(matchHighlight([rule({ when: 'after', amount: 3, unit: 'hour' })], 'due', past, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'after', amount: 4, unit: 'hour' })], 'due', past, NOW)).toBeUndefined();
	});

	it('neither side matches the present instant itself', () => {
		const nowExactly = on(at(2026, 7, 27, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'week' })], 'due', nowExactly, NOW)).toBeUndefined();
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'hour' })], 'due', nowExactly, NOW)).toBeUndefined();
	});

	it('amount 0 with before never matches: nothing is due within no time at all', () => {
		const soon = on(at(2026, 7, 27, 12 * 60 + 1));
		expect(matchHighlight([rule({ when: 'before', amount: 0, unit: 'day' })], 'due', soon, NOW)).toBeUndefined();
	});

	it('amount 0 with after matches anything already past', () => {
		const past = on(at(2026, 7, 26));
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'day' })], 'due', past, NOW)).toBeDefined();
	});

	it('a week is seven days', () => {
		const due = on(at(2026, 8, 3, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'week' })], 'due', due, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 6, unit: 'day' })], 'due', due, NOW)).toBeUndefined();
	});
});

describe('matchHighlight — month is a calendar month', () => {
	it('measures from now, so it tracks the real length of the months ahead', () => {
		// July → August is 31 days; a date 31 days out is inside "1 month".
		const due = on(at(2026, 8, 27, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'month' })], 'due', due, NOW)).toBeDefined();

		// From February the same rule spans only 28 days in 2026.
		const inFebruary: Now = { date: at(2026, 2, 1), minutes: 12 * 60 };
		const march1 = on(at(2026, 3, 1, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'month' })], 'due', march1, inFebruary)).toBeDefined();
		const march2 = on(at(2026, 3, 2, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'month' })], 'due', march2, inFebruary)).toBeUndefined();
	});

	it('does not shift across a DST switch: these are calendar dates', () => {
		// Europe/Moscow has no DST, but the model must not depend on that — a span
		// across the EU/US switch dates is still a whole number of days.
		const inMarch: Now = { date: at(2026, 3, 1), minutes: 12 * 60 };
		const inApril = on(at(2026, 4, 1, 12 * 60));
		expect(matchHighlight([rule({ when: 'before', amount: 31, unit: 'day' })], 'due', inApril, inMarch)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 30, unit: 'day' })], 'due', inApril, inMarch)).toBeUndefined();
	});
});

describe('matchHighlight — ranges', () => {
	const span: DateSpan = { start: at(2026, 7, 28), end: at(2026, 7, 30) };

	it('before measures the start', () => {
		expect(matchHighlight([rule({ when: 'before', amount: 2, unit: 'day' })], 'sprint', span, NOW)).toBeDefined();
		expect(matchHighlight([rule({ when: 'before', amount: 1, unit: 'day' })], 'sprint', span, NOW)).toBeUndefined();
	});

	it('after measures the end, so a running range is neither early nor late', () => {
		const running: DateSpan = { start: at(2026, 7, 20), end: at(2026, 7, 30) };
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'day' })], 'sprint', running, NOW)).toBeUndefined();
		const finished: DateSpan = { start: at(2026, 7, 20), end: at(2026, 7, 25) };
		expect(matchHighlight([rule({ when: 'after', amount: 1, unit: 'day' })], 'sprint', finished, NOW)).toBeDefined();
	});
});

describe('matchHighlight — rule selection', () => {
	// Noon tomorrow: exactly one day out, so a one-day rule is a match.
	const tomorrow = on(at(2026, 7, 28, 12 * 60));

	it('the first match in list order wins, never the tightest rule', () => {
		const wide = rule({ when: 'before', amount: 1, unit: 'week', color: '#08b94e' });
		const tight = rule({ when: 'before', amount: 2, unit: 'day', color: '#e93147' });
		expect(matchHighlight([wide, tight], 'due', tomorrow, NOW)).toBe(wide);
		expect(matchHighlight([tight, wide], 'due', tomorrow, NOW)).toBe(tight);
	});

	it('a rule naming another property is skipped; a rule naming none applies to all', () => {
		const other = rule({ property: 'start', color: '#08b94e' });
		const any = rule({ color: '#e93147' });
		expect(matchHighlight([other, any], 'due', tomorrow, NOW)).toBe(any);
		expect(matchHighlight([other], 'due', tomorrow, NOW)).toBeUndefined();
		expect(matchHighlight([other], 'start', tomorrow, NOW)).toBe(other);
	});

	it('a rule the editor would flag is never painted', () => {
		expect(matchHighlight([rule({ color: '  ' })], 'due', tomorrow, NOW)).toBeUndefined();
		expect(matchHighlight([rule({ amount: -1 })], 'due', tomorrow, NOW)).toBeUndefined();
		expect(matchHighlight([rule({ amount: 1.5 })], 'due', tomorrow, NOW)).toBeUndefined();
	});

	it('a value with nothing parseable matches nothing', () => {
		expect(matchHighlight([rule()], 'due', null, NOW)).toBeUndefined();
	});
});

describe('matchHighlight — recurrence, through its next occurrence', () => {
	const rules = [rule({ when: 'before', amount: 1, unit: 'week' })];

	function nextSpan(text: string, anchor: CalDate): DateSpan | null {
		const rec = parseRecurrence(text);
		expect(rec).not.toBeNull();
		const next = nextOccurrence(rec!, anchor, NOW.date);
		return next ? on(next) : null;
	}

	it('the next hit after today is what a before rule measures', () => {
		const span = nextSpan('every week', at(2026, 7, 24));
		expect(span?.start).toEqual(at(2026, 7, 31));
		expect(matchHighlight(rules, 'review', span, NOW)).toBeDefined();
	});

	it('an after rule never matches: the next hit is always in the future', () => {
		const span = nextSpan('every day', at(2026, 7, 1));
		expect(matchHighlight([rule({ when: 'after', amount: 0, unit: 'day' })], 'review', span, NOW)).toBeUndefined();
	});

	it('a spent rule has no date at all, so nothing highlights it', () => {
		const span = nextSpan('every day until 2026-07-20', at(2026, 7, 15));
		expect(span).toBeNull();
		expect(matchHighlight(rules, 'review', span, NOW)).toBeUndefined();
	});
});

describe('highlightsFor — board replaces global', () => {
	const global = [rule({ color: '#e93147' })];

	function config(over: Partial<BoardConfig> = {}): BoardConfig {
		return { ...defaultBoardConfig(), ...over };
	}

	it('an absent board list follows the plugin setting', () => {
		expect(highlightsFor(config(), global)).toBe(global);
	});

	it('a board list replaces it', () => {
		const own = [rule({ color: '#08b94e' })];
		expect(highlightsFor(config({ dateHighlights: own }), global)).toBe(own);
	});

	it('an empty board list means no highlights, not "follow the plugin"', () => {
		expect(highlightsFor(config({ dateHighlights: [] }), global)).toEqual([]);
	});
});

describe('validateDateHighlights', () => {
	it('flags a color-less rule', () => {
		expect(validateDateHighlights([rule({ color: '' })])).toEqual([{ kind: 'noColor', index: 0 }]);
	});

	it('flags an amount that is not a whole number of 0 or more', () => {
		expect(validateDateHighlights([rule({ amount: -1 }), rule({ amount: 2.5 })])).toEqual([
			{ kind: 'badAmount', index: 0 },
			{ kind: 'badAmount', index: 1 },
		]);
	});

	it('flags a property the board does not declare, only when the list is known', () => {
		const rules = [rule({ property: 'gone' })];
		expect(validateDateHighlights(rules, ['due'])).toEqual([
			{ kind: 'unknownProperty', index: 0, name: 'gone' },
		]);
		expect(validateDateHighlights(rules)).toEqual([]);
		expect(validateDateHighlights(rules, ['gone'])).toEqual([]);
	});

	it('accepts a well-formed list and never drops a rule', () => {
		const rules = [rule(), rule({ when: 'after', amount: 0, unit: 'month' })];
		expect(validateDateHighlights(rules, [])).toEqual([]);
		expect(cloneRules(rules)).toEqual(rules);
	});
});

describe('isDateFamily', () => {
	it('covers the four date-carrying types and nothing else', () => {
		expect(isDateFamily('datetime')).toBe(true);
		expect(isDateFamily('date-range')).toBe(true);
		expect(isDateFamily('date-list')).toBe(true);
		expect(isDateFamily('recurrence')).toBe(true);
		expect(isDateFamily('string')).toBe(false);
		expect(isDateFamily('percent')).toBe(false);
		expect(isDateFamily('checkbox')).toBe(false);
	});
});

describe('frontmatter round trip', () => {
	const text = [
		'---',
		'extraboard:',
		'  version: 1',
		'  dateHighlights:',
		'    - property: due',
		'      when: before',
		'      amount: 3',
		'      unit: day',
		'      color: "#e0ac00"',
		'    - when: after',
		'      amount: 0',
		'      unit: day',
		'      color: "#e93147"',
		'---',
		'',
		'## Todo',
		'',
	].join('\n');

	it('reads a board list, keeping order and the optional property', () => {
		const { config } = parseFrontmatter(text);
		expect(config.dateHighlights).toEqual([
			{ property: 'due', when: 'before', amount: 3, unit: 'day', color: '#e0ac00' },
			{ when: 'after', amount: 0, unit: 'day', color: '#e93147' },
		]);
	});

	it('writes the list back unchanged', () => {
		const parsed = parseFrontmatter(text);
		writeConfig(parsed.doc!, parsed.config);
		const round = parseFrontmatter(serializeFrontmatter(parsed.doc, parsed.body));
		expect(round.config.dateHighlights).toEqual(parsed.config.dateHighlights);
	});

	it('keeps an empty list, which is a board saying "no highlights"', () => {
		const empty = text.replace(/ {2}dateHighlights:[\s\S]*?(?=---)/, '  dateHighlights: []\n');
		const parsed = parseFrontmatter(empty);
		expect(parsed.config.dateHighlights).toEqual([]);
		writeConfig(parsed.doc!, parsed.config);
		expect(parseFrontmatter(serializeFrontmatter(parsed.doc, parsed.body)).config.dateHighlights).toEqual([]);
	});

	it('has no key at all when the board follows the plugin setting', () => {
		const { config, doc, body } = parseFrontmatter(text.replace(/ {2}dateHighlights:[\s\S]*?(?=---)/, ''));
		expect(config.dateHighlights).toBeUndefined();
		writeConfig(doc!, config);
		expect(serializeFrontmatter(doc, body)).not.toContain('dateHighlights');
	});

	it('drops a malformed rule rather than keeping junk the matcher must guard', () => {
		const broken = text.replace('      unit: day\n      color: "#e0ac00"', '      unit: fortnight\n      color: "#e0ac00"');
		expect(parseFrontmatter(broken).config.dateHighlights).toHaveLength(1);
	});
});

describe('contrastText', () => {
	it('picks black text on a light background and white on a dark one', () => {
		expect(contrastText('#ffffff')).toBe('#000000');
		expect(contrastText('#e0ac00')).toBe('#000000');
		expect(contrastText('#000000')).toBe('#ffffff');
		expect(contrastText('#086ddd')).toBe('#ffffff');
	});

	it('treats anything it cannot read as light, the safer guess', () => {
		expect(contrastText('var(--color-red)')).toBe('#000000');
		expect(contrastText('')).toBe('#000000');
	});
});

describe('a day of a due date, hour by hour', () => {
	// The end-of-day decision as a user meets it: "due today" is amber all day
	// and turns red tomorrow, with a rule pair like the spec's own example.
	const rules = [
		rule({ when: 'after', amount: 0, unit: 'day', color: '#e93147' }),
		rule({ when: 'before', amount: 1, unit: 'day', color: '#e0ac00' }),
	];
	const due = on(at(2026, 7, 27));

	it('stays amber from midnight to the last minute of the day', () => {
		for (const minutes of [0, 8 * 60, 23 * 60 + 58]) {
			expect(matchHighlight(rules, 'due', due, { date: at(2026, 7, 27), minutes })?.color).toBe('#e0ac00');
		}
	});

	it('turns red the next day', () => {
		const next = { date: addDays(at(2026, 7, 27), 1), minutes: 0 };
		expect(matchHighlight(rules, 'due', due, next)?.color).toBe('#e93147');
	});
});
