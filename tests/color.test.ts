// Color helpers. Only the paths that need no DOM are exercised here: the repo
// has no DOM test environment, and `resolveColor`'s probe branch (named colors,
// `rgb()`, `var(--…)`) is browser behaviour. The hex branches are the ones the
// opacity slider's arithmetic rests on, so they are the ones worth pinning.

import { describe, it, expect } from 'vitest';
import { resolveColor, withAlpha } from '../src/util/color';

/** The probe host, never reached: every value below short-circuits on hex. */
const noHost = null as unknown as HTMLElement;

describe('withAlpha', () => {
	it('keeps six digits when the color is opaque', () => {
		expect(withAlpha('#3366ff', 1)).toBe('#3366ff');
	});

	it('appends the alpha byte below full opacity', () => {
		expect(withAlpha('#3366ff', 0.5)).toBe('#3366ff80');
		expect(withAlpha('#3366ff', 0)).toBe('#3366ff00');
	});

	it('clamps out-of-range alpha instead of emitting a broken color', () => {
		expect(withAlpha('#3366ff', 2)).toBe('#3366ff');
		expect(withAlpha('#3366ff', -1)).toBe('#3366ff00');
	});
});

describe('resolveColor', () => {
	it('splits an eight-digit hex into hue and alpha', () => {
		expect(resolveColor('#3366FF80', noHost)).toEqual({ hex: '#3366ff', alpha: 128 / 255 });
	});

	it('reports full opacity for a plain hex', () => {
		expect(resolveColor('#3366ff', noHost)).toEqual({ hex: '#3366ff', alpha: 1 });
	});

	it('rejects what is not a color', () => {
		expect(resolveColor('', noHost)).toBeNull();
		expect(resolveColor(undefined, noHost)).toBeNull();
	});

	it('round-trips through withAlpha', () => {
		const resolved = resolveColor('#3366ff80', noHost);
		expect(withAlpha(resolved!.hex, resolved!.alpha)).toBe('#3366ff80');
	});
});
