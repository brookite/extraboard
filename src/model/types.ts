// In-memory data model for an Extraboard board.
// Spec: docs/specs/data-model.md and docs/specs/properties.md.
// This module (and all of src/model/**) is pure and must not import `obsidian`.

import type { ChecklistItem } from './checklist';
// Type-only, so the `dateHighlights.ts` <-> `types.ts` pair stays a compile-time
// cycle that erases away, exactly like `ChecklistItem` above.
import type { DateHighlightRule } from './dateHighlights';

export type ViewKind = 'kanban' | 'calendar' | 'list';

export type CalendarMode = 'month' | 'week';

/**
 * How a list view's per-section sort and filter behave (list-view.md §3.4):
 * `dynamic` — set per section and written into the view; `fixed` — one sort and
 * filter for the whole view, set on the view form; `session` — set per section
 * and never written.
 */
export type ListControls = 'dynamic' | 'fixed' | 'session';

/** A list section's sort: a date-family property, ascending or descending. */
export interface SectionSort {
	property: string;
	dir: 'asc' | 'desc';
}

/**
 * Display state of one list section (list-view.md §5), keyed in `sections` by
 * the section name — the empty string being the sectionless group.
 */
export interface SectionState {
	sort?: SectionSort;
	/** Tag names without `#`; a card matching any of them is shown. */
	tags?: string[];
	collapsed?: boolean;
}

/**
 * One of a board's views. `id` is generated and stable; `name` is the user's
 * label. Spec: docs/specs/views.md §1–§2 and docs/specs/list-view.md §5.
 */
export type ViewDef =
	| { id: string; name: string; type: 'kanban' }
	| {
			id: string;
			name: string;
			type: 'calendar';
			/** Board property the grid is computed from; required. */
			dateProperty: string;
			mode: CalendarMode;
	  }
	| {
			id: string;
			name: string;
			type: 'list';
			controls: ListControls;
			/** The view-wide sort; the only one that applies under `fixed`. */
			sort?: SectionSort;
			/** The view-wide tag filter; the only one that applies under `fixed`. */
			tags?: string[];
			/** Per-section state, by section name (`''` = the sectionless group). */
			sections?: Record<string, SectionState>;
	  };

/** Shape of the checklist `N/M` indicator and of `percent` badges. */
export type ProgressStyle = 'ring' | 'fraction' | 'percent';

export type PropertyType =
	| 'color'
	| 'string'
	| 'string-list'
	| 'integer'
	| 'percent'
	| 'datetime'
	| 'date-range'
	| 'recurrence'
	| 'date-list'
	| 'checkbox';

export interface BadgeColor {
	bg?: string;
	fg?: string;
}

export interface StringListOption {
	value: string;
	bg?: string;
	fg?: string;
}

export interface PropertyDef {
	name: string;
	type: PropertyType;
	/** string-list only */
	strict?: boolean;
	/** string-list only */
	options?: StringListOption[];
	/** datetime family only */
	time?: 'none' | 'optional' | 'required';
}

export interface BoardConfig {
	version: number;
	/** Ordered view list; never empty (views.md §2.2). */
	views: ViewDef[];
	/** Id of the active view; resolved through `activeViewOf` when unknown. */
	activeView: string;
	properties: PropertyDef[];
	tagColors: Record<string, BadgeColor>;
	/** Offer a task checkbox on cards that are not task list items yet. */
	showCardCheckbox?: boolean;
	cardContentDir?: string;
	/** Board override for the plugin's `progressStyle`; absent => follow it. */
	progressStyle?: ProgressStyle;
	/**
	 * Where a card entering a **completing** stack goes: `true` — the top,
	 * `false` — the end. Absent => follow the plugin setting
	 * (kanban-view.md §6.7).
	 */
	addToTopCompleting?: boolean;
	/** The same for every **other** stack, configured separately. */
	addToTopOther?: boolean;
	/**
	 * Board override for the plugin's date highlight rules; absent => follow it.
	 * An empty list is not "absent": it means this board wants no highlights at
	 * all (i18n-and-dates.md §3.2).
	 */
	dateHighlights?: DateHighlightRule[];
}

