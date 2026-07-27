// Cached `Intl` constructors. Spec: docs/plans/m10-perf.md §3.
//
// Constructing a formatter is the expensive part of `Intl` — formatting with an
// existing one is cheap — and the plugin was constructing one per date badge per
// render, plus seven per calendar draw for the weekday header.
//
// The cache key carries the locale, so a language change cannot be served a
// stale formatter and there is nothing to invalidate on `setLanguage`; the plan
// expected an explicit clear, and it turned out not to be needed. The number of
// distinct (locale, options) pairs the plugin uses is a fixed handful, so the
// maps never grow with the board.

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();
const pluralRuleSets = new Map<string, Intl.PluralRules>();

export function dateTimeFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	// Stringifying a four-key literal costs far less than the constructor it
	// avoids, which is the whole trade being made here.
	const key = `${lang}|${JSON.stringify(options)}`;
	let formatter = dateTimeFormats.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(lang, options);
		dateTimeFormats.set(key, formatter);
	}
	return formatter;
}

export function relativeTimeFormat(lang: string): Intl.RelativeTimeFormat {
	let formatter = relativeTimeFormats.get(lang);
	if (!formatter) {
		formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
		relativeTimeFormats.set(lang, formatter);
	}
	return formatter;
}

export function pluralRules(lang: string): Intl.PluralRules {
	let rules = pluralRuleSets.get(lang);
	if (!rules) {
		rules = new Intl.PluralRules(lang);
		pluralRuleSets.set(lang, rules);
	}
	return rules;
}
