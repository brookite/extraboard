// What the software keyboard occupies.
// Spec: docs/specs/mobile.md §7. Undocumented app internals: docs/NOTICES.md.
//
// Obsidian publishes the keyboard's height itself, and this module is the only
// place that reads it. Two earlier attempts at §7 used `window.visualViewport`
// instead and both failed on the user's Android device for the same reason:
// measured there, the visual viewport and `window.innerHeight` both stay at a
// constant 914 px through the entire keyboard — what moves, several hundred ms
// late, is the leaf — so the overlap came out `0` and the feature silently did
// nothing, twice.
//
// The events this module's caller listens for are the ones Obsidian's own
// mobile toolbar uses — it re-reads `--keyboard-height` inside these very
// events and animates itself by the delta, with explicit Android and iOS
// branches, which is what establishes that they fire on both. None of them is
// in `obsidian.d.ts`; a missing value reads as `0` and makes this module inert
// rather than wrong.

/** Height of a CSS length in px, or `0` for an absent or unparseable value. */
function pxOf(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The band at the bottom of the screen the user cannot reach, in px.
 *
 * The editing toolbar floats in the gap *above* the keyboard, so it is part of
 * the same band — but only while it is actually up. Pure, so the composition is
 * testable without a phone, which is the one thing this feature cannot be
 * checked on anywhere else (§8).
 */
export function bandOf(keyboard: number, toolbar: number, toolbarOpen: boolean): number {
	if (!(keyboard > 0)) return 0;
	const extra = toolbarOpen && toolbar > 0 ? toolbar : 0;
	return Math.round(keyboard + extra);
}

/**
 * How much of a board ending at `rootBottom` the band actually covers, in px.
 *
 * The band is measured from the bottom of the window, so this is what turns it
 * into a reserve — and the subtraction is not a detail. Obsidian's Android app
 * **does** shrink the leaf for the keyboard, only late (measured on the user's
 * device, 2026-08-10: the root's bottom went 914 → 862 when the toolbar opened
 * and → 530 once the keyboard had settled, exactly `914 − 332 − 52`). Reserving
 * the whole band on top of that would take the same space twice and leave a
 * board a few dozen pixels tall. Once the platform has done the work this
 * returns `0` and the reserve lifts itself — which is why the caller re-runs
 * this on every real resize of the root rather than assuming a fixed shape to
 * the platform's own animation.
 */
export function overlapOf(rootBottom: number, windowHeight: number, band: number): number {
	if (band <= 0) return 0;
	return Math.max(0, Math.round(rootBottom - (windowHeight - band)));
}

/** The band right now, read from the app's own variables. */
export function keyboardBand(): number {
	const root = document.documentElement;
	return bandOf(
		pxOf(getComputedStyle(root).getPropertyValue('--keyboard-height')),
		pxOf(getComputedStyle(document.body).getPropertyValue('--mobile-toolbar-height')),
		document.body.hasClass('mod-toolbar-open'),
	);
}

/**
 * What announces a keyboard, for `keyboardReserve.ts` to re-measure on.
 * `resize` is here for orientation, which changes the band under an open
 * editor; the visual viewport is deliberately *not*, having stayed at a
 * constant 914 px through every measured keyboard on the device this was
 * built against — it is the sensor that failed twice.
 *
 * These only say "something may have changed" — none of them fires again once
 * the platform's own late resize of the leaf actually lands, several hundred
 * ms after the keyboard is announced. That resize is what a `ResizeObserver`
 * on the root is for: a real signal instead of a guess at its timing.
 */
export const KEYBOARD_EVENTS = ['keyboardWillShow', 'keyboardWillHide', 'resize'] as const;
