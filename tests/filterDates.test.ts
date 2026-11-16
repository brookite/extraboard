import { describe, expect, it } from 'vitest';
import { dateMinute, filterDateWindow, FILTER_DATE_PRESETS } from '../src/model/filterDates';
import { parseDate } from '../src/model/dates';
import { matchCard, filterCards, type FilterCondition } from '../src/model/filter';
import { sortCards } from '../src/model/sort';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import { boardHead } from './boardFile';

const minute = (text: string) => dateMinute(parseDate(text)!);
const today = { y: 2026, m: 11, d: 16 }; // Monday
const condition = (op: FilterCondition['op'], value: string): FilterCondition => ({
	kind: 'condition', field: { kind: 'property', name: 'due' }, op, value,
});
const board = (lines: string[], filter?: FilterCondition) => parseBoard([
	boardHead({ properties: [{ name: 'due', type: 'date-list' }],
		views: [{ id: 'v1', name: 'List', type: 'list', filter: filter && {
			field: 'due', op: filter.op, value: filter.value,
		} }] }), '## Tasks', '', ...lines,
].join('\n'));

describe('relative date windows', () => {
	it.each([
		['1 minute', '2026-11-16 11:59', '2026-11-16 12:01'],
		['13 hour', '2026-11-15 23:00', '2026-11-17 01:00'],
		['2 day', '2026-11-14 12:00', '2026-11-18 12:00'],
		['3 week', '2026-10-26 12:00', '2026-12-07 12:00'],
		['1 month', '2026-10-16 12:00', '2026-12-16 12:00'],
	])('resolves %s on both sides of now', (value, past, future) => {
		expect(filterDateWindow('inLast', value, today, 720)).toEqual({ from: minute(past), to: minute('2026-11-16 12:00') });
		expect(filterDateWindow('inNext', value, today, 720)).toEqual({ from: minute('2026-11-16 12:00'), to: minute(future) });
	});

	it('clamps calendar months and preserves the clock in leap years', () => {
		expect(filterDateWindow('inLast', '1 month', { y: 2024, m: 3, d: 31 }, 60)?.from).toBe(minute('2024-02-29 01:00'));
		expect(filterDateWindow('inNext', '1 month', { y: 2025, m: 1, d: 31 }, 60)?.to).toBe(minute('2025-02-28 01:00'));
	});

	it.each([
		['yesterday', '2026-11-15 00:00', '2026-11-15 23:59'],
		['today', '2026-11-16 00:00', '2026-11-16 23:59'],
		['thisWeek', '2026-11-16 00:00', '2026-11-22 23:59'],
		['nextWeek', '2026-11-23 00:00', '2026-11-29 23:59'],
		['thisMonth', '2026-11-01 00:00', '2026-11-30 23:59'],
		['nextMonth', '2026-12-01 00:00', '2026-12-31 23:59'],
	])('resolves preset %s as a full calendar period', (preset, from, to) => {
		expect(filterDateWindow('inPeriod', preset, today, 720)).toEqual({ from: minute(from), to: minute(to) });
	});

	it('respects Sunday weeks and crosses year boundaries', () => {
		expect(filterDateWindow('inPeriod', 'thisWeek', today, 720, 0)?.from).toBe(minute('2026-11-15'));
		expect(filterDateWindow('inPeriod', 'nextMonth', { y: 2026, m: 12, d: 31 })?.to).toBe(minute('2027-01-31 23:59'));
		expect(filterDateWindow('inPeriod', 'nextWeek', { y: 2026, m: 12, d: 31 })?.from).toBe(minute('2027-01-04'));
	});

	it.each(['-1 day', '1.5 week', '1 fortnight', 'NaN hour', '99999999999999999 month'])('rejects invalid duration %s', (value) => {
		expect(filterDateWindow('inNext', value, today)).toBeNull();
	});
});

describe('moving filters in a saved view', () => {
	it('includes the entire preset day and excludes both neighboring minutes', () => {
		const b = board([
			'- Before @{due|2026-11-15 23:59}', '- Start @{due|2026-11-16 00:00}',
			'- End @{due|2026-11-16 23:59}', '- After @{due|2026-11-17 00:00}', '- Empty',
		]);
		const ctx = { config: b.config, today, minutes: 720 };
		const matches = b.stacks[0]!.items.map((entry) => entry.kind === 'card' &&
			matchCard(entry.card, condition('inPeriod', 'today'), ctx));
		expect(matches).toEqual([false, true, true, false, false]);
	});

	it('zero duration matches only the current minute for timed cards', () => {
		const b = board(['- Task @{due|2026-11-16 12:00}']);
		const entry = b.stacks[0]!.items[0]!;
		if (entry.kind !== 'card') throw new Error('Expected card');
		const ctx = { config: b.config, today, minutes: 720 };
		expect(matchCard(entry.card, condition('inLast', '0 minute'), ctx)).toBe(true);
		expect(matchCard(entry.card, condition('inNext', '0 minute'), { ...ctx, minutes: 721 })).toBe(false);
	});

	it('filters minute boundaries, full untimed days, overlapping ranges and date lists, then sorts', () => {
		const b = board([
			'- Later @{due|2026-11-16 12:30}',
			'- Outside @{due|2026-11-16 13:01}',
			'- Boundary @{due|2026-11-16 13:00}',
			'- Untimed @{due|2026-11-16}',
			'- Range @{due|2026-11-15 → 2026-11-17}',
			'- Multiple @{due|2026-11-01; 2026-11-16 12:10}',
			'- Before @{due|2026-11-16 11:59}', '- Empty',
		]);
		const ctx = { config: b.config, today, minutes: 720 };
		const refs = b.stacks[0]!.items.map((_, item) => ({ stack: 0, item }));
		const filtered = filterCards(b, refs, condition('inNext', '1 hour'), ctx);
		const sorted = sortCards(b, filtered, [{ field: { kind: 'builtin', id: 'title' }, dir: 'asc' }], ctx);
		expect(sorted.map((ref) => {
			const entry = b.stacks[0]!.items[ref.item]!;
			return entry.kind === 'card' ? entry.card.title : '';
		})).toEqual(['Boundary', 'Later', 'Multiple', 'Range', 'Untimed']);
	});

	it('reevaluates the same saved filter as minutes and days advance', () => {
		const b = board(['- Task @{due|2026-11-16 12:30}']);
		const entry = b.stacks[0]!.items[0]!;
		if (entry.kind !== 'card') throw new Error('Expected card');
		const ctx = { config: b.config, today, minutes: 720 };
		expect(matchCard(entry.card, condition('inNext', '30 minute'), ctx)).toBe(true);
		expect(matchCard(entry.card, condition('inNext', '30 minute'), { ...ctx, minutes: 751 })).toBe(false);
		expect(matchCard(entry.card, condition('inPeriod', 'today'), { ...ctx, today: { ...today, d: 17 } })).toBe(false);
		expect(matchCard(entry.card, condition('inLast', ' hour'), ctx)).toBe(true);
		expect(matchCard(entry.card, condition('inLast', '-1 hour'), ctx)).toBe(false);
	});

	it.each([
		...FILTER_DATE_PRESETS.map((preset) => condition('inPeriod', preset)),
		condition('inLast', '2 week'), condition('inNext', '30 minute'),
	])('round trips $op $value without freezing dates', (filter) => {
		const b = board(['- Task'], filter);
		const reopened = parseBoard(serializeBoard(b));
		expect(reopened.config.views[0]).toMatchObject({ filter: { children: [filter] } });
		expect(serializeBoard(reopened)).toBe(serializeBoard(b));
	});
});
