// Placing cards on a calendar, and the date edits the grid performs.
// Spec: docs/specs/calendar-view.md §1.3, §5.3, §6. Pure; no `obsidian`.

import {
	CalDate,
	addDays,
	compareDates,
	dayKey,
	daysBetween,
	formatDate,
	formatSpan,
	parseSpan,
	stripTime,
} from './dates';
import { removeCardProperty, setCardProperty, type ItemRef } from './ops';
import {
	expandRecurrence,
	formatRecurrence,
	parseRecurrence,
	shiftRecurrence,
	singleDayRule,
} from './recurrence';
import type { Board, BoardConfig, Card, PropertyValue } from './types';

/**
 * Where one placement came from: a property of the card, and which of its
 * values. A calendar reads several properties (§1.3), so a placement has to
 * remember the one a drag would edit.
 */
export interface OccurrenceSource {
	property: string;
	/** Element index within a `date-list`; 0 for a single-valued property. */
	index: number;
}

/** One placement of a card on the grid. */
export interface Occurrence {
	ref: ItemRef;
	/**
	 * The values that produced this placement, in the view's property order.
	 * More than one means they were merged: the same card, the same cell (§1.3).
	 */
	sources: OccurrenceSource[];
	start: CalDate;
	/** Inclusive; equal to `start` for a single day. */
	end: CalDate;
	hasTime: boolean;
	/** Days covered, ≥ 1. */
	length: number;
	/** This day comes from a repetition rule (recurrence.md §3). */
	repeating?: boolean;
}

export interface Placement {
	occurrences: Occurrence[];
	/** Cards the view cannot place: no value, or one that does not parse (§4). */
	undated: ItemRef[];
}

/** The period a recurrence is expanded over; unbounded values ignore it. */
export interface Window {
	from: CalDate;
	to: CalDate;
}

/** The card's value for this property, whatever its declared type. */
function valueOf(card: Card, property: string): PropertyValue | undefined {
	return card.properties.find((pv) => pv.name === property);
}

/** Raw date strings a value contributes, in element order. */
function rawDates(pv: PropertyValue | undefined): string[] {
	if (!pv) return [];
	switch (pv.type) {
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return [pv.raw];
		case 'date-list':
			return pv.raw;
		// Any other type is not a date, which leaves the card undated (§1.1).
		default:
			return [];
	}
}

/**
 * The series anchor for a rule with no `from` (recurrence.md §1.2): the earliest
 * parseable date among the card's **other** date properties. Absent means the
 * card is undated — a series is never anchored to "today".
 */
export function anchorFor(card: Card, property: string): CalDate | undefined {
	let best: CalDate | undefined;
	for (const pv of card.properties) {
		if (pv.name === property) continue;
		for (const raw of rawDates(pv)) {
			const span = parseSpan(raw);
			if (span && (!best || compareDates(span.start, best) < 0)) best = span.start;
		}
	}
	return best;
}

/**
 * Whether two placements of the **same card** are one thing on the grid (§1.3).
 * The rule follows what the grid draws rather than what the dates mean:
 *
 * - two single days on the same day are one cell, so they are one card;
 * - one range inside another is one bar, so they are one card;
 * - a range and a single day are a bar *and* a chip — two drawings, and
 *   therefore two cards, even when the day falls inside the range;
 * - ranges that merely overlap stay two bars.
 */
function mergeable(a: Occurrence, b: Occurrence): boolean {
	const points = a.length === 1 && b.length === 1;
	if (points) return dayKey(a.start) === dayKey(b.start);
	if (a.length === 1 || b.length === 1) return false;
	return contains(a, b) || contains(b, a);
}

/** True iff `outer` covers every day of `inner`. */
function contains(outer: Occurrence, inner: Occurrence): boolean {
	return dayKey(outer.start) <= dayKey(inner.start) && dayKey(inner.end) <= dayKey(outer.end);
}

/**
 * One occurrence out of two that share a cell: the wider geometry wins, the
 * earlier start keeps its time, and both origins are remembered so a drag can
 * ask which of them it is meant to move.
 */
function fuse(a: Occurrence, b: Occurrence): Occurrence {
	const wider = a.length >= b.length ? a : b;
	const earlier = compareDates(a.start, b.start) <= 0 ? a : b;
	return {
		...wider,
		sources: [...a.sources, ...b.sources],
		start: earlier.start,
		hasTime: a.hasTime || b.hasTime,
		...((a.repeating ?? b.repeating) && { repeating: true }),
	};
}

