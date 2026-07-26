// In-memory data model for an Extraboard board.
// Spec: docs/specs/data-model.md and docs/specs/properties.md.
// This module (and all of src/model/**) is pure and must not import `obsidian`.

import type { Document as YamlDocument } from 'yaml';
import type { ChecklistItem } from './checklist';

export type ViewKind = 'kanban' | 'calendar';

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

export interface CalendarConfig {
	dateProperty?: string;
	mode: 'month' | 'week';
}

export interface BoardConfig {
	version: number;
	view: ViewKind;
	properties: PropertyDef[];
	tagColors: Record<string, BadgeColor>;
	/** Offer a task checkbox on cards that are not task list items yet. */
	showCardCheckbox?: boolean;
	cardContentDir?: string;
	/** Board override for the plugin's `progressStyle`; absent => follow it. */
	progressStyle?: ProgressStyle;
	calendar?: CalendarConfig;
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
	/** Verbatim lines following the divider (up to the next item). */
	trailing: string[];
}

export type StackItem =
	| { kind: 'card'; card: Card }
	| { kind: 'divider'; divider: Divider };

export interface Stack {
	name: string;
	collapsed: boolean;
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
}

export interface Board {
	config: BoardConfig;
	/** Opaque YAML document preserving foreign frontmatter keys/comments. */
	frontmatterDoc: YamlDocument | null;
	/** Body text before the first stack, verbatim ("" if none). */
	preamble: string;
	stacks: Stack[];
	/** The archive section; absent iff the file has none. */
	archive?: RawArchive;
	/** Unclassified body after the last stack, verbatim ("" if none). */
	trailing: string;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
	version: 1,
	view: 'kanban',
	properties: [],
	tagColors: {},
};
