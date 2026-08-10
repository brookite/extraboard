// What the software keyboard occupies, and when it changes.
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
// The signals below are the ones Obsidian's own mobile toolbar uses — it
// re-reads `--keyboard-height` inside these very events and animates itself by
// the delta, with explicit Android and iOS branches, which is what establishes
// that they fire on both. None of them is in `obsidian.d.ts`; a missing value
// reads as `0` and makes this module inert rather than wrong.

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
 * returns `0` and the reserve lifts itself.
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
 * What announces a keyboard. `resize` is here for orientation, which changes
 * the band under an open editor; the visual viewport is deliberately *not*,
 * having stayed at a constant 914 px through every measured keyboard on the
 * device this was built against — it is the sensor that failed twice.
 */
const SIGNALS = ['keyboardWillShow', 'keyboardWillHide', 'resize'] as const;

/**
 * Re-measurements after a change, in ms. The events fire at the *start* of the
 * keyboard's animation (Obsidian animates its own toolbar over 350 ms on
 * Android, 300 on iOS), so nothing about the layout is final when they arrive:
 * the device this was measured on moved the leaf's bottom edge twice, once with
 * the toolbar and again — several hundred ms later — for the keyboard itself.
 * The first pass is where the reserve is allowed to grow; the last one catches
 * a platform that shrank the leaf on its own and lets the reserve go again.
 */
const SETTLE_MS = [360, 800] as const;

/**
 * Call `onChange` whenever the keyboard may have changed the layout, and again
 * once the animation has run. `settled` is false only for the immediate pass,
 * when the keyboard is announced but not yet drawn. Returns the unsubscribe.
 */
export function onKeyboardChange(onChange: (settled: boolean) => void): () => void {
	const timers: number[] = [];
	const handle = (): void => {
		onChange(false);
		for (const t of timers.splice(0)) window.clearTimeout(t);
		for (const ms of SETTLE_MS) timers.push(window.setTimeout(() => onChange(true), ms));
	};
	for (const name of SIGNALS) window.addEventListener(name, handle);
	// A first pass right away: the editor may open while the keyboard is already
	// up, in which case no event is coming at all.
	handle();
	return () => {
		for (const t of timers.splice(0)) window.clearTimeout(t);
		for (const name of SIGNALS) window.removeEventListener(name, handle);
	};
}
