// Reminders: rules that surface cards whose date is near or past.
// Spec: docs/specs/digest-and-reminders.md §4. Pure; no `obsidian` imports.
//
// A reminder fires on **trigger instants** — an occurrence's start shifted by
// each offset — and the only memory it needs is when it was last checked: a
// trigger fires once if it falls between that and now. Cards have no ids, so
// remembering *which* cards fired would have been fragile; this is not.

import { anchorFor } from './calendar';
import { addDays, parseSpan, type CalDate } from './dates';
import { filterCards, isEmptyFilter, matchCard, type FilterNode } from './filter';
import type { FieldCtx } from './fieldValue';
import type { ItemRef } from './ops';
import { expandRecurrence, parseRecurrence } from './recurrence';
import { sortCards, type SortRule } from './sort';
import type { Board, Card, PropertyValue } from './types';

export type ReminderRepeat = 'once' | 'launch';

export type ReminderUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

export const REMINDER_UNITS: readonly ReminderUnit[] = ['minute', 'hour', 'day', 'week', 'month'];

export interface ReminderOffset {
	dir: 'before' | 'after';
	/** Integer ≥ 0. */
	amount: number;
	unit: ReminderUnit;
}

export interface ReminderDef {
	/** Stable, `[A-Za-z0-9_-]{1,32}`, unique on the board. */
	id: string;
	/** The modal section it is listed under; the same comment, the same section. */
	comment: string;
	/** One date property. */
	property: string;
	repeat: ReminderRepeat;
	/** Empty = at the date itself. */
	offsets: ReminderOffset[];
	filter?: FilterNode;
	/** `launch` only: a card matching it is no longer reminded. */
	endFilter?: FilterNode;
	sorts?: SortRule[];
}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function isReminderId(id: string): boolean {
	return ID_RE.test(id);
}

/** Lowest free `r<n>` id. */
export function nextReminderId(reminders: readonly ReminderDef[]): string {
	const taken = new Set(reminders.map((r) => r.id));
	for (let n = 1; ; n++) {
		const id = `r${String(n)}`;
		if (!taken.has(id)) return id;
	}
}

/** "Checkbox is set" — what a new `launch` reminder ends on (§4.1). */
export function doneFilter(): FilterNode {
	return {
		kind: 'group',
		op: 'and',
		children: [{ kind: 'condition', field: { kind: 'builtin', id: 'done' }, op: 'isSet' }],
	};
}

// --- instants ---------------------------------------------------------------

/**
 * A date as a local instant, epoch ms. A date without a time is the **start**
 * of its day (§4.2): a reminder is about when the day begins, not when it ends.
 */
export function instantOf(date: CalDate): number {
	const minutes = date.minutes ?? 0;
	return new Date(date.y, date.m - 1, date.d, Math.floor(minutes / 60), minutes % 60).getTime();
}

/**
 * `ms` moved by `amount` units, in local wall-clock terms: a day is a calendar
 * day across a DST change, a month a calendar month with the day clamped.
 */
export function shiftInstant(ms: number, amount: number, unit: ReminderUnit): number {
	const date = new Date(ms);
	switch (unit) {
		case 'minute':
			return ms + amount * 60_000;
		case 'hour':
			return ms + amount * 3_600_000;
		case 'day':
			date.setDate(date.getDate() + amount);
			return date.getTime();
		case 'week':
			date.setDate(date.getDate() + amount * 7);
			return date.getTime();
		case 'month': {
			const day = date.getDate();
			date.setDate(1);
			date.setMonth(date.getMonth() + amount);
			const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
			date.setDate(Math.min(day, last));
			return date.getTime();
		}
	}
}

/** The instant one offset makes of an occurrence start. */
export function triggerAt(start: CalDate, offset: ReminderOffset): number {
	const sign = offset.dir === 'before' ? -1 : 1;
	return shiftInstant(instantOf(start), sign * offset.amount, offset.unit);
}

/** The offsets in force: none listed means "at the date itself". */
function offsetsOf(def: ReminderDef): ReminderOffset[] {
	return def.offsets.length ? def.offsets : [{ dir: 'after', amount: 0, unit: 'minute' }];
}

