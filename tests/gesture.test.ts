import { describe, expect, it } from 'vitest';
import { isDoubleTap, isTap } from '../src/util/gesture';

// Closing the editor on a press meant the scroll that would have moved a card
// into view was also the gesture that dropped it.
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

// A named divider's label opens its group on one tap and renames on two, so the
// window has to separate a deliberate second tap from an unrelated later one.
describe('isDoubleTap', () => {
	it('has nothing to continue when no tap is pending', () => {
		expect(isDoubleTap(0, 1000)).toBe(false);
	});

	it('accepts a second tap inside the window', () => {
		expect(isDoubleTap(1000, 1200)).toBe(true);
	});

	it('accepts the very same instant, as a doubled click event would report', () => {
		expect(isDoubleTap(1000, 1000)).toBe(true);
	});

	it('rejects a tap long after the first one', () => {
		expect(isDoubleTap(1000, 2500)).toBe(false);
	});
});
