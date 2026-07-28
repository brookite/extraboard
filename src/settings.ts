// Plugin-global settings. Per-board configuration (views, properties, paths)
// lives in each board file's `extraboard-settings` block, not here.
// Spec: docs/specs/settings.md.

import type { BoardConfig, ProgressStyle, PropertyDef, Stack } from './model/types';
import type { DateHighlightRule } from './model/dateHighlights';
import type { Lang } from './i18n';
import type { DateFormatMode, WeekStart } from './i18n/dates';
import type { ArchiveOpts, InsertPos } from './model/ops';
import { formatDate } from './model/dates';

/** Bounds of `archiveLimit`, shared by the settings tab and the clamp below. */
export const ARCHIVE_LIMIT_MIN = 1;
export const ARCHIVE_LIMIT_MAX = 16000;

/**
 * Where a card entering `stack` is inserted (kanban-view.md §6.7): `0` for the
 * top, `null` for the end — the `InsertPos` every card-inserting op already
 * takes. Completing stacks and the rest are configured separately, and a board
 * override wins over the plugin setting.
 *
 * Every path that puts a card *into* a stack resolves through here, so the
 * composer, "Complete card", restore and the calendar's day modal agree. Drag &
 * drop does not: there the user picked the position themselves.
 */
export function cardEntryPos(
	stack: Pick<Stack, 'completes'> | undefined,
	config: BoardConfig,
	settings: ExtraboardSettings,
): InsertPos {
	const top = stack?.completes
		? (config.addToTopCompleting ?? settings.addToTopCompleting)
		: (config.addToTopOther ?? settings.addToTopOther);
	return top ? 0 : null;
}

/**
 * The archiving options for "now": this is the one place the clock is read, so
 * `src/model/**` stays pure and every archive path stamps its cards the same
 * way (archive.md §4.1).
 */
export function archiveOpts(settings: ExtraboardSettings, now: Date = new Date()): ArchiveOpts {
	return {
		at: formatDate({
			y: now.getFullYear(),
			m: now.getMonth() + 1,
			d: now.getDate(),
			minutes: now.getHours() * 60 + now.getMinutes(),
		}),
		limit: Math.min(
			ARCHIVE_LIMIT_MAX,
			Math.max(ARCHIVE_LIMIT_MIN, Math.floor(settings.archiveLimit)),
		),
	};
}

export interface ExtraboardSettings {
	/**
	 * Property definitions written into the settings block of every newly created
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
	 * A board may override it in its own settings block (settings.md).
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
	 * How many cards an archive may hold, 1..16000. When archiving pushes it past
	 * this, the **oldest** cards fall off the end (archive.md §4.2).
	 */
	archiveLimit: number;
	/**
	 * Archive list order: `true` — most recently archived first (the default),
	 * `false` — oldest first. Toggled from the archive modal itself, which is
	 * where the list being ordered is (archive.md §4.1).
	 */
	archiveNewestFirst: boolean;
	/**
	 * Where a card entering a **completing** stack goes: `true` — the top,
	 * `false` — the end. A board may override it in its own settings block
	 * (kanban-view.md §6.7).
	 */
	addToTopCompleting: boolean;
	/** The same for every **other** stack, configured separately. */
	addToTopOther: boolean;
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
	 * Which day a calendar's week grid starts on: an explicit weekday
	 * (0 = Sunday … 6 = Saturday) or `auto`, the locale's own convention
	 * (i18n-and-dates.md §2.6). Display only, like every setting around it.
	 */
	weekStart: WeekStart;
	/**
	 * Ordered rules coloring a date badge as its date approaches or after it has
	 * passed; the first match wins. A board may replace the whole list in its own
	 * settings block (i18n-and-dates.md §3).
	 */
	dateHighlights: DateHighlightRule[];
	/**
	 * Before a plugin-requested board save, compare the complete logical board
	 * state with the file and skip the write when they match.
	 */
	reduceBoardFileWrites: boolean;
}

export const DEFAULT_SETTINGS: ExtraboardSettings = {
	defaultProperties: [],
	cardNoteFolder: '',
	progressStyle: 'ring',
	showRawPropertyTokens: false,
	fillCardWithColor: false,
	allowDeleteWithoutArchive: false,
	archiveLimit: 10000,
	archiveNewestFirst: true,
	addToTopCompleting: true,
	addToTopOther: true,
	language: 'auto',
	dateFormat: 'system',
	timeFormat: 'system',
	datePattern: '',
	timePattern: '',
	weekStart: 'auto',
	dateHighlights: [],
	reduceBoardFileWrites: false,
};
