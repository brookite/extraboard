// Dependency-free i18n: t() over English (source of truth) and Russian tables.
// Spec: docs/specs/i18n-and-dates.md §1.

import { en } from './en';
import { ru } from './ru';

export type Lang = 'en' | 'ru';

/** A nested table of translation strings, any depth. */
export type StringTable = { [key: string]: string | StringTable };

/** Every dotted path in `T` that resolves to a string leaf. */
export type Path<T extends StringTable> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<Extract<T[K], StringTable>>}`;
}[keyof T & string];

/** Same shape as `T`, every key optional, all the way down. */
export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>;
};

type Strings = typeof en;

const warnedMissing = new Set<string>();

function resolve(table: StringTable, path: string): string | undefined {
	let cur: StringTable | string = table;
	for (const part of path.split('.')) {
		if (typeof cur === 'string') return undefined;
		const next: string | StringTable | undefined = cur[part];
		if (next === undefined) return undefined;
		cur = next;
	}
	return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	);
}

let lang: Lang = 'en';

/** Resolves `'auto'` against Obsidian's own locale; anything but `ru` falls back to `en`. */
export function setLanguage(setting: Lang | 'auto'): void {
	if (setting === 'auto') {
		const moment =
			typeof window !== 'undefined'
				? (window as { moment?: { locale: () => string } }).moment
				: undefined;
		lang = moment?.locale().startsWith('ru') ? 'ru' : 'en';
	} else {
		lang = setting;
	}
}

/** The resolved language in effect — never `'auto'`. */
export function currentLanguage(): Lang {
	return lang;
}

/**
 * Look up `key` (a dotted path into `en`'s shape) in the current language,
 * falling back to English and finally to the key itself. `ru` may be missing
 * a key entirely — that is not an error, just an untranslated string.
 */
export function t(key: Path<Strings>, params?: Record<string, string | number>): string {
	if (lang === 'ru') {
		const ruValue = resolve(ru, key);
		if (ruValue !== undefined) return interpolate(ruValue, params);
		if (!warnedMissing.has(key)) {
			warnedMissing.add(key);
			console.warn(`Extraboard: missing Russian translation for "${key}"`);
		}
	}
	const enValue = resolve(en, key);
	return interpolate(enValue ?? key, params);
}
