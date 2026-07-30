/** A viewport shrink smaller than this is browser chrome, not a software keyboard. */
const IME_MIN_HEIGHT = 96;

export interface ImeSample {
	editorFocused: boolean;
	baselineHeight: number;
	viewportHeight: number;
	keyboardHeight: number;
}

/** Pure decision used by the DOM watcher and covered without a browser runtime. */
export function isImeOpen(sample: ImeSample): boolean {
	if (!sample.editorFocused) return false;
	const viewportShrink = Math.max(0, sample.baselineHeight - sample.viewportHeight);
	return Math.max(viewportShrink, sample.keyboardHeight) >= IME_MIN_HEIGHT;
}

interface VirtualKeyboardLike extends EventTarget {
	readonly boundingRect?: { readonly height: number };
}

function virtualKeyboardOf(win: Window): VirtualKeyboardLike | undefined {
	return (win.navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
}

/**
 * Keep `.is-ime-open` on a board root in sync with the real mobile viewport.
 *
 * Focus alone is insufficient: Obsidian's floating editor toolbar can remain
 * visible while the keyboard is dismissed. The viewport height before editor
 * focus is therefore the baseline; a large shrink, or a VirtualKeyboard
 * geometry when the API exists, is the IME signal.
 */
export function watchMobileIme(root: HTMLElement): () => void {
	const doc = root.ownerDocument;
	const win = doc.defaultView;
	if (!win) return () => undefined;

	const viewport = win.visualViewport;
	const keyboard = virtualKeyboardOf(win);
	const height = (): number => viewport?.height ?? win.innerHeight;
	let baselineHeight = height();

	const update = (): void => {
		const editorFocused = root.querySelector('.eb-card.is-editing:focus-within') !== null;
		const viewportHeight = height();
		if (!editorFocused) baselineHeight = viewportHeight;
		root.classList.toggle(
			'is-ime-open',
			isImeOpen({
				editorFocused,
				baselineHeight,
				viewportHeight,
				keyboardHeight: keyboard?.boundingRect?.height ?? 0,
			}),
		);
	};

	const onFocusChange = (): void => {
		// Let focus move to its new element before evaluating `:focus-within`.
		win.queueMicrotask(update);
	};

	win.addEventListener('resize', update);
	viewport?.addEventListener('resize', update);
	viewport?.addEventListener('scroll', update);
	keyboard?.addEventListener('geometrychange', update);
	doc.addEventListener('focusin', onFocusChange);
	doc.addEventListener('focusout', onFocusChange);
	update();

	return () => {
		win.removeEventListener('resize', update);
		viewport?.removeEventListener('resize', update);
		viewport?.removeEventListener('scroll', update);
		keyboard?.removeEventListener('geometrychange', update);
		doc.removeEventListener('focusin', onFocusChange);
		doc.removeEventListener('focusout', onFocusChange);
		root.classList.remove('is-ime-open');
	};
}