/** Ordered, discriminated card property values. Spec: properties.md. */
export type PropertyValue =
	| { name: string; type: 'color'; value: string }
	| { name: string; type: 'string'; value: string }
	| { name: string; type: 'string-list'; value: string[] }
	| { name: string; type: 'integer'; value: number }
	| { name: string; type: 'percent'; value: number }
	| { name: string; type: 'checkbox'; value: boolean }
	| { name: string; type: 'datetime'; raw: string }
	| { name: string; type: 'date-range'; raw: string }
	| { name: string; type: 'recurrence'; raw: string }
	| { name: string; type: 'date-list'; raw: string[] }
	| { name: string; type: 'raw'; value: string[] };

export interface Card {
	title: string;
	properties: PropertyValue[];
	tags: string[];
	/**
	 * Raw task marker of a `- [x] ` list item, e.g. `' '`, `'x'`, `'/'`, stored
	 * verbatim so custom statuses round-trip. Absent => plain list item.
	 * "Done" means `'x'` or `'X'`. Spec: markdown-format.md §4.0.
	 */
	task?: string;
	/**
	 * Nested task list directly under the card's line — the leading contiguous
	 * block only. Empty when the card has none. Spec: markdown-format.md §4.5.
	 */
	checklist: ChecklistItem[];
	/** Verbatim continuation/nested lines below the card's checklist. */
	trailing: string[];
}

export interface Divider {
	/** Present => `### name`; absent => `---`. */
	name?: string;
	collapsed: boolean;
	/**
	 * `%%color|…%%` — a CSS color, verbatim, that the cards of this divider's
	 * group inherit. Named dividers only. Spec:
	 * stack-completion-and-divider-colors.md §4.
	 */
	color?: string;
	/** Verbatim lines following the divider (up to the next item). */
	trailing: string[];
}

export type StackItem =
	| { kind: 'card'; card: Card }
	| { kind: 'divider'; divider: Divider };

export interface Stack {
	name: string;
	collapsed: boolean;
	/**
	 * `%%completes%%` — a card entering this stack is completed (its task marker
	 * and every checklist item become `x`). Spec:
	 * stack-completion-and-divider-colors.md §3.
	 */
	completes: boolean;
	/** Verbatim lines between the `## ` heading and the first item. */
	lead: string[];
	items: StackItem[];
}

/**
 * The archive section, kept as text. Opening a board must not cost what its
 * archive weighs, so nothing here is interpreted until the archive modal asks
 * for it (archive.md §4). Spec: markdown-format.md §5.
 */
export interface RawArchive {
	/** Heading text without the `%%archive%%` marker; `Archive` when created. */
	heading: string;
	/** Everything after the heading line, verbatim. */
	body: string;
}

/** One archived card, as `model/archive.ts` reads it back on demand. */
export interface ArchivedCard {
	card: Card;
	/** Origin stack name from `%%from|…%%`; absent when unknown. */
	from?: string;
	/**
	 * When the card was archived, from `%%at|…%%`: canonical `YYYY-MM-DD HH:mm`
	 * local time (dates.ts `formatDate`), so it both sorts as text and reads as a
	 * date. Absent when unknown — every card archived before the marker existed
	 * is that case. It lives **only** in the archive: restoring drops it.
	 */
	at?: string;
}

export interface Board {
	config: BoardConfig;
	/**
	 * Raw frontmatter text between the `---` delimiters, never reformatted, so
	 * foreign keys and comments survive; null iff the file has no frontmatter.
	 */
	frontmatter: string | null;
	/** Body text between the settings block and the first stack, verbatim ("" if none). */
	preamble: string;
	stacks: Stack[];
	/** The archive section; absent iff the file has none. */
	archive?: RawArchive;
	/** Unclassified body after the last stack, verbatim ("" if none). */
	trailing: string;
}

/**
 * A board's starting configuration. A function rather than a shared constant:
 * `views` and `properties` are mutable arrays, and every caller owns its copy.
 */
export function defaultBoardConfig(): BoardConfig {
	return {
		version: 1,
		views: [{ id: 'v1', name: 'Board', type: 'kanban' }],
		activeView: 'v1',
		properties: [],
		tagColors: {},
	};
}
