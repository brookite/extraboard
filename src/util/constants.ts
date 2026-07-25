// Shared constants for the Extraboard plugin.

/** Custom view type id for the board view. Stable API — do not rename. */
export const VIEW_TYPE_BOARD = 'extraboard-board';

/** Lucide icon names used across the UI (see docs/plans/bootstrap-kanban.md). */
export const ICONS = {
	board: 'square-kanban',
	markdown: 'file-text',
	calendar: 'calendar-days',
	settings: 'sliders-horizontal',
} as const;
