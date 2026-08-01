// SortableJS bound to a Preact-rendered list.
//
// Sortable moves DOM nodes itself, which would desynchronize Preact's virtual
// DOM. So on drop we read the intended position, put the node back exactly
// where it started, and let the model change drive the re-render — the standard
// "revert then re-render" integration.

import Sortable from 'sortablejs';
import { Platform } from 'obsidian';
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { startAutoScroll, stopAutoScroll } from './autoScroll';

/** Where an item was dragged from and to, in model coordinates. */
export interface DropInfo {
	/** `data-list` of the source container. */
	fromList: number;
	/** `data-list` of the destination container. */
	toList: number;
	/** `data-index` of the dragged element. */
	fromIndex: number;
	/** `data-index` of the item it was dropped in front of; `null` = at the end. */
	before: number | null;
	/** The item was dropped on a `data-archive` zone, not on a list (archive.md §5.5). */
	toArchive: boolean;
}

let dragging = false;

/** True while a drag is in flight, so click handlers can ignore the drop. */
export function isDragging(): boolean {
	return dragging;
}

/**
 * Class put on the document body while a **card** is being dragged, so the
 * archive drop target can show itself in CSS alone. Toggling it outside Preact
 * is deliberate: re-rendering the board mid-drag would move the very nodes
 * Sortable is holding.
 */
const DRAGGING_CARD = 'eb-dragging-card';

function markDrag(item: HTMLElement, on: boolean): void {
	const body = item.ownerDocument.body;
	if (on && item.classList.contains('eb-card')) body.addClass(DRAGGING_CARD);
	else body.removeClass(DRAGGING_CARD);
}

/**
 * Class put on every `.eb-list-row` of a stack other than the one being
 * dragged, while the drag lasts (list-view.md §4.3): a drop never changes a
 * card's stack, wherever in the list it lands, so every other-stack row is
 * shown as what it is — not a place this drag can put the card.
 */
const OTHER_STACK = 'eb-list-row-other-stack';

function markStackDrag(item: HTMLElement, on: boolean): void {
	const stack = item.dataset.stack;
	const root = item.closest('.eb-list');
	if (!root) return;
	if (on && stack !== undefined) {
		root.querySelectorAll<HTMLElement>('.eb-list-row[data-stack]').forEach((row) => {
			if (row.dataset.stack !== stack) row.classList.add(OTHER_STACK);
		});
	} else {
		root.querySelectorAll<HTMLElement>(`.${OTHER_STACK}`).forEach((row) => row.classList.remove(OTHER_STACK));
	}
}

function readIndex(el: Element | null, attr: 'index' | 'list'): number | null {
	if (!(el instanceof HTMLElement)) return null;
	const raw = el.dataset[attr];
	if (raw === undefined) return null;
	const value = Number(raw);
	return Number.isNaN(value) ? null : value;
}

function readDrop(evt: Sortable.SortableEvent): DropInfo | null {
	const fromIndex = readIndex(evt.item, 'index');
	const fromList = readIndex(evt.from, 'list');
	if (fromIndex === null || fromList === null) return null;

	// The archive zone is a drop target, not a list: it has no position, only a
	// meaning (archive.md §5.5).
	if (evt.to.dataset.archive !== undefined) {
		return { fromList, toList: fromList, fromIndex, before: null, toArchive: true };
	}

	const toList = readIndex(evt.to, 'list');
	if (toList === null) return null;

	// The first following sibling that belongs to the model tells us what the
	// dragged item now sits in front of. Its `data-index` is still expressed in
	// pre-move coordinates, which is exactly what `ops.moveItem` expects.
	let before: number | null = null;
	for (let el = evt.item.nextElementSibling; el; el = el.nextElementSibling) {
		const index = readIndex(el, 'index');
		if (index !== null) {
			before = index;
			break;
		}
	}
	return { fromList, toList, fromIndex, before, toArchive: false };
}

/** Undo Sortable's DOM move so Preact's tree matches the document again. */
function revert(evt: Sortable.SortableEvent): void {
	const { item, from, oldIndex } = evt;
	item.remove();
	const anchor = oldIndex === undefined ? null : (from.children[oldIndex] ?? null);
	from.insertBefore(item, anchor);
}

export function useSortable(
	ref: RefObject<HTMLElement>,
	options: Sortable.Options,
	onDrop: (info: DropInfo) => void,
): void {
	const latest = useRef(onDrop);
	latest.current = onDrop;

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const sortable = Sortable.create(el, {
			animation: 150,
			// On touch, require a short press so the board still scrolls freely.
			delay: 250,
			delayOnTouchOnly: true,
			touchStartThreshold: 5,
			fallbackOnBody: true,
			// Use Sortable's positioned clone on every platform. Native HTML5
			// dragging replaces the card under the pointer with an OS/Chromium
			// drag image, whose appearance and behaviour differ between desktop
			// devices. The fallback keeps the visible card consistent while the
			// original remains the list placeholder until the model re-renders.
			forceFallback: true,
			ghostClass: 'eb-drag-ghost',
			dragClass: 'eb-drag-item',
			filter: 'input, textarea, button',
			// Let filtered elements keep their native behaviour (focus, clicks).
			preventOnFilter: false,
			// One gesture model for every list on the board (mobile.md §3).
			//
			// On touch, take Sortable's *touch-event* path rather than its pointer
			// path. In Chromium `supportPointer` defaults to true, and during the
			// pickup delay the pointer path subscribes `pointercancel ->
			// _disableDelayedDrag` — which a card inside two scroll containers hits
			// long before the delay elapses, so a finger drag never starts at all.
			// The touch path aborts on `touchcancel` instead, which the browser
			// only fires once a scroll has genuinely begun: exactly the pickup that
			// *should* be abandoned. Nothing declares `touch-action: none`, so a
			// plain swipe still scrolls the board and the stack, and a card stays
			// draggable from anywhere on it rather than from a new grip.
			//
			// `mousedown` is bound alongside `touchstart`, so a desktop app running
			// under `emulateMobile(true)` without device emulation keeps its mouse
			// drag.
			...(Platform.isMobile ? { supportPointer: false } : {}),
			// Auto-scroll is the plugin's own and proportional (`autoScroll.ts`);
			// the built-in constant-speed scroller must not compete with it.
			scroll: false,
			...options,
			onStart: (evt) => {
				dragging = true;
				markDrag(evt.item, true);
				markStackDrag(evt.item, true);
				startAutoScroll(evt.item);
			},
			onEnd: (evt) => {
				stopAutoScroll();
				// Clear after the synthetic click that follows a mouse drag.
				window.setTimeout(() => {
					dragging = false;
				}, 0);
				markDrag(evt.item, false);
				markStackDrag(evt.item, false);
				const info = readDrop(evt);
				revert(evt);
				if (info) latest.current(info);
			},
		});
		return () => {
			// A board torn down mid-drag must not leave a frame loop running.
			stopAutoScroll();
			sortable.destroy();
		};
		// Created once per element; fresh callbacks are reached through `latest`.
	}, []);
}
