// i18n foundation: t()/setLanguage()/currentLanguage() and the en/ru tables
// stay in lockstep. Spec: docs/specs/i18n-and-dates.md §1.

import { describe, it, expect, afterEach } from 'vitest';
import { t, setLanguage, currentLanguage, type Path } from '../src/i18n/index';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';

afterEach(() => setLanguage('en'));

/** Every dotted leaf path under a nested string table. */
function leafPaths(table: object, prefix = ''): string[] {
	const paths: string[] = [];
	for (const [key, value] of Object.entries(table)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') paths.push(path);
		else if (value && typeof value === 'object') paths.push(...leafPaths(value as object, path));
	}
	return paths;
}

describe('t()', () => {
	it('resolves a nested English key', () => {
		expect(t('command.createBoard')).toBe(en.command.createBoard);
	});

	it('resolves the Russian translation once selected', () => {
		setLanguage('ru');
		expect(t('command.createBoard')).toBe(ru.command?.createBoard);
		expect(t('command.createBoard')).not.toBe(en.command.createBoard);
	});

	it('falls back to English for an unknown key', () => {
		const bogus = 'nowhere.at.all' as Path<typeof en>;
		expect(t(bogus)).toBe(bogus);
	});

	it('interpolates {param} placeholders', () => {
		expect(t('command.createBoard', { unused: 1 })).toBe(en.command.createBoard);
	});
});

describe('setLanguage() / currentLanguage()', () => {
	it('resolves auto to English when there is no host window (e.g. under Node)', () => {
		setLanguage('auto');
		expect(currentLanguage()).toBe('en');
	});

	it('reflects an explicit choice', () => {
		setLanguage('ru');
		expect(currentLanguage()).toBe('ru');
		setLanguage('en');
		expect(currentLanguage()).toBe('en');
	});
});

describe('en/ru stay in lockstep', () => {
	it('every English key currently has a Russian translation', () => {
		const ruPaths = new Set(leafPaths(ru));
		const missing = leafPaths(en).filter((path) => !ruPaths.has(path));
		expect(missing).toEqual([]);
	});

	it('ru.ts introduces no key absent from en.ts (TypeScript already guarantees this; documented here)', () => {
		const enPaths = new Set(leafPaths(en));
		const orphans = leafPaths(ru).filter((path) => !enPaths.has(path));
		expect(orphans).toEqual([]);
	});
});
