// Auto-scroll while an item is held, owned by the plugin (mobile.md §3).
//
// Sortable's built-in scroller is constant-speed (`scrollSensitivity` /
// `scrollSpeed`) and no option makes it proportional, so it is switched off in
// `useSortable` and replaced by this module: the further the pointer has
// entered a container's edge zone, the faster that container scrolls. Both
// axes may run at once — the board horizontally, the stack the pointer is over
// vertically — which is what lets a card dragged into a bottom corner walk to
// the far end of the board.
//
// The loop tracks the pointer itself rather than riding Sortable's `onMove`:
// `onMove` only fires when the drag crosses a target, while a finger parked at
// the edge must keep scrolling without moving at all.

/** How deep, in px, the accelerating zone reaches in from a container's edge. */
const EDGE = 56;

/** Speed at the container's own edge, in px per second (depth 1). */
const MAX_SPEED = 1100;

/** Longest frame we honour, so a stalled tab cannot resume with a jump. */
const MAX_FRAME_MS = 50;

const POINTER_EVENTS = ['pointermove', 'touchmove', 'mousemove', 'dragover'] as const;

let board: HTMLElement | null = null;
/** The board's own window, so a board in a popout drives its own frame loop. */
let win: Window | null = null;
let pointerX = 0;
let pointerY = 0;
let havePointer = false;
let frame = 0;
let lastFrameAt = 0;

/**
 * Signed −1…1: how far `pos` has entered the edge zone of the range
 * `[min, max]`. 0 at the zone's inner boundary, ±1 at the container's own edge
 * and beyond it.
 */
function depth(pos: number, min: number, max: number): number {
	// A container shorter than two edge zones would otherwise be permanently
	// scrolling in both directions at once.
	if (max - min < EDGE * 2) return 0;
	if (pos <= min + EDGE) return -Math.min(1, (min + EDGE - pos) / EDGE);
	if (pos >= max - EDGE) return Math.min(1, (pos - (max - EDGE)) / EDGE);
	return 0;
}

/** The stack body the pointer is over horizontally — the one it would drop into. */
function stackUnderPointer(): HTMLElement | null {
	if (!board) return null;
	const bodies = Array.from(board.querySelectorAll<HTMLElement>('.eb-stack-body'));
	for (const el of bodies) {
		const rect = el.getBoundingClientRect();
		if (pointerX >= rect.left && pointerX <= rect.right) return el;
	}
	return null;
}

function readPointer(evt: Event): void {
	// Duck-typed rather than `instanceof TouchEvent`: that constructor does not
	// exist on every platform Obsidian runs on.
	const touches = (evt as TouchEvent).touches;
	const point: { clientX: number; clientY: number } | undefined =
		touches && touches.length > 0 ? touches[0] : (evt as MouseEvent);
	// A native HTML5 `dragover` at the end of a drag reports (0, 0); ignoring it
	// keeps the last real position instead of scrolling to a corner.
	if (!point || typeof point.clientX !== 'number') return;
	if (point.clientX === 0 && point.clientY === 0) return;
	pointerX = point.clientX;
	pointerY = point.clientY;
	havePointer = true;
}

function step(now: number): void {
	if (!win || !board) return;
	frame = win.requestAnimationFrame(step);
	const dt = Math.min(now - lastFrameAt, MAX_FRAME_MS) / 1000;
	lastFrameAt = now;
	if (!havePointer || dt <= 0) return;

	const boardRect = board.getBoundingClientRect();
	const dx = depth(pointerX, boardRect.left, boardRect.right);
	if (dx !== 0) board.scrollLeft += dx * MAX_SPEED * dt;

	const stack = stackUnderPointer();
	if (stack) {
		const rect = stack.getBoundingClientRect();
		const dy = depth(pointerY, rect.top, rect.bottom);
		if (dy !== 0) stack.scrollTop += dy * MAX_SPEED * dt;
	}
}

/**
 * Begin following the pointer and scrolling for the drag that just started.
 * `item` is the element Sortable picked up; the board it belongs to is what
 * gets scrolled horizontally.
 */
export function startAutoScroll(item: HTMLElement): void {
	stopAutoScroll();
	const root = item.closest<HTMLElement>('.eb-board');
	// A board in a popout window has its own `window`, and a frame loop or a
	// listener taken from the main one would never fire for it.
	const view = root?.ownerDocument.defaultView;
	if (!root || !view) return;
	board = root;
	win = view;
	havePointer = false;
	for (const type of POINTER_EVENTS) {
		view.document.addEventListener(type, readPointer, { passive: true, capture: true });
	}
	lastFrameAt = view.performance.now();
	frame = view.requestAnimationFrame(step);
}

/**
 * Stop on every exit path — drop, cancel, unmount, plugin unload. Idempotent,
 * because each list's Sortable cleanup calls it whether or not it was the one
 * that started a drag.
 */
export function stopAutoScroll(): void {
	if (win) {
		if (frame !== 0) win.cancelAnimationFrame(frame);
		for (const type of POINTER_EVENTS) {
			win.document.removeEventListener(type, readPointer, { capture: true });
		}
	}
	frame = 0;
	board = null;
	win = null;
	havePointer = false;
}
