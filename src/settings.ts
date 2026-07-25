// Plugin-global settings. Per-board configuration (views, properties, paths)
// lives in each board file's YAML frontmatter, not here.
// Spec: docs/specs/settings.md.

import type { PropertyDef } from './model/types';

export interface ExtraboardSettings {
	/**
	 * Property definitions written into the frontmatter of every newly created
	 * board. Editing them never touches boards that already exist.
	 */
	defaultProperties: PropertyDef[];
	/**
	 * `false` — the card `color` property paints a left-edge stripe;
	 * `true` — it also tints the whole card (kanban-view.md §5.2).
	 */
	fillCardWithColor: boolean;
}

export const DEFAULT_SETTINGS: ExtraboardSettings = {
	defaultProperties: [],
	fillCardWithColor: false,
};
