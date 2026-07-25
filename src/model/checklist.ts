// A card's checklist: a nested Markdown task list indented under the card's own
// list item. Spec: docs/specs/markdown-format.md §4.5,
// card-content-and-checklists.md §4. Pure; no `obsidian` imports.
//
// The tree helpers below are total: an address that does not exist returns the
// list unchanged, so the UI never has to guard against a stale path.

export interface ChecklistItem {
	/** Character between the brackets, verbatim (`' '`, `'x'`, `'/'`, …). */
	marker: string;
	/** Inline Markdown after the marker. Never scanned for `@{…}` tokens. */
	text: string;
	children: ChecklistItem[];
}

/** Address of an item: sibling indexes from the root of the tree. */
export type ChecklistPath = number[];

/** A tab counts as 4 columns, so mixed tabs and spaces nest correctly. */
const TAB_WIDTH = 4;

const ITEM_RE = /^([ \t]+)- \[(.)\](?: (.*))?$/;

export function indentWidth(indent: string): number {
	let width = 0;
	for (const ch of indent) width += ch === '\t' ? TAB_WIDTH - (width % TAB_WIDTH) : 1;
	return width;
}

/** One parsed task line, before it is nested into a tree. */
export interface ChecklistRow {
	indent: number;
	marker: string;
	text: string;
}

/**
 * Nest flat task lines by indent: an item's parent is the nearest preceding
 * item with a strictly smaller indent, so an over-indented item is one level
 * deeper than its parent and never a gap. Shared by the file parser and the
 * card text processor, which see the same shapes with different indentation.
 */
export function buildChecklist(rows: ChecklistRow[]): ChecklistItem[] {
	const roots: ChecklistItem[] = [];
	// Open ancestors, outermost first; each entry is the indent it was found at.
	const open: { width: number; item: ChecklistItem }[] = [];
	for (const row of rows) {
		const item: ChecklistItem = { marker: row.marker, text: row.text, children: [] };
		while (open.length && open[open.length - 1]!.width >= row.indent) open.pop();
		const parent = open[open.length - 1];
		if (parent) parent.item.children.push(item);
		else roots.push(item);
		open.push({ width: row.indent, item });
	}
	return roots;
}

/** True iff an item's marker means "done" — the same rule as a card's (§4.0). */
export function isDone(item: ChecklistItem): boolean {
	return item.marker === 'x' || item.marker === 'X';
}

/**
 * Split a card's verbatim continuation lines into its checklist and the lines
 * that stay verbatim. Only the **contiguous leading block** of indented task
 * items is the checklist; the first line that is not one ends it.
 */
export function splitChecklist(lines: string[]): {
	checklist: ChecklistItem[];
	trailing: string[];
} {
	const rows: ChecklistRow[] = [];
	for (const line of lines) {
		const m = ITEM_RE.exec(line);
		if (!m) break;
		rows.push({ indent: indentWidth(m[1]!), marker: m[2]!, text: m[3] ?? '' });
	}
	return {
		checklist: buildChecklist(rows),
		trailing: rows.length ? lines.slice(rows.length) : lines,
	};
}

/** Canonical output: one tab per level, `- [<marker>] <text>`. */
export function serializeChecklist(items: ChecklistItem[], depth = 1): string[] {
	const out: string[] = [];
	for (const item of items) {
		const prefix = '\t'.repeat(depth);
		out.push(item.text ? `${prefix}- [${item.marker}] ${item.text}` : `${prefix}- [${item.marker}]`);
		out.push(...serializeChecklist(item.children, depth + 1));
	}
	return out;
}

/** `N/M` over every item at every level (§4.2). */
export function progress(items: ChecklistItem[]): { done: number; total: number } {
	let done = 0;
	let total = 0;
	for (const item of items) {
		total++;
		if (isDone(item)) done++;
		const sub = progress(item.children);
		done += sub.done;
		total += sub.total;
	}
	return { done, total };
}

export function cloneChecklist(items: ChecklistItem[]): ChecklistItem[] {
	return items.map((item) => ({ ...item, children: cloneChecklist(item.children) }));
}

// --- tree helpers -----------------------------------------------------------

/** The sibling list a path addresses into, or `null` when the path is stale. */
function siblingsAt(items: ChecklistItem[], path: ChecklistPath): ChecklistItem[] | null {
	let list = items;
	for (let i = 0; i < path.length - 1; i++) {
		const next = list[path[i]!];
		if (!next) return null;
		list = next.children;
	}
	return list;
}

export function itemAt(items: ChecklistItem[], path: ChecklistPath): ChecklistItem | null {
	if (!path.length) return null;
	const siblings = siblingsAt(items, path);
	return siblings?.[path[path.length - 1]!] ?? null;
}

/**
 * Rebuild the tree with `mutate` applied to the sibling list the path addresses.
 * Returns the original list when the path is stale or nothing changed.
 */
