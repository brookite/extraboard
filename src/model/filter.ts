// The filter tree: conditions, groups, and what they mean against a card.
// Spec: docs/specs/filters-and-sorting.md §3, §4. Pure; no `obsidian` imports.
//
// Nodes are addressed by path — a list of child indexes, exactly as a checklist
// item is (`model/checklist.ts`) — so nothing in the file needs an id and the
// builder can move a node the same way it moves a checklist row.

import { CalDate, compareDates, parseDate } from './dates';
import {
	FieldCtx,
	FieldRef,
	FieldValue,
	fieldKind,
	isSet,
	linksOf,
	readField,
} from './fieldValue';
import { sameLinkTarget } from './link';
import type { ItemRef } from './ops';
import type { Board, Card } from './types';

export type FilterOp =
	| 'equals'
	| 'contains'
	| 'between'
	| 'lt'
	| 'lte'
	| 'gt'
	| 'gte'
	| 'isSet'
	| 'linksTo';

export interface FilterCondition {
	kind: 'condition';
	field: FieldRef;
	op: FilterOp;
	/** The operand, as typed; dates are canonical `YYYY-MM-DD[ HH:mm]`. */
	value?: string;
	/** The upper bound of `between`. */
	value2?: string;
}

/**
 * How a group joins its children (§4): `and` — all of them, `or` — any of them,
 * `not` — none of them. An empty group matches everything, so a half-built
 * filter never hides the board.
 */
