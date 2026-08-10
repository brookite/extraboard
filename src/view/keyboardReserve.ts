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

import { Platform } from 'obsidian';
import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { keyboardBand, onKeyboardChange, overlapOf } from './keyboard';
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

		// What the board is currently giving up, so the rule below can tell
		// growing from shrinking.
		let reserved = 0;
		const update = (settled: boolean): void => {
			// The reserve first: `revealVertical` measures the scroller this creates.
			// Only the part of the band the board actually reaches into — the
			// platform may already have shrunk the leaf itself, and reserving the
			// whole band on top of that takes the same space twice.
			if (root) {
				const want = overlapOf(
					root.getBoundingClientRect().bottom,
					window.innerHeight,
					keyboardBand(),
				);
				// It may **grow** only once the keyboard has actually been drawn.
				// The announcement comes at the start of a ~350 ms animation, and
				// giving up the space before the keyboard covers it is a band of bare
				// background flashing at the bottom of the board — reported from the
				// device as a white flicker. Shrinking is not delayed: releasing
				// space early only ever uncovers the board.
				const next = settled ? want : Math.min(reserved, want);
				applyReserve(root, next);
				reserved = next;
			}
			revealVertical(el);
		};

		// `onKeyboardChange` takes the first measurement itself.
		const off = onKeyboardChange(update);
		return () => {
			off();
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
