// What the board does about the software keyboard: give up the height it takes,
// then bring the open editor into what is left. Spec: docs/specs/mobile.md §7.
//
// A board is a fixed-height layout — the view root is 100% high and each stack
// scrolls its cards inside it — so a keyboard that overlays the web view leaves
// the bottom band of every stack laid out underneath it. The cards are not
// clipped, they are hidden.
//
// Shortening the root is what fixes that, and it is also what makes the scroll
// afterwards possible at all: `.eb-stack` is `max-height: 100%`, so the reserve
// turns a stack whose cards used to fit into one that overflows — a scroller
// appears where there was none. Hence the order below, which is load-bearing:
// reserve first, measure second.
//
// The reserve is re-measured, not timed: `KEYBOARD_EVENTS` says a change is
// coming, and a `ResizeObserver` on the root itself catches the platform's own
// late resize of the leaf whenever it actually lands, however long that takes
// on a given device. An earlier version tried to guess that timing with a pair
// of fixed delays, which meant the reserve grew to a first estimate and then
// had to shrink again once the real resize caught up — a visible bounce for no
// reason a real signal does not already give for free.

import { Platform } from 'obsidian';
import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { KEYBOARD_EVENTS, keyboardBand, overlapOf } from './keyboard';
import { revealVertical } from './revealStack';

/** Marks a root that is currently giving up height to the keyboard. */
const OPEN_CLASS = 'is-keyboard-open';

/**
 * Roots holding a reserve, by how many editors asked for it. Closing one editor
 * by opening another briefly overlaps the two, and the count is what keeps the
 * first one's cleanup from dropping the reserve under the second.
 */
const held = new Map<HTMLElement, number>();

/**
 * Publish the reserve as a length plus a marker and let `styles.css` turn them
 * into padding — the shape §4's navbar inset already uses, so a theme can still
 * override it. (A round was spent believing the stylesheet had failed here; the
 * device was simply running a plugin folder whose `styles.css` had not been
 * copied along with `main.js`.)
 */
function applyReserve(root: HTMLElement, band: number): void {
	if (band <= 0) {
		root.removeClass(OPEN_CLASS);
		root.style.removeProperty('--eb-keyboard-inset');
		return;
	}
	root.setCssProps({ '--eb-keyboard-inset': `${String(band)}px` });
	root.addClass(OPEN_CLASS);
}

/**
 * While the referenced editor is mounted, keep it clear of the software
 * keyboard.
 *
 * Mobile-only, on the `is-mobile` input signal (mobile.md §1): a pointer device
 * has no keyboard to dodge, and the app publishes no height there anyway.
 */
export function useKeyboardReserve(ref: RefObject<HTMLElement>): void {
	useEffect(() => {
		const el = ref.current;
		if (!el || !Platform.isMobile) return;
		// Absent in a modal (the day modal mounts the same editor), where Obsidian
		// already owns the keyboard behaviour.
		const root = el.closest<HTMLElement>('.eb-root');
		if (root) held.set(root, (held.get(root) ?? 0) + 1);

		const update = (): void => {
			// The reserve first: `revealVertical` measures the scroller this creates.
			// Only the part of the band the board actually reaches into — the
			// platform may already have shrunk the leaf itself, and reserving the
			// whole band on top of that takes the same space twice.
			if (root) {
				applyReserve(
					root,
					overlapOf(root.getBoundingClientRect().bottom, window.innerHeight, keyboardBand()),
				);
			}
			revealVertical(el);
		};

		for (const name of KEYBOARD_EVENTS) window.addEventListener(name, update);
		// Border-box: the reserve above changes the root's own padding, which
		// would otherwise re-trigger this on its *content* box and loop. Only the
		// platform's own resize of the leaf changes the border box, which is
		// exactly the signal `overlapOf` needs to know it can let go again.
		const observer = root ? new ResizeObserver(update) : null;
		if (root) observer?.observe(root, { box: 'border-box' });
		// Dismissing the keyboard by its own collapse gesture, rather than by
		// leaving the field, drops focus nowhere — Obsidian's own detection is
		// keyed off *focus* leaving the field, so neither `keyboardWillHide` nor
		// `--keyboard-height` moves, and the editor stays mounted with the field
		// still focused. The next touch is the first thing afterwards that is
		// certain to reach this element in either direction: it either lands
		// outside (closes the editor, see the cleanup below) or inside, where a
		// re-measure costs nothing and finds nothing to do once the keyboard is
		// actually still up.
		document.addEventListener('pointerdown', update, true);
		// A first pass right away: the editor may open while the keyboard is
		// already up, in which case no event is coming at all.
		update();

		return () => {
			for (const name of KEYBOARD_EVENTS) window.removeEventListener(name, update);
			observer?.disconnect();
			document.removeEventListener('pointerdown', update, true);
			if (!root) return;
			const left = (held.get(root) ?? 1) - 1;
			if (left > 0) {
				held.set(root, left);
				return;
			}
			held.delete(root);
			applyReserve(root, 0);
		};
		// Mount/unmount only: the ref is stable for the life of one editor.
	}, []);
}
