import { describe, expect, it } from 'vitest';
import { isImeOpen } from '../src/view/mobileIme';

describe('mobile IME detection', () => {
	it('requires editor focus', () => {
		expect(
			isImeOpen({
				editorFocused: false,
				baselineHeight: 800,
				viewportHeight: 420,
				keyboardHeight: 380,
			}),
		).toBe(false);
	});

	it('detects a keyboard from visual viewport shrink', () => {
		expect(
			isImeOpen({
				editorFocused: true,
				baselineHeight: 800,
				viewportHeight: 460,
				keyboardHeight: 0,
			}),
		).toBe(true);
	});

	it('does not mistake the floating editor toolbar for the IME', () => {
		expect(
			isImeOpen({
				editorFocused: true,
				baselineHeight: 800,
				viewportHeight: 736,
				keyboardHeight: 0,
			}),
		).toBe(false);
	});

	it('uses VirtualKeyboard geometry when the viewport is overlaid', () => {
		expect(
			isImeOpen({
				editorFocused: true,
				baselineHeight: 800,
				viewportHeight: 800,
				keyboardHeight: 340,
			}),
		).toBe(true);
	});
});