function toCalDate(ms: number): CalDate {
	const d = new Date(ms);
	return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** Raw date strings a value contributes. */
function rawDates(pv: PropertyValue | undefined): string[] {
	if (!pv) return [];
	switch (pv.type) {
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return [pv.raw];
		case 'date-list':
			return pv.raw;
		default:
			return [];
	}
}

/** How far back a `launch` reminder looks into a repetition rule (§4.4). */
const LAUNCH_LOOKBACK_DAYS = 366;

/**
 * True when some trigger of this card falls in `(lo, hi]` (§4.3). `lo` may be
 * `-Infinity` — a `launch` reminder — which only a repetition rule has to
 * bound: it is expanded over the year before `hi`.
 */
export function cardTriggered(card: Card, def: ReminderDef, lo: number, hi: number): boolean {
	const offsets = offsetsOf(def);
	for (const raw of rawDates(card.properties.find((pv) => pv.name === def.property))) {
		const span = parseSpan(raw);
		const starts: CalDate[] = [];
		if (span) {
			starts.push(span.start);
		} else {
			const rule = parseRecurrence(raw);
			const anchor = rule ? (rule.start ?? anchorFor(card, def.property)) : undefined;
			if (!rule || !anchor) continue;
			for (const offset of offsets) {
				// Map the trigger interval back onto occurrence days; a few days of
				// slack cover month clamping, and the exact test below decides.
				const sign = offset.dir === 'before' ? 1 : -1;
				const floor = Number.isFinite(lo) ? lo : hi - LAUNCH_LOOKBACK_DAYS * 86_400_000;
				const from = addDays(toCalDate(shiftInstant(floor, sign * offset.amount, offset.unit)), -3);
				const to = addDays(toCalDate(shiftInstant(hi, sign * offset.amount, offset.unit)), 3);
				for (const occ of expandRecurrence(rule, anchor, from, to)) starts.push(occ.start);
			}
		}
		for (const start of starts) {
			for (const offset of offsets) {
				const at = triggerAt(start, offset);
				if (at > lo && at <= hi) return true;
			}
		}
	}
	return false;
}

// --- evaluation -------------------------------------------------------------

/** One reminder as a check evaluated it: its trigger interval `(since, until]`. */
export interface ReminderRun {
	def: ReminderDef;
	/** Exclusive; `-Infinity` for a `launch` reminder. */
	since: number;
	until: number;
}

export interface ReminderSection {
	/** The reminders' shared comment, trimmed; `''` when they have none. */
	comment: string;
	refs: ItemRef[];
}

/** Every card ref on the board, in board order. */
function allCards(board: Board): ItemRef[] {
	return board.stacks.flatMap((stack, s) =>
		stack.items.flatMap((entry, item) => (entry.kind === 'card' ? [{ stack: s, item }] : [])),
	);
}

/** The cards one reminder run reminds of, filtered and sorted by its definition. */
export function reminderCards(board: Board, run: ReminderRun, ctx: FieldCtx): ItemRef[] {
	const { def } = run;
	const hit = allCards(board).filter((ref) => {
		const entry = board.stacks[ref.stack]?.items[ref.item];
		if (entry?.kind !== 'card') return false;
		if (!cardTriggered(entry.card, def, run.since, run.until)) return false;
		if (def.repeat === 'launch' && def.endFilter && !isEmptyFilter(def.endFilter)) {
			return !matchCard(entry.card, def.endFilter, ctx);
		}
		return true;
	});
	return sortCards(board, filterCards(board, hit, def.filter, ctx), def.sorts, ctx);
}

/**
 * The modal's sections (§4.5): one per distinct comment, in the order the
 * reminders come, each card listed once. `view` is the modal's session filter
 * and sort, applied on top of every reminder's own. Empty sections are dropped.
 */
export function reminderSections(
	board: Board,
	runs: readonly ReminderRun[],
	ctx: FieldCtx,
	view: { filter?: FilterNode; sorts?: SortRule[] } = {},
): ReminderSection[] {
	const sections: ReminderSection[] = [];
	for (const run of runs) {
		const comment = run.def.comment.trim();
		let section = sections.find((s) => s.comment === comment);
		if (!section) {
			section = { comment, refs: [] };
			sections.push(section);
		}
		for (const ref of reminderCards(board, run, ctx)) {
			if (!section.refs.some((r) => r.stack === ref.stack && r.item === ref.item)) section.refs.push(ref);
		}
	}
	return sections
		.map((section) => ({
			...section,
			refs: sortCards(board, filterCards(board, section.refs, view.filter, ctx), view.sorts, ctx),
		}))
		.filter((section) => section.refs.length > 0);
}
