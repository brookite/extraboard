// A calendar computed from several date properties, and the rule that decides
// when two placements of one card are one drawing.
// Spec: docs/specs/calendar-view.md §1.3, §6.2.

import { describe, it, expect } from 'vitest';
import {
	clearOccurrence,
	moveOccurrence,
	placeCards,
	sourceValue,
	type Occurrence,
} from '../src/model/calendar';
import { formatDate } from '../src/model/dates';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead({
	views: [
		{ id: 'v1', name: 'Dates', type: 'calendar', dateProperties: ['start', 'due'], mode: 'month' },
	],
	properties: [
		{ name: 'start', type: 'datetime' },
		{ name: 'due', type: 'datetime' },
		{ name: 'sprint', type: 'date-range' },
		{ name: 'window', type: 'date-range' },
		{ name: 'dates', type: 'date-list' },
		{ name: 'repeat', type: 'recurrence' },
		{ name: 'owner', type: 'string' },
	],
});

const board = (...cards: string[]): Board =>
	parseBoard([FM, '', '## To do', '', ...cards, ''].join('\n'));

const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);

/** The properties behind a placement, in the order the view reads them. */
const names = (occurrence: Occurrence): string[] =>
	occurrence.sources.map((source) => source.property);

const july = { from: { y: 2026, m: 7, d: 1 }, to: { y: 2026, m: 7, d: 31 } };

describe('calendar: several date properties (§1.3)', () => {
	it('merges two dates that land on the same day into one card', () => {
		const b = board('- Ship @{start|2026-07-28} @{due|2026-07-28}');
		const { occurrences } = placeCards(b, ['start', 'due']);
		expect(occurrences).toHaveLength(1);
		expect(names(occurrences[0]!)).toEqual(['start', 'due']);
	});

	it('keeps two dates on different days as two cards', () => {
		const b = board('- Ship @{start|2026-07-20} @{due|2026-07-28}');
		const { occurrences } = placeCards(b, ['start', 'due']);
		expect(occurrences).toHaveLength(2);
		expect(occurrences.map((o) => formatDate(o.start))).toEqual(['2026-07-20', '2026-07-28']);
		expect(occurrences.map(names)).toEqual([['start'], ['due']]);
	});

	it('merges a range contained in another, keeping the wider geometry', () => {
		const b = board('- Work @{sprint|2026-07-06 → 2026-07-17} @{window|2026-07-08 → 2026-07-10}');
		const { occurrences } = placeCards(b, ['sprint', 'window']);
		expect(occurrences).toHaveLength(1);
		expect(occurrences[0]?.length).toBe(12);
		expect(names(occurrences[0]!)).toEqual(['sprint', 'window']);
	});

	it('merges two ranges that cover exactly the same days', () => {
		const b = board('- Work @{sprint|2026-07-06 → 2026-07-10} @{window|2026-07-06 → 2026-07-10}');
		expect(placeCards(b, ['sprint', 'window']).occurrences).toHaveLength(1);
	});

	it('keeps ranges that only overlap as two bars', () => {
		const b = board('- Work @{sprint|2026-07-06 → 2026-07-10} @{window|2026-07-08 → 2026-07-14}');
		const { occurrences } = placeCards(b, ['sprint', 'window']);
		expect(occurrences).toHaveLength(2);
		expect(occurrences.map(names)).toEqual([['sprint'], ['window']]);
	});

	it('draws a range and a date separately, even when the date is inside it', () => {
		const b = board('- Work @{sprint|2026-07-06 → 2026-07-17} @{due|2026-07-10}');
		const { occurrences } = placeCards(b, ['sprint', 'due']);
		expect(occurrences).toHaveLength(2);
		expect(occurrences.map((o) => o.length)).toEqual([12, 1]);
	});

	it('merges a repeated day with a plain date on that day, and stays repeating', () => {
		const b = board('- Standup @{repeat|every week on Mon from 2026-07-06} @{due|2026-07-13}');
		const { occurrences } = placeCards(b, ['repeat', 'due'], july);
		const merged = occurrences.filter((o) => o.sources.length > 1);
		expect(merged).toHaveLength(1);
		expect(formatDate(merged[0]!.start)).toBe('2026-07-13');
		expect(merged[0]?.repeating).toBe(true);
		// The other three Mondays are still their own days.
		expect(occurrences).toHaveLength(4);
	});

	it('joins three values that meet pairwise into a single placement', () => {
		const b = board('- All @{start|2026-07-28} @{due|2026-07-28} @{dates|2026-07-28}');
		const { occurrences } = placeCards(b, ['start', 'due', 'dates']);
		expect(occurrences).toHaveLength(1);
		expect(names(occurrences[0]!)).toEqual(['start', 'due', 'dates']);
	});

	it('never merges placements of two different cards', () => {
		const b = board('- One @{due|2026-07-28}', '- Two @{due|2026-07-28}');
		expect(placeCards(b, ['due']).occurrences).toHaveLength(2);
	});

	it('is undated only when no property places the card', () => {
		const b = board(
			'- Half @{start|2026-07-20} @{due|sometime}',
			'- None @{start|whenever} @{owner|Ann}',
		);
		const { occurrences, undated } = placeCards(b, ['start', 'due']);
		expect(occurrences).toHaveLength(1);
		expect(undated).toEqual([{ stack: 0, item: 1 }]);
	});

	it('ignores a property the view does not read', () => {
		const b = board('- Ship @{start|2026-07-20} @{due|2026-07-28}');
		const { occurrences } = placeCards(b, ['due']);
		expect(occurrences).toHaveLength(1);
		expect(names(occurrences[0]!)).toEqual(['due']);
	});
});

