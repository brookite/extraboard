import { describe, expect, it } from 'vitest';
import { bandOf, overlapOf } from '../src/view/keyboard';
import { isTap } from '../src/util/gesture';
import { revealOffset } from '../src/view/revealStack';

// The band the board gives up (mobile.md §7): the keyboard, plus the editing
// toolbar that floats in the gap above it while it is open.
describe('bandOf', () => {
	it('is the keyboard plus the open toolbar', () => {
		expect(bandOf(340, 48, true)).toBe(388);
	});

	it('leaves out a toolbar that is not up', () => {
		expect(bandOf(340, 48, false)).toBe(340);
	});

	it('is zero with no keyboard, whatever the toolbar says', () => {
		// The desktop, and any platform that does not publish a height: the board
		// must keep the layout it already has rather than reserve a toolbar band.
		expect(bandOf(0, 48, true)).toBe(0);
	});

	it('treats an absent or unparseable height as no keyboard', () => {
		expect(bandOf(Number.NaN, 48, true)).toBe(0);
		expect(bandOf(-1, 48, true)).toBe(0);
	});

	it('rounds to whole pixels', () => {
		expect(bandOf(339.6, 48.2, true)).toBe(388);
	});
});

// The numbers below are the ones the user's Android device reported on
// 2026-08-10 (docs/PROJECT_LOG.md): a 914 px window, a 332 px keyboard and a
// 52 px toolbar, with the leaf shrinking in two steps of its own accord.
describe('overlapOf', () => {
	const BAND = 332 + 52;

	it('reserves the part of the band the board reaches into', () => {
		// The toolbar has opened, so the leaf ends at 862 while the band starts at
		// 530: the board runs 332 px into it.
		expect(overlapOf(862, 914, BAND)).toBe(332);
	});

	it('reserves nothing once the platform has shrunk the leaf itself', () => {
		// Android does this ~800 ms in, and the leaf ends exactly at the band.
		// Reserving the band again here would leave a board 54 px tall.
		expect(overlapOf(530, 914, BAND)).toBe(0);
	});

	it('reserves the whole band for a board that runs to the bottom', () => {
		expect(overlapOf(914, 914, BAND)).toBe(BAND);
	});

	it('does nothing with no keyboard', () => {
		expect(overlapOf(914, 914, 0)).toBe(0);
	});

	it('never reserves for a board that ends above the band', () => {
		expect(overlapOf(400, 914, BAND)).toBe(0);
	});
});

// Closing the editor on a press meant the scroll that would have rescued a card
// from behind the keyboard was also the gesture that dropped it (§7).
describe('isTap', () => {
	it('accepts a mouse click, which does not move at all', () => {
		expect(isTap(0, 0)).toBe(true);
	});

	it('accepts a finger that drifts a little', () => {
		expect(isTap(3, -6)).toBe(true);
	});

	it('rejects a scroll of the stack', () => {
		expect(isTap(0, -80)).toBe(false);
	});

	it('rejects a horizontal swipe across the board', () => {
		expect(isTap(-120, 2)).toBe(false);
	});

	it('is symmetric about the press point', () => {
		expect(isTap(10, 10)).toBe(isTap(-10, -10));
	});
});

// `revealVertical` reuses this rule on the other axis, against the scroller the
// keyboard reserve has just shortened.
describe('revealOffset, vertically', () => {
	it('leaves an editor that is already fully visible alone', () => {
		expect(revealOffset(100, 80, 0, 400)).toBeNull();
	});

	it('lifts an editor that the shortened scroller now cuts off', () => {
		// Editor at 500..580 in a scroller showing 0..400: its bottom plus the
		// margin has to reach the visible edge.
		expect(revealOffset(500, 80, 0, 400)).toBe(500 + 80 + 12 - 400);
	});

	it('shows the top of an editor taller than the scroller', () => {
		expect(revealOffset(500, 600, 0, 400)).toBe(488);
	});
});
