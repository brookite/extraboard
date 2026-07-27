// Renders a single card property value as a badge. Spec: kanban-view.md §3,
// i18n-and-dates.md §2 (the date/time formatting pipeline).

import type { BoardConfig, Card, ProgressStyle, PropertyValue } from '../../model/types';
import { parseDate, parseSpan, type CalDate, type DateSpan } from '../../model/dates';
import { isRecurrence, nextOccurrence, parseRecurrence, type Recurrence } from '../../model/recurrence';
import { anchorFor } from '../../model/calendar';
import { highlightsFor, matchHighlight, type DateHighlightRule, type Now } from '../../model/dateHighlights';
import type { ExtraboardSettings } from '../../settings';
import { dateTimeOptsFor, formatCalDate, formatCalSpan, absoluteTooltip, type DateTimeOpts } from '../../i18n/dates';
import { describeRecurrence } from '../../i18n/recurrenceText';
import { t } from '../../i18n';
import { readableOn } from '../../util/color';
import { Icon } from './Icon';
import { PercentValue } from './Progress';
import { safeColor, styleFor } from './style';
import { useNow } from '../now';

interface Props {
	pv: PropertyValue;
	config: BoardConfig;
	/** Shape of `percent` values on this board (kanban-view.md §5.5). */
	progress: ProgressStyle;
	settings: ExtraboardSettings;
	/** The card this value belongs to — a `recurrence` badge needs its siblings
	 * to resolve an anchor-less rule's start (recurrence.md §1.2). */
	card: Card;
}

/** What every date-family badge needs: the format settings, the rules in force,
 * and the instant they are measured against. `now` comes from the context rather
 * than the clock so a memoized card still updates on the minute tick — and only
 * then (m10-perf.md §2.3). */
interface DateOpts {
	opts: DateTimeOpts;
	highlights: readonly DateHighlightRule[];
	/** Property name the rules are matched against. */
	property: string;
	now: Now;
}

/** A single date reads as a one-day span, so one matcher serves every shape. */
function spanOf(date: CalDate | null): DateSpan | null {
	return date ? { start: date, end: date } : null;
}

/**
 * The chip color of the first matching rule (§3.4): its color becomes the
 * background, the text color is derived from it. Layered on top of §2 — the
 * highlight decides the color, the format setting decides the text.
 */
function highlightStyle(o: DateOpts, span: DateSpan | null): Record<string, string> | undefined {
	if (o.highlights.length === 0) return undefined;
	const rule = matchHighlight(o.highlights, o.property, span, o.now);
	const bg = rule && safeColor(rule.color);
	if (!bg) return undefined;
	return styleFor(bg, readableOn(bg, document.body));
}

/** Whenever a mode can hide precision, the absolute value stays one hover away. */
function needsTooltip(opts: DateTimeOpts): boolean {
	return (
		opts.dateFormat === 'relative' ||
		opts.dateFormat === 'custom' ||
		opts.timeFormat === 'relative' ||
		opts.timeFormat === 'custom'
	);
}

/**
 * The rule's next hit after today (recurrence.md §5): both the badge's tooltip
 * and the date a highlight rule measures against. `null` when the rule is
 * unanchored or spent — then there is nothing to be early or late for (§3).
 */
function nextHit(rule: Recurrence, card: Card, propertyName: string, from: CalDate): CalDate | null {
	const anchor = rule.start ?? anchorFor(card, propertyName);
	if (!anchor) return null;
	return nextOccurrence(rule, anchor, from);
}

/**
 * A `recurrence` value: a localized sentence instead of the stored phrase
 * (recurrence.md §5) — the phrase itself keeps its frozen English grammar
 * (`model/recurrence.ts:formatRecurrence`), only this presentation localizes.
 * An unparseable value still renders verbatim, same tolerance as any other
 * date-family badge.
 */
function RecurrenceBadge({ raw, card, dates }: { raw: string; card: Card; dates: DateOpts }) {
	const rule = parseRecurrence(raw);
	if (!rule) return <span class="eb-badge">{raw}</span>;
	const next = nextHit(rule, card, dates.property, dates.now.date);
	// The chip carries the compact form; the tooltip carries everything the
	// compaction left out — the dates and the next hit (recurrence.md §5).
	const full = describeRecurrence(rule, dates.opts);
	const tooltip = next
		? `${full}\n${t('card.nextOccurrence', { date: formatCalDate(next, dates.opts) })}`
		: full;
	return (
		<span
			class="eb-badge eb-badge-recurrence"
			style={highlightStyle(dates, spanOf(next))}
			title={tooltip}
		>
			<Icon name="repeat" class="eb-badge-icon" />
			<span class="eb-badge-text">{describeRecurrence(rule, dates.opts, { compact: true })}</span>
		</span>
	);
}

