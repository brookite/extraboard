// A board's view list: defaults, resolution, validation, and parsing.
// Spec: docs/specs/views.md §2. Pure; no `obsidian` imports.

import { sameField, type FieldRef } from './fieldValue';
import { isEmptyFilter, type FilterNode, type FilterOp } from './filter';
import type { SortRule } from './sort';
import type {
	BoardConfig,
	CalendarMode,
	ListControls,
	ListGroupBy,
	PropertyDef,
	PropertyType,
	SectionState,
	ViewDef,
	ViewDisplay,
	ViewKind,
} from './types';

/**
 * Property types a calendar view can be computed from (views.md §4.3).
 * `recurrence` joined them in M9, once rules could be expanded into days
 * (recurrence.md §3).
 */
const CALENDAR_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
	'datetime',
	'date-range',
	'date-list',
	'recurrence',
]);

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Default label of a view of this kind, used when the user leaves the name empty. */
export function defaultViewName(type: ViewKind): string {
	if (type === 'calendar') return 'Calendar';
	return type === 'list' ? 'List' : 'Board';
}

export function kanbanView(id: string, name = defaultViewName('kanban')): ViewDef {
	return { id, name, type: 'kanban' };
}

/** A list view in its default shape: dynamic controls, grouped by section,
 * nothing sorted or filtered. */
export function listView(id: string, name = defaultViewName('list')): ViewDef {
	return { id, name, type: 'list', controls: 'dynamic', groupBy: 'section' };
}

/** Lowest free `v<n>` id for a view list. */
export function nextViewId(views: readonly ViewDef[]): string {
	const taken = new Set(views.map((v) => v.id));
	for (let n = 1; ; n++) {
		const id = `v${String(n)}`;
		if (!taken.has(id)) return id;
	}
}

/**
 * The active view. Never undefined: a config always carries at least one view
 * (`normalizeViews`), and an unknown `activeView` falls back to the first one.
 */
export function activeViewOf(config: BoardConfig): ViewDef {
	const found = config.views.find((v) => v.id === config.activeView);
	return found ?? config.views[0] ?? kanbanView('v1');
}

/** Properties a calendar view can be built on (views.md §4.3). */
export function dateProperties(config: BoardConfig): PropertyDef[] {
	return config.properties.filter((p) => CALENDAR_TYPES.has(p.type));
}

/** True iff this property can drive a calendar. */
export function isCalendarProperty(def: PropertyDef | undefined): boolean {
	return def !== undefined && CALENDAR_TYPES.has(def.type);
}

export function hasKanbanView(views: readonly ViewDef[]): boolean {
	return views.some((v) => v.type === 'kanban');
}

/**
 * A validation diagnostic, structured rather than pre-rendered text, in the
 * shape `PropertyDiagnostic` uses: the model stays free of UI strings, and a
 * caller looks each `kind` up through `t()` (i18n-and-dates.md §1.2).
 */
export type ViewDiagnostic =
	| { kind: 'invalidId'; name: string }
	| { kind: 'duplicateId'; id: string }
	| { kind: 'missingDateProperty'; name: string; property: string }
	| { kind: 'wrongDatePropertyType'; name: string; property: string; type: string }
	/** Every one of a calendar's properties is gone: the grid has nothing to draw. */
	| { kind: 'noDateProperty'; name: string }
	/** A list view sorted by a property the board no longer declares as a date. */
	| { kind: 'missingSortProperty'; name: string; property: string }
	| { kind: 'tooManyKanban' };

/** Property names a filter or a sort names but the board no longer declares. */
function unknownProperties(view: Extract<ViewDef, { type: 'list' }>, config: BoardConfig): string[] {
	const out: string[] = [];
	const add = (field: FieldRef): void => {
		if (field.kind !== 'property') return;
		if (config.properties.some((p) => p.name === field.name)) return;
		if (!out.includes(field.name)) out.push(field.name);
	};
	const walk = (node: FilterNode): void => {
		if (node.kind === 'condition') add(node.field);
		else node.children.forEach(walk);
	};
	for (const rule of view.sorts ?? []) add(rule.field);
	if (view.filter) walk(view.filter);
	return out;
}

