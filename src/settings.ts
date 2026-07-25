// Plugin-global settings. Per-board configuration (views, properties, paths)
// lives in each board file's YAML frontmatter, not here.
// Spec: docs/specs/settings.md.

import type { ProgressStyle, PropertyDef } from './model/types';

export interface ExtraboardSettings {
	/**
	 * Property definitions written into the frontmatter of every newly created
	 * board. Editing them never touches boards that already exist.
	 */
	defaultProperties: PropertyDef[];
	/**
	 * Vault-relative folder for card notes of boards that do not set their own
	 * `cardContentDir`. Empty = the vault root (settings.md).
	 */
	cardNoteFolder: string;
	/**
	 * Default shape of the checklist `N/M` indicator and of `percent` badges.
	 * A board may override it in its own frontmatter (settings.md).
	 */
	progressStyle: ProgressStyle;
	/**
	 * `false` — the inline card editor hides `@{name|value}` and edits
	 * properties as badges; `true` — the raw tokens stay in the text, dimmed.
	 */
	showRawPropertyTokens: boolean;
	/**
	 * `false` — the card `color` property paints a left-edge stripe;
	 * `true` — it also tints the whole card (kanban-view.md §5.2).
	 */
	fillCardWithColor: boolean;
}

export const DEFAULT_SETTINGS: ExtraboardSettings = {
	defaultProperties: [],
	cardNoteFolder: '',
	progressStyle: 'ring',
	showRawPropertyTokens: false,
	fillCardWithColor: false,
};
