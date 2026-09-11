// Keeping a modal usable while the software keyboard is up.
// Spec: docs/specs/mobile.md §7.2.
//
// A phone's keyboard does not shrink the page: it covers the bottom of it. A
// modal laid out against the full screen therefore keeps its footer, and often
// the very row being typed into, underneath the keyboard, with no scroller the
// browser can move to bring it back — the modal's own scroller believes it is
// entirely visible.
//
// So the modal is told how tall the keyboard is and ends above it. Obsidian
// publishes that as `--keyboard-height`, which is what the rest of the
// ecosystem reads; `visualViewport` is measured alongside it as a fallback for
// the builds and platforms where the variable is not set, and the CSS takes
// whichever is larger. Where the keyboard shrinks the layout viewport instead
// of covering it — some Android web views — both are zero, which is correct:
// there is nothing left to reserve.

import { Platform, type Modal } from 'obsidian';

/** Below this, the gap is browser chrome or rounding, not a keyboard. */
const MIN_KEYBOARD = 80;

/** What the keyboard covers, as `visualViewport` sees it; 0 when it is closed. */
function measuredKeyboard(win: Window): number {
	const view = win.visualViewport;
	if (!view) return 0;
	const gap = win.innerHeight - view.height - view.offsetTop;
	return gap >= MIN_KEYBOARD ? Math.round(gap) : 0;
}

/**
 * Reserve the software keyboard's height under `modal`, and keep whatever is
 * focused inside it on screen. Desktop is left alone entirely — there is no
 * keyboard to reserve, and no `visualViewport` change to react to.
 *
 * One call in `onOpen` is the whole contract: the listeners come down with the
 * modal, through its own `onClose`.
 */
export function keyboardAwareModal(modal: Modal): void {
	if (!Platform.isMobile) return;
	const container = modal.containerEl;
	// The modal's own window, not the ambient one: a board opened in a popout
	// has a viewport of its own (and it is what the lint rule is about).
	const win = container.win;
	container.addClass('eb-keyboard-aware');

	const showFocus = (): void => {
		// `HTMLElement` of this window is the only one there is: a phone, which is
		// the only place this runs, has no popout window to cross.
		const focused = container.doc.activeElement;
		// `nearest` is the minimum movement that clears the keyboard: a row
		// already visible is left exactly where the user is reading it.
		if (focused instanceof HTMLElement && modal.modalEl.contains(focused)) {
			focused.scrollIntoView({ block: 'nearest' });
		}
	};

	const apply = (): void => {
		const height = measuredKeyboard(win);
		container.style.setProperty('--eb-keyboard-height', `${String(height)}px`);
		// The reserve is only ever applied while the keyboard is actually up, so
		// a closed keyboard leaves the modal's own sizing untouched.
		container.toggleClass('is-keyboard-open', height > 0);
		showFocus();
	};

	// The keyboard opens after the focus that summoned it, so the focus alone
	// says nothing about how tall it is: the viewport resize is the signal, and
	// the focus handler only catches a move between fields while it is already up.
	const onFocusIn = (): void => {
		win.requestAnimationFrame(showFocus);
	};
	const view = win.visualViewport;
	view?.addEventListener('resize', apply);
	view?.addEventListener('scroll', apply);
	modal.modalEl.addEventListener('focusin', onFocusIn);
	apply();

	// Patched rather than left to each caller: a listener on the visual viewport
	// outlives the modal's DOM, so forgetting the disposer in one of a dozen
	// modals would leak it. The original still runs, and runs first — it is the
	// one that commits what the modal was for.
	const close = modal.onClose.bind(modal);
	modal.onClose = (): void => {
		close();
		view?.removeEventListener('resize', apply);
		view?.removeEventListener('scroll', apply);
		modal.modalEl.removeEventListener('focusin', onFocusIn);
	};
}
