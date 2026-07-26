// Board frontmatter <-> BoardConfig, using the `yaml` Document API so that
// foreign frontmatter keys and comments survive a load->save cycle.
// Spec: docs/specs/markdown-format.md §2. Pure; no `obsidian` imports.

import { Document, parseDocument } from 'yaml';
import {
	BoardConfig,
	defaultBoardConfig,
	PropertyDef,
	PropertyType,
	StringListOption,
	BadgeColor,
} from './types';
import { normalizeViews, parseViews, upgradeLegacyViews } from './views';

const PROPERTY_TYPES: ReadonlySet<string> = new Set<PropertyType>([
	'color', 'string', 'string-list', 'integer', 'percent',
	'datetime', 'date-range', 'recurrence', 'date-list', 'checkbox',
]);

export interface Frontmatter {
	/** Opaque YAML document (null if the file has no frontmatter). */
	doc: Document | null;
	config: BoardConfig;
	body: string;
	/** True iff a top-level `extraboard` mapping is present. */
	isBoard: boolean;
}

/**
 * Split leading YAML frontmatter from the body. Returns null if the text does
 * not begin with a `---` delimited block.
 */
export function splitFrontmatter(
	text: string,
): { yamlText: string; body: string } | null {
	const firstNl = text.indexOf('\n');
	if (firstNl === -1) return null;
	if (text.slice(0, firstNl).replace(/\r$/, '') !== '---') return null;

	let searchStart = firstNl + 1;
	for (;;) {
		const nl = text.indexOf('\n', searchStart);
		const lineEnd = nl === -1 ? text.length : nl;
		const line = text.slice(searchStart, lineEnd).replace(/\r$/, '');
		if (line === '---') {
			return {
				yamlText: text.slice(firstNl + 1, searchStart),
				body: nl === -1 ? '' : text.slice(nl + 1),
			};
		}
		if (nl === -1) return null; // no closing delimiter
		searchStart = nl + 1;
	}
}

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

function toConfig(eb: unknown): BoardConfig {
	const config: BoardConfig = defaultBoardConfig();
	if (!isRecord(eb)) return config;

	if (typeof eb.version === 'number') config.version = eb.version;
	if (typeof eb.showCardCheckbox === 'boolean') config.showCardCheckbox = eb.showCardCheckbox;

	const dir = asString(eb.cardContentDir);
	if (dir !== undefined) config.cardContentDir = dir;

	const style = asString(eb.progressStyle);
	if (style === 'ring' || style === 'fraction' || style === 'percent') {
		config.progressStyle = style;
	}

	if (Array.isArray(eb.properties)) {
		config.properties = eb.properties
			.map(toPropertyDef)
			.filter((d): d is PropertyDef => d !== null);
	}

	// Views are resolved after the properties, because upgrading a legacy
	// `view: calendar` has to check its date property against them (views.md §1.1).
	if ('views' in eb) {
		config.views = normalizeViews(parseViews(eb.views));
		const active = asString(eb.activeView)?.trim();
		config.activeView = active && config.views.some((v) => v.id === active)
			? active
			: (config.views[0]?.id ?? 'v1');
	} else {
		const upgraded = upgradeLegacyViews(eb.view, eb.calendar, config.properties);
		config.views = upgraded.views;
		config.activeView = upgraded.activeView;
	}

	if (isRecord(eb.tagColors)) {
		for (const [tag, v] of Object.entries(eb.tagColors)) {
			const c = toBadgeColor(v);
			if (c) config.tagColors[tag] = c;
		}
	}

	return config;
}

/** Parse frontmatter and body; read the `extraboard` config into a BoardConfig. */
export function parseFrontmatter(text: string): Frontmatter {
	const split = splitFrontmatter(text);
	if (!split) {
		return { doc: null, config: defaultBoardConfig(), body: text, isBoard: false };
	}
	const doc = parseDocument(split.yamlText);
	const js = doc.toJS() as unknown;
	const eb = isRecord(js) ? js.extraboard : undefined;
	return {
		doc,
		config: toConfig(eb),
		body: split.body,
		isBoard: isRecord(js) && 'extraboard' in js,
	};
}

/** Reassemble frontmatter block + body into full file text. */
export function serializeFrontmatter(doc: Document | null, body: string): string {
	if (!doc) return body;
	let docStr = String(doc);
	if (!docStr.endsWith('\n')) docStr += '\n';
	return `---\n${docStr}---\n${body}`;
}

/**
 * Minimal, empty-pruned plain object for writing `extraboard` config. Writing
 * `views` is what upgrades a legacy board: the old `view` / `calendar` keys are
 * simply not emitted (views.md §1.1).
 */
function configToPlain(config: BoardConfig): Record<string, unknown> {
	const eb: Record<string, unknown> = { version: config.version };
	const views = normalizeViews(config.views);
	eb.views = views.map((v) =>
		v.type === 'calendar'
			? { id: v.id, name: v.name, type: v.type, dateProperty: v.dateProperty, mode: v.mode }
			: { id: v.id, name: v.name, type: v.type },
	);
	// The first view is the default, so naming it would be noise.
	if (config.activeView && config.activeView !== views[0]?.id) eb.activeView = config.activeView;
	if (config.showCardCheckbox) eb.showCardCheckbox = true;
	if (config.cardContentDir) eb.cardContentDir = config.cardContentDir;
	if (config.progressStyle) eb.progressStyle = config.progressStyle;
	if (config.properties.length) eb.properties = config.properties;
	if (Object.keys(config.tagColors).length) eb.tagColors = config.tagColors;
	return eb;
}

/** Write config back into an existing document's `extraboard` node. */
export function writeConfig(doc: Document, config: BoardConfig): void {
	doc.set('extraboard', configToPlain(config));
}

/** Build a fresh document for a new board file. */
export function configToDoc(config: BoardConfig): Document {
	const doc = new Document({ extraboard: configToPlain(config) });
	return doc;
}
