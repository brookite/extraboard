// Telling a tap from a scroll, for the surfaces that close when the user points
// somewhere else. Spec: docs/specs/mobile.md §7.
//
// A finger that starts on a card and moves is scrolling the stack, not choosing
// something — and on a board the two gestures start identically. Anything that
// dismisses on the *press* therefore closes itself the moment the user tries to
// scroll, which is what made a card editor impossible to rescue from behind the
// software keyboard: the scroll that would have moved it also dropped it.

/** How far a finger may drift and still count as a tap, in px. */
const TAP_SLOP = 10;

/**
 * Whether a press that moved by `dx`/`dy` was a tap. Generous enough for a
 * finger on a moving surface, tight enough that a deliberate scroll never
 * qualifies; a mouse click reports `0` for both.
 */
export function isTap(dx: number, dy: number, slop: number = TAP_SLOP): boolean {
	return Math.abs(dx) <= slop && Math.abs(dy) <= slop;
}

/** How long after a tap a second one still counts as a double tap, in ms. */
const DOUBLE_TAP_MS = 400;

/**
 * Whether a tap at `now` continues the tap recorded at `previous` (a timestamp
 * from `Date.now()`, or `0` for "no tap pending").
 *
 * A label that both opens a group and renames it cannot afford the usual
 * `dblclick` event: on touch it is unreliable, and it arrives only *after* the
 * click that already acted. So the two gestures share one click handler — the
 * first tap acts, the second undoes it and renames instead (mobile.md §8).
 */
export function isDoubleTap(previous: number, now: number = Date.now()): boolean {
	return previous > 0 && now - previous <= DOUBLE_TAP_MS;
}