/**
 * Non-fatal diagnostics, in the shape `validatePropertyDefs` uses: reported to
 * the user, never thrown, never a reason to drop a board.
 */
export function validateViews(config: BoardConfig): ViewDiagnostic[] {
	const diags: ViewDiagnostic[] = [];
	const seen = new Set<string>();
	let kanban = 0;
	for (const view of config.views) {
		if (!ID_RE.test(view.id)) diags.push({ kind: 'invalidId', name: view.name });
		else if (seen.has(view.id)) diags.push({ kind: 'duplicateId', id: view.id });
		seen.add(view.id);
		if (view.type === 'kanban') kanban++;
		// A list that names a property the board dropped still renders — that key
		// simply reads as empty (filters-and-sorting.md §2.4) — so this is a
		// diagnostic, not a repair.
		if (view.type === 'list') {
			for (const property of unknownProperties(view, config)) {
				diags.push({ kind: 'missingSortProperty', name: view.name, property });
			}
		}
		// Each property is reported on its own, and losing one is not losing the
		// view: a calendar draws whatever is left (§4.3).
		if (view.type === 'calendar') {
			for (const property of view.dateProperties) {
				const def = config.properties.find((p) => p.name === property);
				if (!def) {
					diags.push({ kind: 'missingDateProperty', name: view.name, property });
				} else if (!CALENDAR_TYPES.has(def.type)) {
					diags.push({
						kind: 'wrongDatePropertyType',
						name: view.name,
						property,
						type: def.type,
					});
				}
			}
			if (!usableDateProperties(config, view).length) {
				diags.push({ kind: 'noDateProperty', name: view.name });
			}
		}
	}
	if (kanban > 1) diags.push({ kind: 'tooManyKanban' });
	return diags;
}

/**
 * The calendar's properties that the board still declares as dates, in the
 * view's own order — what the grid is actually computed from (§4.3).
 */
export function usableDateProperties(
	config: BoardConfig,
	view: Extract<ViewDef, { type: 'calendar' }>,
): string[] {
	return view.dateProperties.filter((name) =>
		isCalendarProperty(config.properties.find((p) => p.name === name)),
	);
}

/** True iff a calendar view still resolves against the board's properties. */
export function isViewUsable(config: BoardConfig, view: ViewDef): boolean {
	if (view.type !== 'calendar') return true;
	return usableDateProperties(config, view).length > 0;
}

// --- parsing ----------------------------------------------------------------

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function toCalendarMode(v: unknown): CalendarMode {
	return v === 'week' ? 'week' : 'month';
}

/** Anything but the two named modes is `dynamic`, the default (list-view.md §5). */
export function toListControls(v: unknown): ListControls {
	return v === 'fixed' || v === 'session' ? v : 'dynamic';
}

/** Anything but `stack` groups by section, the default (list-view.md §1.0). */
export function toListGroupBy(v: unknown): ListGroupBy {
	return v === 'stack' ? 'stack' : 'section';
}