describe('calendar: editing a merged placement (§6.2)', () => {
	const merged = (b: Board): Occurrence => placeCards(b, ['start', 'due']).occurrences[0]!;

	it('moves only the property the caller picked', () => {
		const b = board('- Ship @{start|2026-07-28} @{due|2026-07-28}');
		const out = moveOccurrence(
			b,
			merged(b),
			{ property: 'due', index: 0 },
			'datetime',
			{ y: 2026, m: 7, d: 28 },
			{ y: 2026, m: 7, d: 31 },
		);
		expect(body(out)).toContain('@{start|2026-07-28}');
		expect(body(out)).toContain('@{due|2026-07-31}');
		// Two dates, two days: the card now draws twice.
		expect(placeCards(out, ['start', 'due']).occurrences).toHaveLength(2);
	});

	it('moves every source when the caller picks them all', () => {
		const b = board('- Ship @{start|2026-07-28} @{due|2026-07-28}');
		const occurrence = merged(b);
		const out = occurrence.sources.reduce(
			(acc, source) =>
				moveOccurrence(acc, occurrence, source, 'datetime', { y: 2026, m: 7, d: 28 }, { y: 2026, m: 7, d: 31 }),
			b,
		);
		expect(body(out)).toContain('@{start|2026-07-31}');
		expect(body(out)).toContain('@{due|2026-07-31}');
		expect(placeCards(out, ['start', 'due']).occurrences).toHaveLength(1);
	});

	it('shifts a merged range by the delta without stretching the inner one', () => {
		const b = board('- Work @{sprint|2026-07-06 → 2026-07-17} @{window|2026-07-08 → 2026-07-10}');
		const occurrence = placeCards(b, ['sprint', 'window']).occurrences[0]!;
		const out = occurrence.sources.reduce(
			(acc, source) =>
				moveOccurrence(acc, occurrence, source, 'date-range', { y: 2026, m: 7, d: 6 }, { y: 2026, m: 7, d: 8 }),
			b,
		);
		expect(body(out)).toContain('@{sprint|2026-07-08 → 2026-07-19}');
		expect(body(out)).toContain('@{window|2026-07-10 → 2026-07-12}');
	});

	it('clears only the picked property, leaving the card on the grid', () => {
		const b = board('- Ship @{start|2026-07-28} @{due|2026-07-28}');
		const out = clearOccurrence(b, merged(b), { property: 'start', index: 0 }, 'datetime');
		expect(body(out)).not.toContain('@{start');
		expect(body(out)).toContain('@{due|2026-07-28}');
		expect(placeCards(out, ['start', 'due']).undated).toHaveLength(0);
	});

	it('reads back the value behind a source, for the picker to show', () => {
		const b = board('- Ship @{start|2026-07-28} @{dates|2026-07-25; 2026-07-28}');
		const entry = b.stacks[0]?.items[0];
		const card = entry?.kind === 'card' ? entry.card : null;
		expect(sourceValue(card, { property: 'start', index: 0 })).toBe('2026-07-28');
		expect(sourceValue(card, { property: 'dates', index: 1 })).toBe('2026-07-28');
		expect(sourceValue(card, { property: 'nope', index: 0 })).toBeUndefined();
		expect(sourceValue(null, { property: 'start', index: 0 })).toBeUndefined();
	});
});
