// Shared constants for the Extraboard plugin.

import { getIconIds } from 'obsidian';
import type { ViewKind } from '../model/types';

/** Custom view type id for the board view. Stable API — do not rename. */
export const VIEW_TYPE_BOARD = 'extraboard-board';

/** Lucide icon names used across the UI (see docs/plans/bootstrap-kanban.md). */
export const ICONS = {
	board: 'square-kanban',
	add: 'plus',
	/** A column appended at the end — Add stack, so it is not a second `+`. */
	addStack: 'between-vertical-end',
	markdown: 'file-text',
	calendar: 'calendar-days',
	list: 'list-tree',
	settings: 'sliders-horizontal',
	viewOptions: 'settings-2',
	archive: 'archive',
	views: 'layers',
	switchView: 'repeat',
	edit: 'pencil',
	delete: 'trash-2',
	up: 'chevron-up',
	down: 'chevron-down',
} as const;

/** Icon of a view, by type — the switch wears the active view's (views.md §3.1). */
export function viewIcon(type: ViewKind): string {
	if (type === 'calendar') return ICONS.calendar;
	return type === 'list' ? ICONS.list : ICONS.board;
}

/**
 * Add stack's icon, or a plain `square-plus` on an Obsidian whose bundled
 * Lucide predates the column icon (quick-add-card.md §1).
 */
export function addStackIcon(): string {
	return getIconIds().includes(ICONS.addStack) ? ICONS.addStack : 'square-plus';
}