/**
 * Collapse the placements that share a cell, card by card (§1.3). Repeated
 * until nothing more merges: three values can meet pairwise in an order that
 * one pass would leave half-joined.
 */
export function mergeOccurrences(occurrences: Occurrence[]): Occurrence[] {
	const byCard = new Map<string, Occurrence[]>();
	for (const occurrence of occurrences) {
		const key = `${String(occurrence.ref.stack)}:${String(occurrence.ref.item)}`;
		const list = byCard.get(key);
		if (list) list.push(occurrence);
		else byCard.set(key, [occurrence]);
	}

	const out: Occurrence[] = [];
	for (const list of byCard.values()) {
		const merged = list.slice();
		for (let again = true; again; ) {
			again = false;
			outer: for (let i = 0; i < merged.length; i++) {
				for (let j = i + 1; j < merged.length; j++) {
					const a = merged[i]!;
					const b = merged[j]!;
					if (!mergeable(a, b)) continue;
					merged.splice(j, 1);
					merged[i] = fuse(a, b);
					again = true;
					break outer;
				}
			}
		}
		out.push(...merged);
	}
	return out;
}

/**
 * Index the whole board in one pass, over every property the view is computed
 * from (§1.3). Cards in collapsed stacks and groups are placed like any other:
 * collapsing is a Kanban layout decision (§1.4).
 */
export function placeCards(board: Board, properties: string[], window?: Window): Placement {
	const occurrences: Occurrence[] = [];
	const undated: ItemRef[] = [];

	board.stacks.forEach((stack, s) => {
		stack.items.forEach((entry, i) => {
			if (entry.kind !== 'card') return;
			const ref: ItemRef = { stack: s, item: i };
			// "Understood" is not "visible": a rule with no hit in this window is
			// still a dated card and must not fall into the tray (recurrence.md §3).
			// One property being unreadable is not enough either — the card is
			// undated only when *none* of them places it.
			let understood = 0;
			for (const property of properties) {
				rawDates(valueOf(entry.card, property)).forEach((raw, index) => {
					const source: OccurrenceSource = { property, index };
					const span = parseSpan(raw);
					if (span) {
						understood++;
						occurrences.push({
							ref,
							sources: [source],
							start: span.start,
							end: span.end,
							hasTime: span.start.minutes !== undefined,
							length: daysBetween(span.end, span.start) + 1,
						});
						return;
					}
					const rule = parseRecurrence(raw);
					if (!rule) return;
					const anchor = rule.start ?? anchorFor(entry.card, property);
					if (!anchor) return;
					understood++;
					if (!window) return;
					for (const day of expandRecurrence(rule, anchor, window.from, window.to)) {
						occurrences.push({
							ref,
							sources: [source],
							start: day,
							end: day,
							hasTime: day.minutes !== undefined,
							length: 1,
							repeating: true,
						});
					}
				});
			}
			if (understood === 0) undated.push(ref);
		});
	});

	const merged = mergeOccurrences(occurrences);
	merged.sort(
		(a, b) =>
			compareDates(a.start, b.start) ||
			b.length - a.length ||
			a.ref.stack - b.ref.stack ||
			a.ref.item - b.ref.item,
	);
	return { occurrences: merged, undated };
}

/** Occurrences touching `[from, to]`, keyed by the day they are asked about. */
export function occurrencesOn(occurrences: Occurrence[], day: CalDate): Occurrence[] {
	const key = dayKey(day);
	return occurrences.filter(
		(o) => dayKey(o.start) <= key && key <= dayKey(o.end),
	);
}

// --- edits ------------------------------------------------------------------

function write(board: Board, ref: ItemRef, property: string, type: PropertyValue['type'], raw: string[]): Board {
	if (raw.length === 0) return removeCardProperty(board, ref, property);
	if (type === 'date-list') {
		return setCardProperty(board, ref, { name: property, type: 'date-list', raw });
	}
	const only = raw[0] ?? '';
	const single = type === 'date-range' || type === 'recurrence' ? type : 'datetime';
	return setCardProperty(board, ref, { name: property, type: single, raw: only });
}

