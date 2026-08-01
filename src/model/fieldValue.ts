// What a filter matches and a sort compares: one card, one field, one value.
// Spec: docs/specs/filters-and-sorting.md §2. Pure; no `obsidian` imports.
//
// Filters, sorting and the operator catalogue all read cards through this
// module, so "what a `date-list` means" is answered once instead of three times.

import { anchorFor } from './calendar';
import { CalDate, DateSpan, parseSpan } from './dates';
import { linksIn, parseCardLink, unlinkedTitle } from './link';
import { isCardDone } from './ops';
import { nextOccurrence, parseRecurrence } from './recurrence';
import type { BoardConfig, Card, PropertyValue } from './types';

/**
 * A card's own conceptual properties (§2.2): the ones every card has without
 * the board declaring them.
 */
export type BuiltinField = 'title' | 'tags' | 'done' | 'note';

export type FieldRef =
	| { kind: 'property'; name: string }
	| { kind: 'builtin'; id: BuiltinField };

/** The shape of a field, which is what decides the operators it offers (§3). */
export type FieldKind = 'text' | 'number' | 'bool' | 'date' | 'list' | 'link';

export interface FieldCtx {
	config: BoardConfig;
	/** Today, for the one thing that moves on its own: a repetition rule (§2.3). */
	today: CalDate;
}

export type FieldValue =
	| { kind: 'none' }
	| { kind: 'text'; text: string }
	| { kind: 'number'; value: number }
	| { kind: 'bool'; value: boolean }
	/** Every date the value can be read as; empty when none of them parse. */
	| { kind: 'date'; spans: DateSpan[] }
	| { kind: 'list'; values: string[] };

export function sameField(a: FieldRef, b: FieldRef): boolean {
	if (a.kind === 'builtin') return b.kind === 'builtin' && a.id === b.id;
	return b.kind === 'property' && a.name === b.name;
}

/** A field's stable identifier, as the settings block writes it (§5). */
export function fieldId(field: FieldRef): string {
	return field.kind === 'builtin' ? `@${field.id}` : field.name;
}

/**
 * The shape of a field. An undeclared property reads as text — that is what an
 * unrecognized token is, and a filter on it should still be able to say
 * "contains".
 */
export function fieldKind(config: BoardConfig, field: FieldRef): FieldKind {
	if (field.kind === 'builtin') {
		if (field.id === 'tags') return 'list';
		if (field.id === 'done') return 'bool';
		return field.id === 'note' ? 'link' : 'text';
	}
	const def = config.properties.find((p) => p.name === field.name);
	switch (def?.type) {
		case 'string-list':
			return 'list';
		case 'integer':
		case 'percent':
			return 'number';
		case 'checkbox':
			return 'bool';
		case 'datetime':
		case 'date-range':
		case 'recurrence':
		case 'date-list':
			return 'date';
		default:
			return 'text';
	}
}

/** Raw date strings a value contributes, in element order. */
function rawDates(pv: PropertyValue | undefined): string[] {
	if (!pv) return [];
	switch (pv.type) {
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return [pv.raw];
		case 'date-list':
			return pv.raw;
		default:
			return [];
	}
}

/**
 * Every span a date field covers (§2.3). A rule contributes two: its anchor,
 * which is where the series begins, and its next hit from today — between them
 * a repeating card answers both "did it start before X" and "is it due soon".
 */
function spansOf(card: Card, property: string, ctx: FieldCtx): DateSpan[] {
	const out: DateSpan[] = [];
	for (const raw of rawDates(card.properties.find((pv) => pv.name === property))) {
		const span = parseSpan(raw);
		if (span) {
			out.push(span);
			continue;
		}
		const rule = parseRecurrence(raw);
		if (!rule) continue;
		const anchor = rule.start ?? anchorFor(card, property);
		if (!anchor) continue;
		out.push({ start: anchor, end: anchor });
		const next = nextOccurrence(rule, anchor, ctx.today);
		if (next) out.push({ start: next, end: next });
	}
	return out;
}

/** The plain text of a value — what `contains` searches and links are read from. */
function textOf(pv: PropertyValue): string {
	switch (pv.type) {
		case 'color':
		case 'string':
			return pv.value;
		case 'string-list':
			return pv.value.join(', ');
		case 'integer':
		case 'percent':
			return String(pv.value);
		case 'checkbox':
			return pv.value ? 'true' : 'false';
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return pv.raw;
		case 'date-list':
			return pv.raw.join('; ');
		case 'raw':
			return pv.value.join(', ');
	}
}

/** What this card holds for this field; `none` when it holds nothing. */
export function readField(card: Card, field: FieldRef, ctx: FieldCtx): FieldValue {
	if (field.kind === 'builtin') {
		switch (field.id) {
			case 'title': {
				const text = unlinkedTitle(card.title).trim();
				return text ? { kind: 'text', text } : { kind: 'none' };
			}
			case 'tags':
				return card.tags.length ? { kind: 'list', values: card.tags } : { kind: 'none' };
			case 'done':
				return { kind: 'bool', value: isCardDone(card) };
			case 'note': {
				const link = parseCardLink(card.title);
				return link ? { kind: 'text', text: link.linktext } : { kind: 'none' };
			}
		}
	}

	const pv = card.properties.find((value) => value.name === field.name);
	if (!pv) return { kind: 'none' };
	switch (fieldKind(ctx.config, field)) {
		case 'date': {
			const spans = spansOf(card, field.name, ctx);
			return spans.length ? { kind: 'date', spans } : { kind: 'none' };
		}
		case 'number': {
			const value = pv.type === 'integer' || pv.type === 'percent' ? pv.value : Number(textOf(pv));
			return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'none' };
		}
		case 'bool':
			return { kind: 'bool', value: pv.type === 'checkbox' ? pv.value : textOf(pv) !== '' };
		case 'list': {
			const values = pv.type === 'string-list' ? pv.value : pv.type === 'raw' ? pv.value : [textOf(pv)];
			return values.length ? { kind: 'list', values } : { kind: 'none' };
		}
		default: {
			const text = textOf(pv);
			return text ? { kind: 'text', text } : { kind: 'none' };
		}
	}
}

/** Every link a field's value carries — what `linked to` is matched against. */
export function linksOf(value: FieldValue): string[] {
	if (value.kind === 'text') {
		// A `note` field *is* a link target, not a text containing one.
		const inside = linksIn(value.text);
		return inside.length ? inside : [value.text];
	}
	if (value.kind === 'list') return value.values.flatMap((entry) => linksIn(entry));
	return [];
}

/** True when the field holds something — the `is set` operator (§3.3). */
export function isSet(value: FieldValue): boolean {
	switch (value.kind) {
		case 'none':
			return false;
		case 'bool':
			return value.value;
		case 'text':
			return value.text.trim() !== '';
		case 'list':
			return value.values.length > 0;
		case 'date':
			return value.spans.length > 0;
		case 'number':
			return true;
	}
}