function editSiblings(
	items: ChecklistItem[],
	path: ChecklistPath,
	mutate: (siblings: ChecklistItem[], index: number) => boolean,
): ChecklistItem[] {
	if (!path.length) return items;
	const [head, ...rest] = path;
	const index = head!;

	if (rest.length === 0) {
		const siblings = items.slice();
		return mutate(siblings, index) ? siblings : items;
	}

	const parent = items[index];
	if (!parent) return items;
	const children = editSiblings(parent.children, rest, mutate);
	if (children === parent.children) return items;
	const out = items.slice();
	out[index] = { ...parent, children };
	return out;
}

export function updateItem(
	items: ChecklistItem[],
	path: ChecklistPath,
	change: Partial<Pick<ChecklistItem, 'marker' | 'text'>>,
): ChecklistItem[] {
	return editSiblings(items, path, (siblings, index) => {
		const item = siblings[index];
		if (!item) return false;
		const next = { ...item, ...change };
		if (next.marker === item.marker && next.text === item.text) return false;
		siblings[index] = next;
		return true;
	});
}

/** Toggle one row. Never cascades: the numbers describe what is written (§4.2). */
export function toggle(items: ChecklistItem[], path: ChecklistPath): ChecklistItem[] {
	const item = itemAt(items, path);
	if (!item) return items;
	return updateItem(items, path, { marker: isDone(item) ? ' ' : 'x' });
}

/** Insert a sibling directly after `path`; an empty path appends at the root. */
export function insertAfter(
	items: ChecklistItem[],
	path: ChecklistPath,
	item: ChecklistItem = { marker: ' ', text: '', children: [] },
): { items: ChecklistItem[]; path: ChecklistPath } {
	if (!path.length) {
		return { items: [...items, item], path: [items.length] };
	}
	const next = editSiblings(items, path, (siblings, index) => {
		if (!siblings[index]) return false;
		siblings.splice(index + 1, 0, item);
		return true;
	});
	if (next === items) return { items, path };
	return { items: next, path: [...path.slice(0, -1), path[path.length - 1]! + 1] };
}

/**
 * Remove a row. Its children are **promoted** into its place rather than
 * deleted with it, so a subtree is never lost to a single Backspace.
 */
export function removeAt(items: ChecklistItem[], path: ChecklistPath): ChecklistItem[] {
	return editSiblings(items, path, (siblings, index) => {
		const item = siblings[index];
		if (!item) return false;
		siblings.splice(index, 1, ...item.children);
		return true;
	});
}

/** Move a row with its subtree under the preceding sibling. */
export function indent(items: ChecklistItem[], path: ChecklistPath): { items: ChecklistItem[]; path: ChecklistPath } {
	const index = path[path.length - 1] ?? -1;
	if (index <= 0) return { items, path };
	const parentPath = path.slice(0, -1);
	const item = itemAt(items, path);
	const prev = itemAt(items, [...parentPath, index - 1]);
	if (!item || !prev) return { items, path };
	const at = prev.children.length;
	const next = editSiblings(items, path, (siblings, i) => {
		siblings.splice(i, 1);
		siblings[i - 1] = { ...prev, children: [...prev.children, item] };
		return true;
	});
	return { items: next, path: [...parentPath, index - 1, at] };
}

/** Move a row with its subtree out to become the next sibling of its parent. */
export function outdent(items: ChecklistItem[], path: ChecklistPath): { items: ChecklistItem[]; path: ChecklistPath } {
	if (path.length < 2) return { items, path };
	const item = itemAt(items, path);
	if (!item) return { items, path };
	const parentPath = path.slice(0, -1);
	// Detach first, then re-insert after the (now shorter) parent.
	const detached = editSiblings(items, path, (siblings, index) => {
		if (!siblings[index]) return false;
		siblings.splice(index, 1);
		return true;
	});
	return insertAfter(detached, parentPath, item);
}

/** Swap a row (with its subtree) with the sibling above or below it. */
export function move(
	items: ChecklistItem[],
	path: ChecklistPath,
	delta: -1 | 1,
): { items: ChecklistItem[]; path: ChecklistPath } {
	const index = path[path.length - 1] ?? -1;
	const target = index + delta;
	if (index < 0 || target < 0) return { items, path };
	const next = editSiblings(items, path, (siblings, i) => {
		const item = siblings[i];
		const other = siblings[i + delta];
		if (!item || !other) return false;
		siblings[i] = other;
		siblings[i + delta] = item;
		return true;
	});
	if (next === items) return { items, path };
	return { items: next, path: [...path.slice(0, -1), target] };
}

/** Depth-first order, so the modal can render and address rows in one pass. */
export function flatten(
	items: ChecklistItem[],
	path: ChecklistPath = [],
): { item: ChecklistItem; path: ChecklistPath }[] {
	const out: { item: ChecklistItem; path: ChecklistPath }[] = [];
	items.forEach((item, i) => {
		const here = [...path, i];
		out.push({ item, path: here });
		out.push(...flatten(item.children, here));
	});
	return out;
}