/** A `datetime` value: the raw text unchanged when it does not parse (§2.3, never garbage). */
function DateBadge({ raw, dates }: { raw: string; dates: DateOpts }) {
	const date = parseDate(raw);
	if (!date) return <span class="eb-badge">{raw}</span>;
	const text = formatCalDate(date, dates.opts);
	return (
		<span
			class="eb-badge"
			style={highlightStyle(dates, spanOf(date))}
			title={needsTooltip(dates.opts) ? absoluteTooltip(date) : undefined}
		>
			{text}
		</span>
	);
}

/** A `date-range` value, or one element of a `date-list` (never a collapsed one-day span). */
function SpanBadge({ raw, dates }: { raw: string; dates: DateOpts }) {
	const single = parseDate(raw);
	if (single) return <DateBadge raw={raw} dates={dates} />;
	const span = parseSpan(raw);
	if (!span) {
		// A recurrence phrase (compound `date-list` element, recurrence.md §2.2)
		// keeps its frozen English grammar — only real dates/ranges format here.
		return <span class="eb-badge">{raw}</span>;
	}
	const text = formatCalSpan(span, dates.opts);
	const tooltip = needsTooltip(dates.opts)
		? `${absoluteTooltip(span.start)} → ${absoluteTooltip(span.end)}`
		: undefined;
	return (
		<span class="eb-badge" style={highlightStyle(dates, span)} title={tooltip}>
			{text}
		</span>
	);
}

export function PropertyBadge({ pv, config, progress, settings, card }: Props) {
	// Subscribing to the clock here is what keeps relative labels and highlights
	// live under the card's `memo`: a context change re-renders exactly the badges
	// that read it, and nothing else on the board (m10-perf.md §2.3).
	const now = useNow();
	const def = config.properties.find((p) => p.name === pv.name);
	// Built only for the date family, and only once per badge: the board's own
	// rule list replaces the plugin's rather than merging with it (§3.2).
	const dateOpts = (): DateOpts => ({
		opts: dateTimeOptsFor(settings),
		highlights: highlightsFor(config, settings.dateHighlights),
		property: pv.name,
		now,
	});

	switch (pv.type) {
		case 'string-list': {
			const options = def?.options ?? [];
			return (
				<>
					{pv.value.map((v) => {
						const opt = options.find((o) => o.value === v);
						return (
							<span class="eb-badge" style={styleFor(opt?.bg, opt?.fg)} key={v}>
								{v}
							</span>
						);
					})}
				</>
			);
		}
		case 'string':
			return <span class="eb-badge">{pv.value}</span>;
		case 'integer':
			return (
				<span class="eb-badge eb-badge-num">
					{pv.name}: {pv.value}
				</span>
			);
		case 'percent':
			return <PercentValue value={pv.value} style={progress} />;
		case 'color':
			// Not a badge: the board's single color property paints the card (§5.2).
			return null;
		case 'checkbox':
			return (
				<span class="eb-badge">
					{pv.value ? '☑' : '☐'} {pv.name}
				</span>
			);
		case 'datetime':
			return <DateBadge raw={pv.raw} dates={dateOpts()} />;
		case 'date-range':
			return <SpanBadge raw={pv.raw} dates={dateOpts()} />;
		case 'recurrence':
			return <RecurrenceBadge raw={pv.raw} card={card} dates={dateOpts()} />;
		case 'date-list': {
			// Every element is matched on its own, so a list can carry one
			// approaching date and one long past.
			const dates = dateOpts();
			return (
				<>
					{pv.raw.map((r, i) =>
						isRecurrence(r) ? (
							<RecurrenceBadge raw={r} card={card} dates={dates} key={i} />
						) : (
							<SpanBadge raw={r} dates={dates} key={i} />
						),
					)}
				</>
			);
		}
		case 'raw':
			return <span class="eb-badge eb-badge-muted">{pv.value.join(', ')}</span>;
	}
}
