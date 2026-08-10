// Bringing board content into view: a stack when it is clicked
// (docs/specs/kanban-view.md §2), and a card editor when the software keyboard
// has just taken the bottom of the screen (docs/specs/mobile.md §7).
//
// The board is one horizontal scroller, so a stack near either end is routinely
// half-visible: its header is reachable but its cards are cut off. Clicking the
// header nudges the board just far enough to show the whole column — and does
// nothing at all when it is already whole, because scrolling the board under a
// user who clicked something they could already see is the surprise, not the
// service.

/** Gap left between a revealed stack and the board's edge, in px. */
const MARGIN = 12;

/**
 * Where the board should scroll to reveal a stack, or `null` when it already
 * shows it in full.
 *
 * All values are in the board's scroll-content coordinates: `stackLeft` is the
 * stack's offset from the content's left edge, `viewWidth` the visible width.
 * Pure, so the "is it visible" rule is testable without a layout.
 */
export function revealOffset(
	stackLeft: number,
	stackWidth: number,
	scrollLeft: number,
	viewWidth: number,
	margin: number = MARGIN,
): number | null {
	const left = stackLeft - margin;
	const right = stackLeft + stackWidth + margin;
	if (left >= scrollLeft && right <= scrollLeft + viewWidth) return null;
	// A stack wider than the viewport cannot satisfy both edges at once. Align
	// its left edge: that is where the header, the grip and the menu are.
	if (right - left > viewWidth) return left;
	// Otherwise move by the smaller of the two corrections — the stack is off
	// one end or the other, never both.
	return left < scrollLeft ? left : right - viewWidth;
}

/**
 * Scroll `stack`'s board so the whole column is visible. A no-op when it
 * already is, when the element is not in a board, or when the board cannot
 * scroll at all.
 */
export function revealStack(stack: HTMLElement): void {
	const board = stack.closest<HTMLElement>('.eb-board');
	if (!board) return;
	// Rects rather than `offsetLeft`: the board sets no `position`, so a stack's
	// offset parent is somewhere above it and its `offsetLeft` is not measured
	// from the scroll content at all.
	const stackRect = stack.getBoundingClientRect();
	const boardRect = board.getBoundingClientRect();
	const stackLeft = stackRect.left - boardRect.left + board.scrollLeft;
	const target = revealOffset(stackLeft, stackRect.width, board.scrollLeft, board.clientWidth);
	if (target === null) return;
	const max = Math.max(0, board.scrollWidth - board.clientWidth);
	board.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
}

/** The nearest ancestor that actually scrolls vertically, or `null`. */
function verticalScroller(el: HTMLElement): HTMLElement | null {
	for (let node = el.parentElement; node; node = node.parentElement) {
		if (node.scrollHeight <= node.clientHeight + 1) continue;
		const overflow = getComputedStyle(node).overflowY;
		if (overflow === 'auto' || overflow === 'scroll') return node;
	}
	return null;
}

/**
 * Scroll `el`'s own vertical scroller — a stack's body, the list — so the whole
 * element is visible in it. The rule of `revealStack` on the other axis: move by
 * the smallest amount that shows it, and do nothing when it is already whole.
 *
 * Called *after* the board has given up the keyboard's height (mobile.md §7),
 * never before: the reserve is what shortens this scroller, and on a stack whose
 * cards used to fit it is what creates the scroller in the first place.
 *
 * `scrollIntoView` is not used: it walks *every* scrollable ancestor, so on a
 * board it also moves the horizontal row and the workspace under the user.
 */
export function revealVertical(el: HTMLElement): void {
	const box = verticalScroller(el);
	if (!box) return;
	const elRect = el.getBoundingClientRect();
	const boxRect = box.getBoundingClientRect();
	const top = elRect.top - boxRect.top + box.scrollTop;
	const target = revealOffset(top, elRect.height, box.scrollTop, box.clientHeight);
	if (target === null) return;
	const max = Math.max(0, box.scrollHeight - box.clientHeight);
	// Instantly, unlike the horizontal reveal: this runs repeatedly while the
	// keyboard animates in, and overlapping smooth scrolls cancel one another.
	box.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: 'auto' });
}