/** A tag list: strings only, `#` stripped, blanks and duplicates dropped. */
function toTags(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: string[] = [];
	for (const entry of v) {
		const tag = asString(entry)?.trim().replace(/^#/, '');
		if (tag && !out.includes(tag)) out.push(tag);
	}
	return out.length ? out : undefined;
}

/**
 * A view's read-mode card settings (views.md §5). Display state, so anything
 * malformed reads as absent rather than dropping the view.
 */
export function toViewDisplay(v: unknown): ViewDisplay | undefined {
	if (!isRecord(v)) return undefined;
	const hiddenProperties = toNames(v.hiddenProperties);
	const flags = (['hideTags', 'hideCheckbox', 'hideProgress', 'hideColor'] as const).filter(
		(key) => v[key] === true,
	);
	if (!hiddenProperties && !flags.length) return undefined;
	const display: ViewDisplay = { ...(hiddenProperties && { hiddenProperties }) };
	for (const flag of flags) display[flag] = true;
	return display;
}

/** Non-empty, de-duplicated names, or `undefined` when there are none. */
function toNames(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: string[] = [];
	for (const entry of v) {
		const name = asString(entry)?.trim();
		if (name && !out.includes(name)) out.push(name);
	}
	return out.length ? out : undefined;
}

/**
 * A calendar's property list. `dateProperties` is what 0.3.0 writes;
 * `dateProperty` is the single name every earlier version wrote, and is still
 * read — and still written beside the list, so a board opened by an older
 * plugin keeps its calendar instead of losing the whole view (views.md §4.3).
 */
function toDateProperties(v: Record<string, unknown>): string[] {
	const listed = toNames(v.dateProperties);
	if (listed) return listed;
	const single = asString(v.dateProperty)?.trim();
	return single ? [single] : [];
}

/**
 * A section's state. Sorting and filtering were per-section before 0.3.0; those
 * keys are no longer read, and only `collapsed` survives a re-read
 * (filters-and-sorting.md §7).
 */
function toSectionState(v: unknown): SectionState | undefined {
	if (!isRecord(v)) return undefined;
	return v.collapsed === true ? { collapsed: true } : undefined;
}

// --- filters and sorting (filters-and-sorting.md §5) ------------------------

/** A field reference: `@title`/`@tags`/`@done`/`@note`, else a property name. */
function toFieldRef(v: unknown): FieldRef | null {
	const raw = asString(v)?.trim();
	if (!raw) return null;
	if (!raw.startsWith('@')) return { kind: 'property', name: raw };
	const id = raw.slice(1);
	if (id === 'title' || id === 'tags' || id === 'done' || id === 'note') {
		return { kind: 'builtin', id };
	}
	return null;
}

const FILTER_OPS: ReadonlySet<string> = new Set<FilterOp>([
	'equals', 'contains', 'between', 'lt', 'lte', 'gt', 'gte', 'isSet', 'linksTo',
]);

/**
 * One node of the filter tree. Anything that cannot be one is dropped — a
 * hand-edited condition with a typo in its operator costs that condition, never
 * the view.
 */
function toFilterNode(v: unknown): FilterNode | null {
	if (!isRecord(v)) return null;
	if (Array.isArray(v.children) || v.op === 'and' || v.op === 'or' || v.op === 'not') {
		const op = v.op === 'or' ? 'or' : v.op === 'not' ? 'not' : 'and';
		const children = Array.isArray(v.children)
			? v.children.map(toFilterNode).filter((child): child is FilterNode => child !== null)
			: [];
		return { kind: 'group', op, children };
	}
	const field = toFieldRef(v.field);
	const op = asString(v.op);
	if (!field || !op || !FILTER_OPS.has(op)) return null;
	const value = asString(v.value);
	const value2 = asString(v.value2);
	return {
		kind: 'condition',
		field,
		op: op as FilterOp,
		...(value !== undefined && { value }),
		...(value2 !== undefined && { value2 }),
	};
}

/** The view's filter, or `undefined` when it holds no conditions. */
export function toFilter(v: unknown): FilterNode | undefined {
	const node = toFilterNode(v);
	if (!node) return undefined;
	// A bare condition at the root is read as the one-child group it means.
	const root: FilterNode =
		node.kind === 'group' ? node : { kind: 'group', op: 'and', children: [node] };
	return isEmptyFilter(root) ? undefined : root;
}

export function toSortRules(v: unknown): SortRule[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: SortRule[] = [];
	for (const entry of v) {
		if (!isRecord(entry)) continue;
		const field = toFieldRef(entry.field);
		if (!field || out.some((rule) => sameField(rule.field, field))) continue;
		out.push({ field, dir: entry.dir === 'desc' ? 'desc' : 'asc' });
	}
	return out.length ? out : undefined;
}

/**
 * What a pre-0.3.0 list view said, in the shape 0.3.0 says it (§7): one sort
 * key from `sort`, and an `or` of tag conditions from `tags`. Per-section sorts
 * and filters have nowhere to go — the view owns both now — so they go with the
 * rest of the old section state.
 */
function migrateListView(v: Record<string, unknown>): { filter?: FilterNode; sorts?: SortRule[] } {
	const out: { filter?: FilterNode; sorts?: SortRule[] } = {};
	const legacy = isRecord(v.sort) ? v.sort : undefined;
	const property = legacy ? asString(legacy.property)?.trim() : undefined;
	if (property) {
		out.sorts = [
			{ field: { kind: 'property', name: property }, dir: legacy?.dir === 'desc' ? 'desc' : 'asc' },
		];
	}
	const tags = toTags(v.tags);
	if (tags) {
		out.filter = {
			kind: 'group',
			op: 'or',
			children: tags.map((tag) => ({
				kind: 'condition' as const,
				field: { kind: 'builtin' as const, id: 'tags' as const },
				op: 'contains' as const,
				value: tag,
			})),
		};
	}
	return out;
}

function toSections(v: unknown): Record<string, SectionState> | undefined {
	if (!isRecord(v)) return undefined;
	const out: Record<string, SectionState> = {};
	for (const [name, value] of Object.entries(v)) {
		const state = toSectionState(value);
		if (state) out[name] = state;
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * Read one view definition from the settings block, or `null` when it cannot be
 * one — an unusable definition is dropped exactly as an unparseable property
 * def is (views.md §2.3).
 */
export function toViewDef(v: unknown, id: string): ViewDef | null {
	if (!isRecord(v)) return null;
	const type = asString(v.type);
	const name = (asString(v.name) ?? '').trim();
	const display = toViewDisplay(v.display);
	if (type === 'kanban') {
		return { id, name: name || defaultViewName('kanban'), type, ...(display && { display }) };
	}
	if (type === 'list') {
		const legacy = migrateListView(v);
		const filter = toFilter(v.filter) ?? legacy.filter;
		const sorts = toSortRules(v.sorts) ?? legacy.sorts;
		const sections = toSections(v.sections);
		return {
			id,
			name: name || defaultViewName('list'),
			type,
			controls: toListControls(v.controls),
			groupBy: toListGroupBy(v.groupBy),
			...(filter && { filter }),
			...(sorts && { sorts }),
			...(sections && { sections }),
			...(display && { display }),
		};
	}
	if (type !== 'calendar') return null;
	const dateProperties = toDateProperties(v);
	// A calendar without a date property is not a view (views.md §4.3).
	if (!dateProperties.length) return null;
	return {
		id,
		name: name || defaultViewName('calendar'),
		type,
		dateProperties,
		mode: toCalendarMode(v.mode),
		...(display && { display }),
	};
}

/**
 * Parse the `views` list. Ids are taken from the file when they are well formed
 * and unique, and generated otherwise, so a hand-written list without ids still
 * loads.
 */
export function parseViews(raw: unknown): ViewDef[] {
	if (!Array.isArray(raw)) return [];
	const views: ViewDef[] = [];
	for (const entry of raw) {
		const wanted = isRecord(entry) ? asString(entry.id)?.trim() : undefined;
		const id = wanted && ID_RE.test(wanted) && !views.some((v) => v.id === wanted)
			? wanted
			: nextViewId(views);
		const view = toViewDef(entry, id);
		if (view) views.push(view);
	}
	return views;
}

/** Guarantee the invariant every consumer relies on: at least one view exists. */
export function normalizeViews(views: ViewDef[]): ViewDef[] {
	return views.length ? views : [kanbanView('v1')];
}
