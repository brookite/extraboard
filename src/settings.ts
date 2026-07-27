// Plugin-global settings. Per-board configuration (views, properties, paths)
// lives in each board file's YAML frontmatter, not here.
// Spec: docs/specs/settings.md.

import type { ProgressStyle, PropertyDef } from './model/types';
import type { DateHighlightRule } from './model/dateHighlights';
import type { Lang } from './i18n';
import type { DateFormatMode } from './i18n/dates';

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
	/**
	 * `false` — a card leaves the board only through the archive and the card
	 * menu offers no "Delete card"; `true` — the item comes back (archive.md §1).
	 * It governs cards only: stacks, dividers and the archive's own delete
	 * actions are unaffected.
	 */
	allowDeleteWithoutArchive: boolean;
	/**
	 * UI language. `auto` follows Obsidian's own configured language; anything
	 * other than `ru` falls back to English (i18n-and-dates.md §1).
	 */
	language: Lang | 'auto';
	/**
	 * How the date half of every rendered date is shown (i18n-and-dates.md §2).
	 * `custom` reads `datePattern`, a moment.js format string.
	 */
	dateFormat: DateFormatMode;
	/** The same four choices for the time half, configured separately. `custom`
	 * reads `timePattern`. */
	timeFormat: DateFormatMode;
	/** moment.js pattern for `dateFormat: 'custom'`; empty falls back to `built-in`. */
	datePattern: string;
	/** moment.js pattern for `timeFormat: 'custom'`; empty falls back to `built-in`. */
	timePattern: string;
	/**
	 * Ordered rules coloring a date badge as its date approaches or after it has
	 * passed; the first match wins. A board may replace the whole list in its own
	 * frontmatter (i18n-and-dates.md §3).
	 */
	dateHighlights: DateHighlightRule[];
}

export const DEFAULT_SETTINGS: ExtraboardSettings = {
	defaultProperties: [],
	cardNoteFolder: '',
	progressStyle: 'ring',
	showRawPropertyTokens: false,
	fillCardWithColor: false,
	allowDeleteWithoutArchive: false,
	language: 'auto',
	dateFormat: 'system',
	timeFormat: 'system',
	datePattern: '',
	timePattern: '',
	dateHighlights: [],
};
