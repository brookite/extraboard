// Renders a single card property value as a badge. Spec: kanban-view.md §3,
// i18n-and-dates.md §2 (the date/time formatting pipeline).

import type { BoardConfig, Card, ProgressStyle, PropertyValue } from '../../model/types';
import { parseDate, parseSpan, today } from '../../model/dates';
import { isRecurrence, nextOccurrence, parseRecurrence, type Recurrence } from '../../model/recurrence';
import { anchorFor } from '../../model/calendar';
import type { ExtraboardSettings } from '../../settings';
import { dateTimeOptsFor, formatCalDate, formatCalSpan, absoluteTooltip, type DateTimeOpts } from '../../i18n/dates';
import { describeRecurrence } from '../../i18n/recurrenceText';
import { t } from '../../i18n';
import { PercentValue } from './Progress';
import { styleFor } from './style';

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
 * The rule's next hit after today, as the badge's tooltip (recurrence.md §5).
 * `undefined` when the rule is unanchored or spent.
 */
function nextOccurrenceTooltip(rule: Recurrence, card: Card, propertyName: string, opts: DateTimeOpts): string | undefined {
	const anchor = rule.start ?? anchorFor(card, propertyName);
	if (!anchor) return undefined;
	const next = nextOccurrence(rule, anchor, today());
	if (!next) return undefined;
	return t('card.nextOccurrence', { date: formatCalDate(next, opts) });
}

/**
 * A `recurrence` value: a localized sentence instead of the stored phrase
 * (recurrence.md §5) — the phrase itself keeps its frozen English grammar
 * (`model/recurrence.ts:formatRecurrence`), only this presentation localizes.
 * An unparseable value still renders verbatim, same tolerance as any other
 * date-family badge.
 */
function RecurrenceBadge({ raw, card, propertyName, opts }: { raw: string; card: Card; propertyName: string; opts: DateTimeOpts }) {
	const rule = parseRecurrence(raw);
	if (!rule) return <span class="eb-badge">{raw}</span>;
	return (
		<span class="eb-badge" title={nextOccurrenceTooltip(rule, card, propertyName, opts)}>
			{describeRecurrence(rule, opts)}
		</span>
	);
}

/** A `datetime` value: the raw text unchanged when it does not parse (§2.3, never garbage). */
function DateBadge({ raw, opts }: { raw: string; opts: DateTimeOpts }) {
	const date = parseDate(raw);
	if (!date) return <span class="eb-badge">{raw}</span>;
	const text = formatCalDate(date, opts);
	return (
		<span class="eb-badge" title={needsTooltip(opts) ? absoluteTooltip(date) : undefined}>
			{text}
		</span>
	);
}

/** A `date-range` value, or one element of a `date-list` (never a collapsed one-day span). */
function SpanBadge({ raw, opts }: { raw: string; opts: DateTimeOpts }) {
	const single = parseDate(raw);
	if (single) return <DateBadge raw={raw} opts={opts} />;
	const span = parseSpan(raw);
	if (!span) {
		// A recurrence phrase (compound `date-list` element, recurrence.md §2.2)
		// keeps its frozen English grammar — only real dates/ranges format here.
		return <span class="eb-badge">{raw}</span>;
	}
	const text = formatCalSpan(span, opts);
	const tooltip = needsTooltip(opts)
		? `${absoluteTooltip(span.start)} → ${absoluteTooltip(span.end)}`
		: undefined;
	return (
		<span class="eb-badge" title={tooltip}>
			{text}
		</span>
	);
}

export function PropertyBadge({ pv, config, progress, settings, card }: Props) {
	const def = config.properties.find((p) => p.name === pv.name);

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
			return <DateBadge raw={pv.raw} opts={dateTimeOptsFor(settings)} />;
		case 'date-range':
			return <SpanBadge raw={pv.raw} opts={dateTimeOptsFor(settings)} />;
		case 'recurrence':
			return <RecurrenceBadge raw={pv.raw} card={card} propertyName={pv.name} opts={dateTimeOptsFor(settings)} />;
		case 'date-list': {
			const opts = dateTimeOptsFor(settings);
			return (
				<>
					{pv.raw.map((r, i) =>
						isRecurrence(r) ? (
							<RecurrenceBadge raw={r} card={card} propertyName={pv.name} opts={opts} key={i} />
						) : (
							<SpanBadge raw={r} opts={opts} key={i} />
						),
					)}
				</>
			);
		}
		case 'raw':
			return <span class="eb-badge eb-badge-muted">{pv.value.join(', ')}</span>;
	}
}