export interface FilterGroup {
	kind: 'group';
	op: 'and' | 'or' | 'not';
	children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

/** Child indexes from the root down; `[]` is the root itself. */
export type NodePath = number[];

export function emptyGroup(op: FilterGroup['op'] = 'and'): FilterGroup {
	return { kind: 'group', op, children: [] };
}

/** True when the filter has nothing to say and can be left out of the file. */
export function isEmptyFilter(node: FilterNode | undefined): boolean {
	return !node || (node.kind === 'group' && node.children.length === 0);
}

/** How many conditions a filter carries, at any depth — the badge's count. */
export function countConditions(node: FilterNode | undefined): number {
	if (!node) return 0;
	if (node.kind === 'condition') return 1;
	return node.children.reduce((sum, child) => sum + countConditions(child), 0);
}

// --- matching ---------------------------------------------------------------

const fold = (text: string): string => text.trim().toLowerCase();

/** `a` and `b` as the same text, case- and space-insensitively. */
function textEquals(a: string, b: string): boolean {
	return fold(a) === fold(b);
}

function textOf(value: FieldValue): string[] {
	switch (value.kind) {
		case 'text':
			return [value.text];
		case 'list':
			return value.values;
		case 'number':
			return [String(value.value)];
		case 'bool':
			return [value.value ? 'true' : 'false'];
		case 'date':
			return [];
		case 'none':
			return [];
	}
}

/**
 * Dates compare **existentially**: a value matches when any of its spans does
 * (§3.2). `<` and `<=` look at where a span starts, `>` and `>=` at where it
 * ends, and `between` asks whether it overlaps the window at all — so a range
 * that straddles a bound is caught by both sides, which is what a person means
 * by "during".
 */
function matchDate(value: FieldValue, op: FilterOp, from: CalDate | null, to: CalDate | null): boolean {
	if (value.kind !== 'date') return false;
	return value.spans.some((span) => {
		switch (op) {
			case 'lt':
				return from !== null && compareDates(span.start, from) < 0;
			case 'lte':
				return from !== null && compareDates(span.start, from) <= 0;
			case 'gt':
				return from !== null && compareDates(span.end, from) > 0;
			case 'gte':
				return from !== null && compareDates(span.end, from) >= 0;
			case 'between':
				if (from === null || to === null) return false;
				return compareDates(span.end, from) >= 0 && compareDates(span.start, to) <= 0;
			default:
				return false;
		}
	});
}

function matchNumber(value: FieldValue, op: FilterOp, operand: number, operand2: number): boolean {
	if (value.kind !== 'number') return false;
	switch (op) {
		case 'equals':
			return value.value === operand;
		case 'lt':
			return value.value < operand;
		case 'lte':
			return value.value <= operand;
		case 'gt':
			return value.value > operand;
		case 'gte':
			return value.value >= operand;
		case 'between':
			return value.value >= operand && value.value <= operand2;
		default:
			return false;
	}
}

/** One condition against one card (§3). */
export function matchCondition(card: Card, condition: FilterCondition, ctx: FieldCtx): boolean {
	const value = readField(card, condition.field, ctx);
	const operand = condition.value ?? '';

	if (condition.op === 'isSet') return isSet(value);
	// An operator with no operand is an unfinished row, not a filter that hides
	// every card: it matches everything until the user types something (§4.3).
	if (!operand.trim()) return true;
	if (value.kind === 'none') return false;

	switch (condition.op) {
		case 'linksTo':
			return linksOf(value).some((target) => sameLinkTarget(target, operand));
		case 'equals':
			if (fieldKind(ctx.config, condition.field) === 'number') {
				return matchNumber(value, 'equals', Number(operand), 0);
			}
			return textOf(value).some((text) => textEquals(text, operand));
		case 'contains':
			return textOf(value).some((text) => fold(text).includes(fold(operand)));
		case 'between':
		case 'lt':
		case 'lte':
		case 'gt':
		case 'gte': {
			if (value.kind === 'number') {
				return matchNumber(value, condition.op, Number(operand), Number(condition.value2 ?? ''));
			}
			return matchDate(value, condition.op, parseDate(operand), parseDate(condition.value2 ?? ''));
		}
		default:
			return true;
	}
}

/** The whole tree against one card (§4). */
export function matchCard(card: Card, node: FilterNode, ctx: FieldCtx): boolean {
	if (node.kind === 'condition') return matchCondition(card, node, ctx);
	// An empty group is not a filter yet, whatever its operator.
	if (!node.children.length) return true;
	if (node.op === 'and') return node.children.every((child) => matchCard(card, child, ctx));
	if (node.op === 'or') return node.children.some((child) => matchCard(card, child, ctx));
	return !node.children.some((child) => matchCard(card, child, ctx));
}

function cardAt(board: Board, ref: ItemRef): Card | undefined {
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'card' ? entry.card : undefined;
}

/** `refs` narrowed to the cards the filter keeps. */
export function filterCards(
	board: Board,
	refs: ItemRef[],
	filter: FilterNode | undefined,
	ctx: FieldCtx,
): ItemRef[] {
	if (isEmptyFilter(filter) || !filter) return refs;
	return refs.filter((ref) => {
		const card = cardAt(board, ref);
		return card ? matchCard(card, filter, ctx) : false;
	});
}

// --- the tree ---------------------------------------------------------------

export function nodeAt(root: FilterNode, path: NodePath): FilterNode | null {
	let node: FilterNode = root;
	for (const index of path) {
		if (node.kind !== 'group') return null;
		const child = node.children[index];
		if (!child) return null;
		node = child;
	}
	return node;
}

export function samePath(a: NodePath, b: NodePath): boolean {
	return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** True when `path` is `parent` itself or lives inside it. */
export function isInside(path: NodePath, parent: NodePath): boolean {
	return parent.every((n, i) => path[i] === n);
}

/** A copy of `root` with the node at `path` replaced by `next`. */
export function replaceNode(root: FilterNode, path: NodePath, next: FilterNode): FilterNode {
	if (!path.length) return next;
	if (root.kind !== 'group') return root;
	const [head, ...rest] = path;
	const child = root.children[head ?? -1];
	if (head === undefined || !child) return root;
	const children = root.children.slice();
	children[head] = replaceNode(child, rest, next);
	return { ...root, children };
}

/** A copy of `root` without the node at `path`; the root itself never goes. */
export function removeAt(root: FilterNode, path: NodePath): FilterNode {
	if (!path.length || root.kind !== 'group') return root;
	const parentPath = path.slice(0, -1);
	const index = path[path.length - 1]!;
	const parent = nodeAt(root, parentPath);
	if (parent?.kind !== 'group') return root;
	const children = parent.children.filter((_, i) => i !== index);
	return replaceNode(root, parentPath, { ...parent, children });
}

/** A copy of `root` with `node` inserted into `group` at `index` (end by default). */
export function insertInto(
	root: FilterNode,
	group: NodePath,
	node: FilterNode,
	index?: number,
): FilterNode {
	const target = nodeAt(root, group);
	if (target?.kind !== 'group') return root;
	const children = target.children.slice();
	children.splice(index ?? children.length, 0, node);
	return replaceNode(root, group, { ...target, children });
}

/**
 * Move the node at `from` into `group`, before the child at `before` (or at the
 * end). A group cannot be dropped inside itself — the tree would leave the tree
 * — so that move is refused rather than silently dropping the branch.
 */
export function moveNode(
	root: FilterNode,
	from: NodePath,
	group: NodePath,
	before: number | null,
): FilterNode {
	const moved = nodeAt(root, from);
	if (!moved || !from.length) return root;
	if (isInside(group, from)) return root;

	const fromParent = from.slice(0, -1);
	const fromIndex = from[from.length - 1]!;

	// Both coordinates are read against the tree *before* the removal, and the
	// removal shifts everything after the moved node up by one: the target group
	// when it sits inside the same parent, and the drop index when it is that
	// parent itself.
	const target = group.slice();
	const ancestor = group.slice(0, fromParent.length);
	if (samePath(fromParent, ancestor) && group.length > fromParent.length) {
		const at = group[fromParent.length]!;
		if (at > fromIndex) target[fromParent.length] = at - 1;
	}
	let index = before;
	if (samePath(fromParent, group) && index !== null && index > fromIndex) index--;

	const without = removeAt(root, from);
	return insertInto(without, target, moved, index ?? undefined);
}
