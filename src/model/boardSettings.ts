// Board configuration <-> the `extraboard-settings` JSON code block that opens
// a board file, directly under the frontmatter.
// Spec: docs/specs/markdown-format.md §2. Pure; no `obsidian` imports.

import {
	BoardConfig,
	defaultBoardConfig,
	PropertyDef,
	PropertyType,
	StringListOption,
	BadgeColor,
} from './types';
import { normalizeViews, parseViews } from './views';
import type { DateHighlightRule, HighlightUnit } from './dateHighlights';

/** Info string of the fenced block holding the configuration. */
export const SETTINGS_LANG = 'extraboard-settings';

const PROPERTY_TYPES: ReadonlySet<string> = new Set<PropertyType>([
	'color', 'string', 'string-list', 'integer', 'percent',
	'datetime', 'date-range', 'recurrence', 'date-list', 'checkbox',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function toBadgeColor(v: unknown): BadgeColor | undefined {
	if (!isRecord(v)) return undefined;
	const bg = asString(v.bg);
	const fg = asString(v.fg);
	if (bg === undefined && fg === undefined) return undefined;
	return { ...(bg !== undefined && { bg }), ...(fg !== undefined && { fg }) };
}

const HIGHLIGHT_UNITS: ReadonlySet<string> = new Set<HighlightUnit>([
	'hour', 'day', 'week', 'month',
]);

/**
 * One `dateHighlights` entry. A malformed rule is dropped rather than kept as
 * junk the matcher would have to guard against on every render; the editor is
 * where an incomplete rule is flagged and preserved (i18n-and-dates.md §3.3).
 */
function toHighlightRule(v: unknown): DateHighlightRule | null {
	if (!isRecord(v)) return null;
	const when = asString(v.when);
	const unit = asString(v.unit);
	const color = asString(v.color);
	if (when !== 'before' && when !== 'after') return null;
	if (unit === undefined || !HIGHLIGHT_UNITS.has(unit)) return null;
	if (color === undefined) return null;
	if (typeof v.amount !== 'number' || !Number.isInteger(v.amount) || v.amount < 0) return null;
	const property = asString(v.property);
	return {
		...(property !== undefined && property !== '' && { property }),
		when,
		amount: v.amount,
		unit: unit as HighlightUnit,
		color,
	};
}

function toPropertyDef(v: unknown): PropertyDef | null {
	if (!isRecord(v)) return null;
	const name = asString(v.name);
	const type = asString(v.type);
	if (!name || !type || !PROPERTY_TYPES.has(type)) return null;
	const def: PropertyDef = { name, type: type as PropertyType };
	if (typeof v.strict === 'boolean') def.strict = v.strict;
	if (Array.isArray(v.options)) {
		const options: StringListOption[] = [];
		for (const o of v.options) {
			if (!isRecord(o)) continue;
			const value = asString(o.value);
			if (value === undefined) continue;
			const bg = asString(o.bg);
			const fg = asString(o.fg);
			options.push({ value, ...(bg !== undefined && { bg }), ...(fg !== undefined && { fg }) });
		}
		def.options = options;
	}
	const time = asString(v.time);
	if (time === 'none' || time === 'optional' || time === 'required') def.time = time;
	return def;
}

/** Read a decoded settings object into a BoardConfig, applying every default. */
export function toConfig(raw: unknown): BoardConfig {
	const config: BoardConfig = defaultBoardConfig();
	if (!isRecord(raw)) return config;

	if (typeof raw.version === 'number') config.version = raw.version;
	if (typeof raw.showCardCheckbox === 'boolean') config.showCardCheckbox = raw.showCardCheckbox;

	const dir = asString(raw.cardContentDir);
	if (dir !== undefined) config.cardContentDir = dir;

	const style = asString(raw.progressStyle);
	if (style === 'ring' || style === 'fraction' || style === 'percent') {
		config.progressStyle = style;
	}

	// Read only when present: absent is "follow the plugin setting", which is
	// different from an explicit `false` (kanban-view.md §6.7).
	if (typeof raw.addToTopCompleting === 'boolean') config.addToTopCompleting = raw.addToTopCompleting;
	if (typeof raw.addToTopOther === 'boolean') config.addToTopOther = raw.addToTopOther;

	// Read only when the key is present: an empty list is a board saying "no
	// highlights", which is different from following the plugin setting (§3.2).
	if ('dateHighlights' in raw) {
		config.dateHighlights = Array.isArray(raw.dateHighlights)
			? raw.dateHighlights.map(toHighlightRule).filter((r): r is DateHighlightRule => r !== null)
			: [];
	}

	if (Array.isArray(raw.properties)) {
		config.properties = raw.properties
			.map(toPropertyDef)
			.filter((d): d is PropertyDef => d !== null);
	}

	config.views = normalizeViews(parseViews(raw.views));
	const active = asString(raw.activeView)?.trim();
	config.activeView = active && config.views.some((v) => v.id === active)
		? active
		: config.views[0]!.id;

	if (isRecord(raw.tagColors)) {
		for (const [tag, v] of Object.entries(raw.tagColors)) {
			const c = toBadgeColor(v);
			if (c) config.tagColors[tag] = c;
		}
	}

	return config;
}

/** Minimal, empty-pruned plain object written into the settings block. */
export function configToPlain(config: BoardConfig): Record<string, unknown> {
	const out: Record<string, unknown> = { version: config.version };
	const views = normalizeViews(config.views);
	out.views = views.map((v) =>
		v.type === 'calendar'
			? { id: v.id, name: v.name, type: v.type, dateProperty: v.dateProperty, mode: v.mode }
			: { id: v.id, name: v.name, type: v.type },
	);
	// The first view is the default, so naming it would be noise.
	if (config.activeView && config.activeView !== views[0]?.id) out.activeView = config.activeView;
	if (config.showCardCheckbox) out.showCardCheckbox = true;
	if (config.cardContentDir) out.cardContentDir = config.cardContentDir;
	if (config.progressStyle) out.progressStyle = config.progressStyle;
	// Written whenever set, `false` included: it is an override, and omitting a
	// `false` would silently turn it back into "follow the plugin".
	if (config.addToTopCompleting !== undefined) out.addToTopCompleting = config.addToTopCompleting;
	if (config.addToTopOther !== undefined) out.addToTopOther = config.addToTopOther;
	// An empty array is written on purpose — it is how a board says "no
	// highlights" instead of "follow the plugin setting".
	if (config.dateHighlights) out.dateHighlights = config.dateHighlights;
	if (config.properties.length) out.properties = config.properties;
	if (Object.keys(config.tagColors).length) out.tagColors = config.tagColors;
	return out;
}

const FENCE_OPEN = new RegExp('^`{3}' + SETTINGS_LANG + '[ \\t]*$');
const FENCE_CLOSE = /^`{3}[ \t]*$/;

/**
 * Split the settings block off the front of the body. The block has to be the
 * body's first content (blank lines above it are allowed but not preserved);
 * an unterminated fence is not a block at all, and the text stays body.
 */
export function splitSettingsBlock(body: string): { json: string; rest: string } | null {
	const lines = body.split('\n');
	let open = 0;
	while (open < lines.length && lines[open]!.trim() === '') open++;
	if (open >= lines.length || !FENCE_OPEN.test(lines[open]!)) return null;
	for (let i = open + 1; i < lines.length; i++) {
		if (!FENCE_CLOSE.test(lines[i]!)) continue;
		return {
			json: lines.slice(open + 1, i).join('\n'),
			rest: lines.slice(i + 1).join('\n'),
		};
	}
	return null;
}

/**
 * Read the leading settings block and return it with the body below it. A block
 * that is absent or holds invalid JSON yields the default configuration; either
 * way the block itself never reaches the body, so the next save replaces it
 * with a canonical one instead of leaving two.
 */
export function parseBoardSettings(body: string): { config: BoardConfig; body: string } {
	const split = splitSettingsBlock(body);
	if (!split) return { config: defaultBoardConfig(), body };
	let raw: unknown;
	try {
		raw = JSON.parse(split.json);
	} catch {
		raw = undefined;
	}
	return { config: toConfig(raw), body: split.rest };
}

/** The settings block for a config, including its trailing newline. */
export function serializeSettingsBlock(config: BoardConfig): string {
	const json = JSON.stringify(configToPlain(config), null, 2);
	return '```' + SETTINGS_LANG + '\n' + json + '\n```\n';
}
