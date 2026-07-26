// Shared constants for the Extraboard plugin.

/** Custom view type id for the board view. Stable API — do not rename. */
export const VIEW_TYPE_BOARD = 'extraboard-board';

/** Lucide icon names used across the UI (see docs/plans/bootstrap-kanban.md). */
export const ICONS = {
	board: 'square-kanban',
	add: 'plus',
	markdown: 'file-text',
	calendar: 'calendar-days',
	settings: 'sliders-horizontal',
	archive: 'archive',
	views: 'layers',
	edit: 'pencil',
	delete: 'trash-2',
	up: 'chevron-up',
	down: 'chevron-down',
} as const;

/** Icon of a view, by type — the switch wears the active view's (views.md §3.1). */
export function viewIcon(type: 'kanban' | 'calendar'): string {
	return type === 'calendar' ? ICONS.calendar : ICONS.board;
}
