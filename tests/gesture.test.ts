import { describe, expect, it } from 'vitest';
import { isTap } from '../src/util/gesture';

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
