// Card property value parsing, formatting, and validation.
// Spec: docs/specs/properties.md. Pure; no `obsidian` imports.

import { parseSpan, toOrdinal } from './dates';
import { parseRecurrence } from './recurrence';
import type { PropertyDef, PropertyValue } from './types';

const ESCAPABLE = new Set(['\\', ';', '|', '}']);

/** Escape a value for embedding inside `@{name|...}`. */
export function escapeValue(s: string): string {
	let out = '';
	for (const ch of s) {
		if (ESCAPABLE.has(ch)) out += '\\';
		out += ch;
	}
	return out;
}

/** Reverse of {@link escapeValue}. */
export function unescapeValue(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
			out += s[++i];
		} else {
			out += ch;
		}
	}
	return out;
}

/** Split a raw (still-escaped) value on unescaped `;`. */
function splitEscaped(raw: string): string[] {
	const parts: string[] = [];
	let cur = '';
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === '\\' && i + 1 < raw.length) {
			cur += ch + raw[++i];
		} else if (ch === ';') {
			parts.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	parts.push(cur);
	return parts;
}

function parseList(raw: string): string[] {
	return splitEscaped(raw)
		.map((p) => unescapeValue(p).trim())
		.filter((p) => p.length > 0);
}

const INT_RE = /^-?\d+$/;

/**
 * Parse a token's raw value into a typed {@link PropertyValue}, or `null` if
 * the value is absent/invalid for its declared type (the token is then dropped).
 */
export function parseValue(
	name: string,
	rawValue: string,
	def: PropertyDef | undefined,
): PropertyValue | null {
	const type = def?.type ?? 'raw';

	// "empty value => absent" for everything except free `string`.
	if (type !== 'string' && rawValue.trim() === '') return null;

	switch (type) {
		case 'color': {
			const value = unescapeValue(rawValue).trim();
			return value ? { name, type, value } : null;
		}
		case 'string':
			return { name, type, value: unescapeValue(rawValue) };
		case 'string-list': {
			let value = parseList(rawValue);
			if (def?.strict && def.options) {
				const allowed = new Set(def.options.map((o) => o.value));
				value = value.filter((v) => allowed.has(v));
			}
			return value.length ? { name, type, value } : null;
		}
		case 'integer': {
			const t = unescapeValue(rawValue).trim();
			if (!INT_RE.test(t)) return null;
			return { name, type, value: parseInt(t, 10) };
		}
		case 'percent': {
			const t = unescapeValue(rawValue).trim();
			if (!INT_RE.test(t)) return null;
			const n = Math.max(0, Math.min(100, parseInt(t, 10)));
			return { name, type, value: n };
		}
		case 'checkbox': {
			const t = unescapeValue(rawValue).trim().toLowerCase();
			return { name, type, value: ['true', 'yes', 'x', '1'].includes(t) };
		}
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return { name, type, raw: unescapeValue(rawValue) };
		case 'date-list':
			return { name, type, raw: parseList(rawValue) };
		case 'raw':
		default:
			return { name, type: 'raw', value: parseList(rawValue) };
	}
}

/** Format a {@link PropertyValue} back into the raw text for `@{name|raw}`. */
export function formatValue(pv: PropertyValue): string {
	switch (pv.type) {
		case 'color':
		case 'string':
			return escapeValue(pv.value);
		case 'string-list':
			return pv.value.map(escapeValue).join('; ');
		case 'integer':
		case 'percent':
			return String(pv.value);
		case 'checkbox':
			return pv.value ? 'true' : 'false';
		case 'datetime':
		case 'date-range':
		case 'recurrence':
			return escapeValue(pv.raw);
		case 'date-list':
			return pv.raw.map(escapeValue).join('; ');
		case 'raw':
			return pv.value.map(escapeValue).join('; ');
	}
}

/**
 * Ascending sort key for one `date-list` element (recurrence.md §2.2: a
 * date, a range, or a recurrence phrase), or `null` when it is none of
 * those. A recurrence with no explicit `from` has no fixed position, so it
 * sorts after every element that does.
 */
function dateListKey(raw: string): number | null {
	const span = parseSpan(raw);
	if (span) return toOrdinal(span.start);
	const rule = parseRecurrence(raw);
	if (!rule) return null;
	return rule.start ? toOrdinal(rule.start) : Number.POSITIVE_INFINITY;
}

/**
 * Drop `date-list` elements that are neither a date/range nor a recurrence
 * phrase, then sort what remains ascending by its earliest date. Applied
 * whenever a `date-list` value is set (`ops.setCardProperty`), not on every
 * parse, so a file the user has not touched is not silently reordered.
 */
export function normalizeDateList(raw: string[]): string[] {
	return raw
		.map((value) => ({ value, key: dateListKey(value) }))
		.filter((e): e is { value: string; key: number } => e.key !== null)
		.sort((a, b) => a.key - b.key)
		.map((e) => e.value);
}

/** Render a full property token, e.g. `@{status|Doing}`. */
export function formatToken(pv: PropertyValue): string {
	return `@{${pv.name}|${formatValue(pv)}}`;
}

/**
 * A validation diagnostic, structured rather than pre-rendered text — the
 * model stays free of UI strings, and a caller looks each `kind` up through
 * `t()` (i18n-and-dates.md §1.2).
 */
export type PropertyDiagnostic =
	| { kind: 'noName' }
	| { kind: 'duplicateName'; name: string }
	| { kind: 'strictOptionsWrongType'; name: string }
	| { kind: 'timeWrongType'; name: string }
	| { kind: 'timespanNeedsTime'; name: string }
	| { kind: 'tooManyColors' };

/**
 * Non-fatal validation of board property definitions. Returns structured
 * diagnostics; never throws.
 *
 * `color` is limited to one per board because it paints the card. `checkbox`
 * is not: the card's own checkbox is a native task marker (markdown-format.md
 * §4.0), so a `checkbox` property is just a named boolean badge (M5).
 */
export function validatePropertyDefs(defs: PropertyDef[]): PropertyDiagnostic[] {
	const diags: PropertyDiagnostic[] = [];
	const seen = new Set<string>();
	let colors = 0;
	for (const d of defs) {
		if (!d.name.trim()) diags.push({ kind: 'noName' });
		else if (seen.has(d.name)) diags.push({ kind: 'duplicateName', name: d.name });
		seen.add(d.name);
		if (d.type === 'color') colors++;
		if ((d.strict !== undefined || d.options !== undefined) && d.type !== 'string-list') {
			diags.push({ kind: 'strictOptionsWrongType', name: d.name });
		}
		if (d.time !== undefined && d.type !== 'datetime' && d.type !== 'date-list') {
			diags.push({ kind: 'timeWrongType', name: d.name });
		}
		// A range of times inside a value that carries none is nothing at all.
		if (d.timespan !== undefined && (d.time === undefined || d.time === 'none')) {
			diags.push({ kind: 'timespanNeedsTime', name: d.name });
		}
	}
	if (colors > 1) diags.push({ kind: 'tooManyColors' });
	return diags;
}
