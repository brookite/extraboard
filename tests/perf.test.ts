// The identity guarantees the M10 Part B memoization rests on. Spec:
// docs/plans/m10-perf.md §2.3, §3. These are not micro-benchmarks: each asserts
// the *sameness* that decides whether a re-render is skipped or a formatter is
// rebuilt, which is the part that can silently regress.

import { describe, expect, it } from 'vitest';
import { dateTimeFormat, pluralRules, relativeTimeFormat } from '../src/i18n/intl';
import { currentNow } from '../src/view/now';

describe('Intl cache', () => {
	it('returns the same DateTimeFormat for the same locale and options', () => {
		const a = dateTimeFormat('en', { dateStyle: 'medium' });
		const b = dateTimeFormat('en', { dateStyle: 'medium' });
		expect(a).toBe(b);
	});

	it('keys on the options, so a different shape gets its own formatter', () => {
		const medium = dateTimeFormat('en', { dateStyle: 'medium' });
		const short = dateTimeFormat('en', { dateStyle: 'short' });
		expect(medium).not.toBe(short);
		expect(medium.format(new Date(2026, 6, 27))).not.toBe(short.format(new Date(2026, 6, 27)));
	});

	it('keys on the locale, which is why nothing has to be cleared on a language change', () => {
		const en = dateTimeFormat('en', { weekday: 'long' });
		const ru = dateTimeFormat('ru', { weekday: 'long' });
		expect(en).not.toBe(ru);
		expect(en.format(new Date(2024, 0, 8))).not.toBe(ru.format(new Date(2024, 0, 8)));
	});

	it('caches RelativeTimeFormat and PluralRules per locale', () => {
		expect(relativeTimeFormat('ru')).toBe(relativeTimeFormat('ru'));
		expect(relativeTimeFormat('ru')).not.toBe(relativeTimeFormat('en'));
		expect(pluralRules('ru')).toBe(pluralRules('ru'));
		expect(pluralRules('ru')).not.toBe(pluralRules('en'));
	});
});

describe('currentNow', () => {
	it('keeps one identity within a minute, so an edit re-render skips every memo', () => {
		expect(currentNow()).toBe(currentNow());
	});

	it('reports the current calendar day and minute', () => {
		// Read the clock on both sides: a minute (or a day) can turn over mid-test,
		// and either reading is then the right answer.
		const stamp = (clock: Date): string =>
			`${String(clock.getFullYear())}-${String(clock.getMonth() + 1)}-${String(clock.getDate())}@${String(
				clock.getHours() * 60 + clock.getMinutes(),
			)}`;
		const before = stamp(new Date());
		const now = currentNow();
		const after = stamp(new Date());
		const got = `${String(now.date.y)}-${String(now.date.m)}-${String(now.date.d)}@${String(now.minutes)}`;
		expect([before, after]).toContain(got);
	});
});
