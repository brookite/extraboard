// The daily and weekly digest: which cards belong to a period, and when the
// digest is due. Spec: docs/specs/digest-and-reminders.md §3.
// Pure; no `obsidian` imports.

import { placeCards, type Window } from './calendar';
import { addDays, dayKey, daysBetween, parseMinutesClock, startOfWeek, type CalDate } from './dates';
import { filterCards, type FilterNode } from './filter';
import type { FieldCtx } from './fieldValue';
import { isCardDone, type ItemRef } from './ops';
import { sortCards, type SortRule } from './sort';
import type { Board } from './types';
import { dateProperties } from './views';

export type DigestKind = 'daily' | 'weekly';

export const DIGEST_KINDS: readonly DigestKind[] = ['daily', 'weekly'];

export interface DigestDef {
	/** `HH:mm`, the earliest time of day it is shown; `00:00` when unset. */
	time: string;
	/** Date properties placing cards; absent = every date property. */
	properties?: string[];
	/** Weekly only: 0 = Sunday … 6; absent = the plugin's week start. */
	weekStart?: number;
	filter?: FilterNode;
	sorts?: SortRule[];
}

export interface DigestConfig {
	daily?: DigestDef;
	weekly?: DigestDef;
}

export const DEFAULT_DIGEST_TIME = '00:00';

/** The digest's time of day in minutes; anything unreadable is midnight. */
export function digestMinutes(def: DigestDef): number {
	return parseMinutesClock(def.time) ?? 0;
}

/**
 * The period holding `today` (`offset` 0), or the one before it (`-1`): one day,
 * or the week starting on `weekStart` (§3.2).
 */
export function periodWindow(kind: DigestKind, today: CalDate, weekStart: number, offset = 0): Window {
	if (kind === 'daily') {
		const day = addDays({ y: today.y, m: today.m, d: today.d }, offset);
		return { from: day, to: day };
	}
	const from = addDays(startOfWeek(today, weekStart), offset * 7);
	return { from, to: addDays(from, 6) };
}

/** The key a shown period is remembered by: its first day. */
export function periodKey(kind: DigestKind, today: CalDate, weekStart: number): string {
	return dayKey(periodWindow(kind, today, weekStart).from);
}

/**
 * Whether the digest should be shown now (§3.3): the period's first day at the
 * digest's time has passed, and this period was not shown yet. A check that
 * comes later in the period catches up.
 */
export function digestDue(
	kind: DigestKind,
	def: DigestDef,
	now: { date: CalDate; minutes: number },
	weekStart: number,
	lastKey: string | undefined,
): boolean {
	const window = periodWindow(kind, now.date, weekStart);
	if (dayKey(window.from) === lastKey) return false;
	return daysBetween(now.date, window.from) > 0 || now.minutes >= digestMinutes(def);
}

export interface DigestSections {
	/** Every card of the current period, in display order. */
	current: ItemRef[];
	/** The previous period's cards that are done now, and how many it had. */
	previous: { done: ItemRef[]; total: number };
}

function refKey(ref: ItemRef): string {
	return `${String(ref.stack)}:${String(ref.item)}`;
}

/**
 * Cards with an occurrence touching the window, once each, in date order.
 * `skipRepeating` leaves out what only a recurrence rule placed there.
 */
function cardsIn(board: Board, properties: string[], window: Window, skipRepeating: boolean): ItemRef[] {
	const from = dayKey(window.from);
	const to = dayKey(window.to);
	const seen = new Set<string>();
	const out: ItemRef[] = [];
	// `placeCards` returns every plain date whatever the window — only a rule is
	// expanded inside it — so the overlap is checked here.
	for (const occurrence of placeCards(board, properties, window).occurrences) {
		if (skipRepeating && occurrence.repeating) continue;
		if (dayKey(occurrence.end) < from || dayKey(occurrence.start) > to) continue;
		const key = refKey(occurrence.ref);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(occurrence.ref);
	}
	return out;
}

/** The properties a digest reads: its own list, else every date property. */
export function digestProperties(board: Board, def: DigestDef): string[] {
	const declared = dateProperties(board.config).map((p) => p.name);
	if (!def.properties?.length) return declared;
	return def.properties.filter((name) => declared.includes(name));
}

/**
 * The digest's two sections (§3.4). `filter` and `sorts` are what is applied —
 * the definition's own, or a session override from the modal.
 */
export function digestSections(
	board: Board,
	kind: DigestKind,
	def: DigestDef,
	ctx: FieldCtx & { weekStart: number },
	view: { filter?: FilterNode; sorts?: SortRule[] } = def,
): DigestSections {
	const properties = digestProperties(board, def);
	const pick = (refs: ItemRef[]): ItemRef[] =>
		sortCards(board, filterCards(board, refs, view.filter, ctx), view.sorts, ctx);

	const current = pick(cardsIn(board, properties, periodWindow(kind, ctx.today, ctx.weekStart), false));
	const previous = pick(cardsIn(board, properties, periodWindow(kind, ctx.today, ctx.weekStart, -1), true));
	const done = previous.filter((ref) => {
		const entry = board.stacks[ref.stack]?.items[ref.item];
		return entry?.kind === 'card' && isCardDone(entry.card);
	});
	return { current, previous: { done, total: previous.length } };
}
