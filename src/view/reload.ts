// A counter that advances only when the board is **re-parsed from the file**.
// Spec: docs/plans/m10-perf.md §"Editing across an external reload".
//
// Card tiles, divider rows and stack columns are keyed by position, so their
// local editing state belongs to the *slot*, not to the item in it. That is
// fine for every edit the plugin itself makes — those go through `applyEdit`,
// which never reorders anything under an open editor. It is not fine for a
// change that arrives from outside (the file edited in another pane, a sync,
// an undo in the Markdown view): `setViewData` re-parses, every item is a new
// object at a possibly different index, and an editor left open would be
// showing one card's text while pointing at whatever now sits at its index.
//
// Item identity cannot tell the two apart — the plugin's own save replaces the
// edited card's object too — so the discriminator is *where the new board came
// from*, which only `BoardView` knows. Hence a token rather than a comparison.

import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';

export const ReloadContext = createContext(0);

/**
 * Close an open inline editor when the board is re-parsed underneath it.
 *
 * `useLayoutEffect`, so the editor is gone before the browser paints — there is
 * never a frame showing one card's text on another card. Tearing the embedded
 * editor down does **not** commit (`embeddedEditor.ts`'s `destroy` closes first),
 * so the stale text is discarded rather than written to the wrong card, which is
 * the whole point.
 *
 * Safe to call unconditionally: `close` is only invoked on a change of the
 * token, and a component that is not editing has nothing to close.
 */
export function useCloseOnReload(close: () => void): void {
	const token = useContext(ReloadContext);
	const seen = useRef(token);
	const closeRef = useRef(close);
	closeRef.current = close;

	useLayoutEffect(() => {
		if (token === seen.current) return;
		seen.current = token;
		closeRef.current();
	}, [token]);
}
