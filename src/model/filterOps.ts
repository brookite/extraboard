// Which operators a field offers, and what the row needs to type beside them.
// Spec: docs/specs/filters-and-sorting.md §3. Pure; no `obsidian` imports.
//
// One table, read by the builder to fill its dropdowns and by the tests to
// prove that every offered operator is one the matcher understands.

import type { FieldKind } from './fieldValue';
import type { FilterOp } from './filter';

/**
 * The operators each kind of field offers, in the order the dropdown lists
 * them. `isSet` closes every list: it is the one question that needs no operand
 * and it reads as "has a value at all".
 */
export const OPS_BY_KIND: Record<FieldKind, readonly FilterOp[]> = {
	text: ['contains', 'equals', 'linksTo', 'isSet'],
	number: ['equals', 'lt', 'lte', 'gt', 'gte', 'between', 'isSet'],
	date: ['between', 'lt', 'lte', 'gt', 'gte', 'isSet'],
	bool: ['isSet'],
	list: ['contains', 'isSet'],
	link: ['linksTo', 'isSet'],
};

/** What the row shows for the operand. */
export type ValueEditor = 'none' | 'text' | 'number' | 'date' | 'option' | 'file';

/** The operand editor a row needs; `none` means the operator asks nothing. */
export function editorFor(kind: FieldKind, op: FilterOp, hasOptions: boolean): ValueEditor {
	if (op === 'isSet') return 'none';
	if (op === 'linksTo') return 'file';
	if (kind === 'date') return 'date';
	if (kind === 'number') return 'number';
	// A `string-list` with declared options is a closed vocabulary; typing into
	// it would only produce values the board cannot hold (properties.md §3.2).
	if (hasOptions && (op === 'contains' || op === 'equals')) return 'option';
	return 'text';
}

/** True when the operator takes a second operand — only `between` does. */
export function needsSecondValue(op: FilterOp): boolean {
	return op === 'between';
}

/** The operator a field falls back to when its kind no longer offers the old one. */
export function defaultOp(kind: FieldKind): FilterOp {
	return OPS_BY_KIND[kind][0] ?? 'isSet';
}

/** True iff this operator applies to this kind of field. */
export function supportsOp(kind: FieldKind, op: FilterOp): boolean {
	return OPS_BY_KIND[kind].includes(op);
}