/** The raw text one source points at — what a picker shows beside its name. */
export function sourceValue(card: Card | null, source: OccurrenceSource): string | undefined {
	if (!card) return undefined;
	return rawDates(valueOf(card, source.property))[source.index];
}

/** The card behind a ref, when it still is one. */
function cardAt(board: Board, ref: ItemRef): Card | null {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'card' ? entry.card : null;
}

/** Everything the card currently holds for this property, as raw elements. */
function currentRaw(board: Board, ref: ItemRef, property: string): string[] {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	if (entry?.kind !== 'card') return [];
	return rawDates(valueOf(entry.card, property));
}

/**
 * Give a card a single day — the composer (§5.3) and a drop out of the "No date"
 * tray (§6). Whatever the property held before is replaced.
 */
export function setCardDay(
	board: Board,
	ref: ItemRef,
	property: string,
	type: PropertyValue['type'],
	day: CalDate,
): Board {
	const at = stripTime(day);
	const raw =
		type === 'date-range'
			? formatSpan({ start: at, end: at })
			: type === 'recurrence'
				? // A day is not a rule, so it becomes the one-day rule
					// (recurrence.md §3.2) rather than an unreadable value.
					formatRecurrence(singleDayRule(at))
				: formatDate(at);
	return write(board, ref, property, type, [raw]);
}

/**
 * The declared type of a date property — what an edit has to write back. An
 * undeclared name reads as a plain `datetime`, the shape a bare date has.
 */
export function datePropertyType(config: BoardConfig, property: string): PropertyValue['type'] {
	return config.properties.find((p) => p.name === property)?.type ?? 'datetime';
}

/**
 * Move one occurrence to another day (§6), through the value named by `source`
 * — a merged occurrence has several, and picking between them is the caller's
 * decision (§6.2). A `datetime` keeps its time; a range **shifts by the drag's
 * delta** so its length survives; a `date-list` moves only the element that was
 * dragged.
 */
export function moveOccurrence(
	board: Board,
	occurrence: Occurrence,
	source: OccurrenceSource,
	type: PropertyValue['type'],
	fromDay: CalDate,
	toDay: CalDate,
): Board {
	const delta = daysBetween(toDay, fromDay);
	if (delta === 0) return board;

	const property = source.property;
	const raw = currentRaw(board, occurrence.ref, property).slice();
	if (raw.length === 0) return board;
	const at = Math.min(source.index, raw.length - 1);

	// A repeating occurrence moves its **rule**, not that one day: there are no
	// exceptions in the format, so the series is what a drag can mean (§3.1).
	if (occurrence.repeating) {
		const card = cardAt(board, occurrence.ref);
		const rule = card ? parseRecurrence(raw[at] ?? '') : null;
		const anchor = rule?.start ?? (card ? anchorFor(card, property) : undefined);
		if (!rule || !anchor) return board;
		raw[at] = formatRecurrence(shiftRecurrence(rule, anchor, delta));
		return write(board, occurrence.ref, property, type, raw);
	}

	// The moved value's own span, which a merged occurrence's geometry is not:
	// the widest source lends the bar its length, and shifting *that* would
	// stretch a shorter sibling to match.
	const own = parseSpan(raw[at] ?? '');
	const start = addDays(own?.start ?? occurrence.start, delta);
	const end = addDays(own?.end ?? occurrence.end, delta);
	const single = daysBetween(end, start) === 0;
	raw[at] = single && type !== 'date-range' ? formatDate(start) : formatSpan({ start, end });
	return write(board, occurrence.ref, property, type, raw);
}

/**
 * Clear a card's date — a drop onto the "No date" tray (§6). Only the value
 * named by `source` goes: a merged occurrence keeps whatever the caller did not
 * pick. For a `date-list` only the dragged element goes; the property itself
 * goes with the last one.
 */
export function clearOccurrence(
	board: Board,
	occurrence: Occurrence,
	source: OccurrenceSource,
	type: PropertyValue['type'],
): Board {
	const property = source.property;
	if (type !== 'date-list') return removeCardProperty(board, occurrence.ref, property);
	const raw = currentRaw(board, occurrence.ref, property).slice();
	if (source.index >= raw.length) return board;
	raw.splice(source.index, 1);
	return write(board, occurrence.ref, property, type, raw);
}
