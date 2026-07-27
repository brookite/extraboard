// Date highlight rules: an ordered list that colors a date badge as its date
// approaches or after it has passed. Spec: docs/specs/i18n-and-dates.md §3.
// Pure; no `obsidian` imports and no UI strings (diagnostics are structured).

import { addMonths, toOrdinal, type CalDate, type DateSpan } from './dates';
import type { BoardConfig, PropertyType } from './types';

export type HighlightWhen = 'before' | 'after';

export type HighlightUnit = 'hour' | 'day' | 'week' | 'month';

export interface DateHighlightRule {
	/** Absent => the rule applies to every date-family property. */
	property?: string;
	when: HighlightWhen;
	/** Integer >= 0, no upper bound. */
	amount: number;
	unit: HighlightUnit;
	/** CSS color, stored verbatim like every other color in the plugin. */
	color: string;
}

/** The property types a rule can match; the rest are never highlighted. */
export const DATE_FAMILY: readonly PropertyType[] = [
	'datetime',
	'date-range',
	'date-list',
	'recurrence',
];

export function isDateFamily(type: PropertyType): boolean {
	return DATE_FAMILY.includes(type);
}

/** "Now" as the matcher sees it: a calendar day plus minutes since its midnight. */
export interface Now {
	date: CalDate;
	minutes: number;
}

export function nowStamp(clock: Date = new Date()): Now {
	return {
		date: { y: clock.getFullYear(), m: clock.getMonth() + 1, d: clock.getDate() },
		minutes: clock.getHours() * 60 + clock.getMinutes(),
	};
}

/**
 * Minutes since the epoch day's midnight, the scale both sides of every
 * comparison use.
 *
 * A date that carries **no time counts as the end of its day** (23:59): a card
 * due today then stays *approaching* for the whole day — which is the case the
 * feature exists for — and only turns *overdue* tomorrow. The same reading
 * applies to both ends of a range.
 */
function instantOf(date: CalDate): number {
	return toOrdinal(date) * 1440 + (date.minutes ?? 1439);
}

function instantOfNow(now: Now): number {
	return toOrdinal(now.date) * 1440 + now.minutes;
}

/**
 * The rule's window in minutes. `month` is a **calendar** month measured from
 * now (`addMonths`), not a fixed 30 days, so a threshold tracks real month
 * lengths.
 */
function thresholdMinutes(rule: DateHighlightRule, now: Now): number {
	switch (rule.unit) {
		case 'hour':
			return rule.amount * 60;
		case 'day':
			return rule.amount * 1440;
		case 'week':
			return rule.amount * 10080;
		case 'month':
			return (toOrdinal(addMonths(now.date, rule.amount)) - toOrdinal(now.date)) * 1440;
	}
}

/** A rule the editor would flag is never painted (§3.3: flagged, not silently applied). */
function isUsable(rule: DateHighlightRule): boolean {
	return rule.color.trim() !== '' && Number.isInteger(rule.amount) && rule.amount >= 0;
}

function matches(rule: DateHighlightRule, span: DateSpan, now: Now): boolean {
	const current = instantOfNow(now);
	const threshold = thresholdMinutes(rule, now);
	if (rule.when === 'before') {
		// Time left until the span begins; a past date is `after`'s business.
		const remaining = instantOf(span.start) - current;
		return remaining > 0 && remaining <= threshold;
	}
	const elapsed = current - instantOf(span.end);
	return elapsed > 0 && elapsed >= threshold;
}

/**
 * The first rule matching this value, or `undefined`. **First match in list
 * order wins** (§3.1) — the order is the user's own escalation, so it is never
 * re-sorted here.
 *
 * `span` is the value the caller already parsed: a single date collapses to a
 * one-day span, and a `recurrence` passes its next occurrence. `null` (nothing
 * parseable, or a spent recurrence) matches nothing — there is nothing to be
 * early or late for.
 */
export function matchHighlight(
	rules: readonly DateHighlightRule[],
	property: string,
	span: DateSpan | null,
	now: Now = nowStamp(),
): DateHighlightRule | undefined {
	if (!span) return undefined;
	for (const rule of rules) {
		if (rule.property !== undefined && rule.property !== property) continue;
		if (!isUsable(rule)) continue;
		if (matches(rule, span, now)) return rule;
	}
	return undefined;
}

/**
 * The rules in force for a board: its own list when it has one, the plugin's
 * otherwise. A board list, **even an empty one**, replaces the global list
 * rather than merging with it (§3.2) — merging two ordered lists has no obvious
 * combined order.
 */
export function highlightsFor(
	config: BoardConfig,
	global: readonly DateHighlightRule[],
): readonly DateHighlightRule[] {
	return config.dateHighlights ?? global;
}

/** Deep copy, so an editor never mutates the caller's rules in place. */
export function cloneRules(rules: readonly DateHighlightRule[]): DateHighlightRule[] {
	return rules.map((r) => ({ ...r }));
}

/**
 * A validation diagnostic, structured rather than pre-rendered text — the same
 * posture `validatePropertyDefs` takes. `index` is the row it belongs to.
 */
export type DateHighlightDiagnostic =
	| { kind: 'noColor'; index: number }
	| { kind: 'badAmount'; index: number }
	| { kind: 'unknownProperty'; index: number; name: string };

/**
 * Non-fatal validation; never throws, never drops a rule. `knownProperties` is
 * the board's declared date-family names — omitted by the plugin-wide list,
 * which cannot know which board a rule will meet.
 */
export function validateDateHighlights(
	rules: readonly DateHighlightRule[],
	knownProperties?: readonly string[],
): DateHighlightDiagnostic[] {
	const diags: DateHighlightDiagnostic[] = [];
	rules.forEach((rule, index) => {
		if (rule.color.trim() === '') diags.push({ kind: 'noColor', index });
		if (!Number.isInteger(rule.amount) || rule.amount < 0) {
			diags.push({ kind: 'badAmount', index });
		}
		if (
			rule.property !== undefined &&
			knownProperties !== undefined &&
			!knownProperties.includes(rule.property)
		) {
			diags.push({ kind: 'unknownProperty', index, name: rule.property });
		}
	});
	return diags;
}
