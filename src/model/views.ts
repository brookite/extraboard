// A board's view list: defaults, resolution, validation, and the legacy
// upgrade. Spec: docs/specs/views.md §2. Pure; no `obsidian` imports.

import type { BoardConfig, CalendarMode, PropertyDef, PropertyType, ViewDef, ViewKind } from './types';

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
	return type === 'calendar' ? 'Calendar' : 'Board';
}

export function kanbanView(id: string, name = defaultViewName('kanban')): ViewDef {
	return { id, name, type: 'kanban' };
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
 * Non-fatal diagnostics, in the shape `validatePropertyDefs` uses: reported to
 * the user, never thrown, never a reason to drop a board.
 */
export function validateViews(config: BoardConfig): string[] {
	const diags: string[] = [];
	const seen = new Set<string>();
	let kanban = 0;
	for (const view of config.views) {
		if (!ID_RE.test(view.id)) diags.push(`View "${view.name}" has an invalid id.`);
		else if (seen.has(view.id)) diags.push(`View id "${view.id}" is used more than once.`);
		seen.add(view.id);
		if (view.type === 'kanban') kanban++;
		if (view.type === 'calendar') {
			const def = config.properties.find((p) => p.name === view.dateProperty);
			if (!def) {
				diags.push(`View "${view.name}" is computed from "${view.dateProperty}", which this board does not declare.`);
			} else if (!CALENDAR_TYPES.has(def.type)) {
				diags.push(`View "${view.name}": "${view.dateProperty}" is a ${def.type} property and cannot drive a calendar.`);
			}
		}
	}
	if (kanban > 1) diags.push('A board can hold at most one Kanban view.');
	return diags;
}

/** True iff a calendar view still resolves against the board's properties. */
export function isViewUsable(config: BoardConfig, view: ViewDef): boolean {
	if (view.type !== 'calendar') return true;
	return isCalendarProperty(config.properties.find((p) => p.name === view.dateProperty));
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

/**
 * Read one frontmatter view definition, or `null` when it cannot be one — an
 * unusable definition is dropped exactly as an unparseable property def is
 * (views.md §2.3).
 */
export function toViewDef(v: unknown, id: string): ViewDef | null {
	if (!isRecord(v)) return null;
	const type = asString(v.type);
	const name = (asString(v.name) ?? '').trim();
	if (type === 'kanban') return { id, name: name || defaultViewName('kanban'), type };
	if (type !== 'calendar') return null;
	const dateProperty = asString(v.dateProperty)?.trim();
	// A calendar without a date property is not a view (views.md §4.3).
	if (!dateProperty) return null;
	return {
		id,
		name: name || defaultViewName('calendar'),
		type,
		dateProperty,
		mode: toCalendarMode(v.mode),
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

/**
 * Upgrade a pre-M8 config (views.md §1.1): a Kanban view is always synthesized,
 * and a legacy `view: calendar` becomes a second, active view only when its
 * `dateProperty` is usable — a broken calendar is dropped rather than shown.
 */
export function upgradeLegacyViews(
	legacyView: unknown,
	legacyCalendar: unknown,
	properties: PropertyDef[],
): { views: ViewDef[]; activeView: string } {
	const views: ViewDef[] = [kanbanView('v1')];
	if (legacyView === 'calendar' && isRecord(legacyCalendar)) {
		const dateProperty = asString(legacyCalendar.dateProperty)?.trim();
		const def = properties.find((p) => p.name === dateProperty);
		if (dateProperty && isCalendarProperty(def)) {
			views.push({
				id: 'v2',
				name: defaultViewName('calendar'),
				type: 'calendar',
				dateProperty,
				mode: toCalendarMode(legacyCalendar.mode),
			});
			return { views, activeView: 'v2' };
		}
	}
	return { views, activeView: 'v1' };
}

/** Guarantee the invariant every consumer relies on: at least one view exists. */
export function normalizeViews(views: ViewDef[]): ViewDef[] {
	return views.length ? views : [kanbanView('v1')];
}
