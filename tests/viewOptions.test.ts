import { describe, expect, it } from 'vitest';
import { placeViewOptions, type Box } from '../src/view/viewOptionsPosition';

const box = (left: number, top: number, width: number, height: number): Box => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height,
});

describe('view options position', () => {
	it('converts viewport trigger coordinates into root-local coordinates', () => {
		const root = box(300, 100, 700, 600);
		const trigger = box(760, 110, 40, 20);

		expect(placeViewOptions(trigger, root, { width: 240, height: 300 })).toEqual({
			left: 260,
			top: 34,
		});
	});

	it('clamps the panel inside the root at both edges', () => {
		const root = box(300, 100, 260, 220);

		expect(placeViewOptions(box(290, 80, 20, 10), root, { width: 240, height: 200 })).toEqual({
			left: 4,
			top: 4,
		});
		expect(placeViewOptions(box(550, 310, 20, 10), root, { width: 240, height: 200 })).toEqual({
			left: 16,
			top: 16,
		});
	});
});
