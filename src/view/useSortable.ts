// SortableJS bound to a Preact-rendered list.
//
// Sortable moves DOM nodes itself, which would desynchronize Preact's virtual
// DOM. So on drop we read the intended position, put the node back exactly
// where it started, and let the model change drive the re-render — the standard
// "revert then re-render" integration.

import Sortable from 'sortablejs';
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

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
}

let dragging = false;

/** True while a drag is in flight, so click handlers can ignore the drop. */
export function isDragging(): boolean {
	return dragging;
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
	const toList = readIndex(evt.to, 'list');
	if (fromIndex === null || fromList === null || toList === null) return null;

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
	return { fromList, toList, fromIndex, before };
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
			ghostClass: 'eb-drag-ghost',
			dragClass: 'eb-drag-item',
			filter: 'input, textarea, button',
			// Let filtered elements keep their native behaviour (focus, clicks).
			preventOnFilter: false,
			...options,
			onStart: () => {
				dragging = true;
			},
			onEnd: (evt) => {
				// Clear after the synthetic click that follows a mouse drag.
				window.setTimeout(() => {
					dragging = false;
				}, 0);
				const info = readDrop(evt);
				revert(evt);
				if (info) latest.current(info);
			},
		});
		return () => sortable.destroy();
		// Created once per element; fresh callbacks are reached through `latest`.
	}, []);
}
