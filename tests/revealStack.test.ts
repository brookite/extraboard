import { describe, expect, it } from 'vitest';
import { revealOffset } from '../src/view/revealStack';

// A 272px stack in a 800px viewport, with the default 12px margin.
const W = 272;
const VIEW = 800;

describe('revealOffset', () => {
	it('does nothing for a stack already fully in view', () => {
		expect(revealOffset(100, W, 0, VIEW)).toBeNull();
	});

	it('does nothing for a stack sitting exactly on both margins', () => {
		// left edge at scrollLeft + 12, right edge at scrollLeft + 800 - 12.
		expect(revealOffset(512, W, 500, VIEW)).toBeNull();
	});

	it('scrolls left to reveal a stack off the left end', () => {
		// Stack at 300 while the board starts at 400: align its left edge + margin.
		expect(revealOffset(300, W, 400, VIEW)).toBe(288);
	});

	it('scrolls right to reveal a stack off the right end', () => {
		// Right edge lands at 1000 + 12; the viewport must end there.
		expect(revealOffset(1000, W, 0, VIEW)).toBe(1000 + W + 12 - VIEW);
	});

	it('moves by the smaller correction, not to the far edge', () => {
		// Only 4px of the stack is cut off on the right, so the board moves 4px.
		const scrollLeft = 1000 + W + 12 - VIEW - 4;
		expect(revealOffset(1000, W, scrollLeft, VIEW)).toBe(scrollLeft + 4);
	});

	it('aligns the left edge of a stack wider than the viewport', () => {
		// Both edges can never fit, and the header is at the left one.
		expect(revealOffset(500, 1200, 0, VIEW)).toBe(488);
	});

	it('respects a custom margin', () => {
		expect(revealOffset(300, W, 400, VIEW, 0)).toBe(300);
	});

	it('treats a partly visible stack as needing a scroll', () => {
		// Fully inside except for the margin the rule insists on.
		expect(revealOffset(405, W, 400, VIEW)).toBe(393);
	});
});
