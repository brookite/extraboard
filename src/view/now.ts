// "Now" as an explicit context value, so time-dependent rendering survives
// memoization. Spec: docs/plans/m10-perf.md §2.3, docs/specs/i18n-and-dates.md §2.
//
// Before `memo`, relative labels and date highlights refreshed because the whole
// board re-rendered on the 60-second tick. Under `memo` that stops working: the
// board object is unchanged, so nothing below it re-renders. Time therefore
// becomes a context value — a context update reaches exactly the consumers that
// read it (the date badges and the calendar's "today") and nothing else.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { nowStamp, type Now } from '../model/dateHighlights';

/**
 * The value's **identity is stable within a minute**, which is what makes the
 * whole scheme work: an ordinary edit re-renders the provider, hands out the
 * same object, and every memoized subtree stays skipped. Only a real minute
 * boundary changes it.
 */
let cached: Now = nowStamp();

function same(a: Now, b: Now): boolean {
	return a.date.y === b.date.y && a.date.m === b.date.m && a.date.d === b.date.d && a.minutes === b.minutes;
}

export function currentNow(): Now {
	const fresh = nowStamp();
	if (!same(cached, fresh)) cached = fresh;
	return cached;
}

/** `null` = no provider above, which is a real case: the archive modal renders
 * badges in its own Preact root. Those read the clock directly instead. */
export const NowContext = createContext<Now | null>(null);

export function useNow(): Now {
	return useContext(NowContext) ?? currentNow();
}
