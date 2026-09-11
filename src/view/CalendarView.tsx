// The calendar: a month or week grid placing cards by one date property.
// Spec: docs/specs/calendar-view.md §2–§4, §6.
//
// The rule that shapes this file: **a day cell is a read-only summary.** Chips
// render plain text with no Markdown, no badges and no menu — a month of cells
// must stay cheap — and every click in a cell opens the day modal, which is
// where the day's cards are actually edited (§5).

import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import {
	Occurrence,
	OccurrenceSource,
	Placement,
	clearOccurrence,
	datePropertyType,
	moveOccurrence,
	placeCards,
	setCardDay,
	sourceValue,
} from '../model/calendar';
import {
	CalDate,
	addDays,
	addMonths,
	compareDates,
	dayKey,
	daysBetween,
	sameDay,
	startOfMonth,
	startOfWeek,
	today,
} from '../model/dates';
import * as ops from '../model/ops';
import { unlinkedTitle } from '../model/link';
import type { Board, Card, ViewDef } from '../model/types';
import { usableDateProperties } from '../model/views';
import type { ExtraboardSettings } from '../settings';
import { pickDateProperty } from '../ui/DatePropertyModal';
import { openDayModal } from '../ui/DayModal';
import type { BoardApi } from './api';
import { Icon } from './components/Icon';
import { safeColor } from './components/style';
import { readableOn } from '../util/color';
import { DropInfo, isDragging, useSortable } from './useSortable';
import { useNow } from './now';
import { currentLanguage, t } from '../i18n';
import { dateTimeFormat } from '../i18n/intl';
import {
	dateTimeOptsFor,
	formatTimePart,
	resolveWeekStart,
	weekdayName,
	type DateTimeOpts,
} from '../i18n/dates';

/** `data-list` of the "No date" tray — the one container that is not a day. */
const TRAY = -1;

/** Used only when the cell cannot be measured (§3.1). */
const FALLBACK_CAPACITY = { month: 3, week: 8 };

/**
 * Below this grid width, in px, a month cell is too narrow for chip text and
 * the compact renderer takes over (mobile.md §6). Keyed to the **container's**
 * width, never to `is-mobile`: the problem is how much fits, so a narrow
 * desktop split has to look the same as a phone. Seven columns under this get
 * roughly 80 px each, which is a few characters of a title — worth less than
 * the marks that replace it.
 */
const COMPACT_GRID_WIDTH = 560;

/**
 * How a timespan is drawn in **week** mode (§3.3): one chip height per half
 * hour, so a two-hour value is visibly twice a one-hour one. An imitation of
 * duration, not a time axis — the week grid has no hour ruler to hang one on,
 * and a cell that is one day tall cannot hold a whole day to scale.
 */
const SPAN_UNIT_MINUTES = 30;
/** Four hours of chip is as much as one cell can give a single card. */
const MAX_SPAN_UNITS = 8;

/**
 * The minutes a timespan covers, or 0 when the occurrence is not one — a single
 * day, whatever time it carries, has no duration to draw (`dates.parseTimespan`).
 */
function durationOf(occurrence: Occurrence): number {
	if (occurrence.length !== 1) return 0;
	const from = occurrence.start.minutes;
	const to = occurrence.end.minutes;
	if (from === undefined || to === undefined || to <= from) return 0;
	return to - from;
}

/** A chip's height in chip units: 1 for anything without a duration. */
function chipUnits(occurrence: Occurrence): number {
	const minutes = durationOf(occurrence);
	if (!minutes) return 1;
	return Math.max(1, Math.min(MAX_SPAN_UNITS, Math.round(minutes / SPAN_UNIT_MINUTES)));
}

type CalendarDef = Extract<ViewDef, { type: 'calendar' }>;

interface Props {
	board: Board;
	view: CalendarDef;
	api: BoardApi;
	settings: ExtraboardSettings;
}

// --- locale helpers ---------------------------------------------------------
// The grid's own navigation chrome (period label, weekday names, week start)
// is always shown in full, absolute form — there is no "relative July 2026" —
// so only its **locale source** moves onto the shared resolver (i18n-and-dates.md
// §2): the plugin's own `language` setting, not whatever Obsidian's app-wide
// locale happens to be, so the two cannot silently disagree. The week start is
// the one piece of that chrome the user can override outright, through the
// `weekStart` setting (§2.6); `auto` keeps the locale's own convention. Chip/tooltip
// *time* values do go through the full `dateFormat`/`timeFormat` pipeline
// below, since those are the same kind of value a property badge shows.

const asDate = (d: CalDate): Date => new Date(d.y, d.m - 1, d.d);

function periodLabel(anchor: CalDate, mode: 'month' | 'week', start: CalDate): string {
	const lang = currentLanguage();
	if (mode === 'month') {
		return dateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(asDate(anchor));
	}
	const end = addDays(start, 6);
	const fmt = dateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' });
	try {
		return fmt.formatRange(asDate(start), asDate(end));
	} catch {
		return `${fmt.format(asDate(start))} – ${fmt.format(asDate(end))}`;
	}
}

function weekdayNames(first: number): string[] {
	const lang = currentLanguage();
	return Array.from({ length: 7 }, (_, i) => weekdayName((first + i) % 7, lang, 'short'));
}

// --- cell budget ------------------------------------------------------------

function readVar(el: HTMLElement, name: string, fallback: number): number {
	const raw = getComputedStyle(el).getPropertyValue(name).trim();
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * How many chips fit in a cell. Measured rather than guessed (§3.1): cell size
 * follows the pane, so a fixed number would either clip or waste space.
 */
function useCellCapacity(ref: RefObject<HTMLElement>, mode: 'month' | 'week'): number {
	const [capacity, setCapacity] = useState(FALLBACK_CAPACITY[mode]);
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root || typeof ResizeObserver === 'undefined') return;
		const measure = (): void => {
			const cell = root.querySelector('.eb-cal-cell');
			if (!(cell instanceof HTMLElement)) return;
			const chip = readVar(root, '--eb-cal-chip-h', 20);
			const head = readVar(root, '--eb-cal-daynum-h', 20);
			const fits = Math.floor((cell.clientHeight - head) / chip);
			setCapacity(Math.max(1, fits));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		return () => observer.disconnect();
	}, [mode]);
	return capacity;
}

/** True while the grid is too narrow for chips (`COMPACT_GRID_WIDTH`). */
function useCompactGrid(ref: RefObject<HTMLElement>): boolean {
	const [compact, setCompact] = useState(false);
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root || typeof ResizeObserver === 'undefined') return;
		const measure = (): void => {
			setCompact(root.clientWidth > 0 && root.clientWidth < COMPACT_GRID_WIDTH);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);
	return compact;
}

/**
 * Every occurrence that touches each day, multi-day ones included. The chip
 * grid keeps spans in the bar overlay above the cells; the compact grid has no
 * overlay, so a span is simply a mark on each day it covers (mobile.md §6).
 */
function marksByDay(occurrences: Occurrence[], days: CalDate[]): Map<string, Occurrence[]> {
	const map = new Map<string, Occurrence[]>();
	for (const day of days) map.set(dayKey(day), []);
	for (const occurrence of occurrences) {
		const span = Math.min(Math.max(occurrence.length, 1), days.length);
		for (let i = 0; i < span; i++) {
			map.get(dayKey(addDays(occurrence.start, i)))?.push(occurrence);
		}
	}
	return map;
}

// --- chips ------------------------------------------------------------------

function cardOf(board: Board, occurrenceRef: ops.ItemRef): Card | null {
	const entry = board.stacks[occurrenceRef.stack]?.items[occurrenceRef.item];
	return entry?.kind === 'card' ? entry.card : null;
}

/** Plain, cheap card text: the title with its link flattened and tokens gone. */
function chipText(card: Card): string {
	const text = unlinkedTitle(card.title).trim();
	return text || t('modal.archive.untitled');
}

/**
 * What paints a chip, most specific first: the card's own `color` property, the
 * color of its divider group (stack-completion-and-divider-colors.md §4.1), and
 * finally its stack's accent (§6.3). The last one is what the calendar adds:
 * the stacks are not drawn here, so without it a card arrives with no trace of
 * where on the board it lives.
 */
function chipColor(board: Board, ref: ops.ItemRef, card: Card): string | undefined {
	const own = card.properties.find((pv) => pv.type === 'color');
	const stack = board.stacks[ref.stack];
	const color =
		safeColor(own?.type === 'color' ? own.value : '') ??
		(stack ? (safeColor(ops.groupColor(stack, ref.item)) ?? safeColor(stack.accent)) : null);
	return color ?? undefined;
}

/**
 * The inline custom properties a coloured chip or bar carries. With the fill
 * setting on (§3.4) the colour becomes the background, so the text has to be
 * picked for it — `util/color.ts:readableOn` is the one place that decides
 * black or white on a colour, shared with the date highlights' badges.
 */
function colorStyle(color: string | undefined, fill: boolean): string | undefined {
	if (!color) return undefined;
	const text = fill ? readableOn(color, document.body) : undefined;
	return `--eb-card-color: ${color}${text === undefined ? '' : `; --eb-card-text: ${text}`}`;
}

/**
 * What a chip says on hover. With one date property that is the card's text and
 * nothing else — the day is already the cell it sits in. With several, the
 * tooltip is the only place that says *which* of them put it there, so it lists
 * them with their values (§3.1).
 */
function chipTooltip(card: Card, sources?: OccurrenceSource[]): string {
	const text = chipText(card);
	if (!sources?.length) return text;
	const lines = sources.map((source) => `${source.property}: ${sourceValue(card, source) ?? ''}`);
	return [text, ...lines].join('\n');
}

interface ChipProps {
	board: Board;
	card: Card;
	occRef: ops.ItemRef;
	/** `data-index` — the occurrence's index, or the undated card's in the tray. */
	index: number;
	time?: number;
	/** The hour a timespan ends at; drawn only where duration is (week mode). */
	endTime?: number;
	/** Chip heights this chip is drawn as; absent or 1 is an ordinary chip. */
	units?: number;
	/** Only needed when `time` is passed. */
	opts?: DateTimeOpts;
	/** From a repetition rule: one card showing up on many days (recurrence.md §3). */
	repeating?: boolean;
	/** Named in the tooltip; passed only when the view reads several properties. */
	sources?: OccurrenceSource[];
	/** Paint the card's colour over the whole chip rather than as a dot (§3.4). */
	fill?: boolean;
	onOpen: () => void;
}

function Chip({
	board,
	card,
	occRef,
	index,
	time,
	endTime,
	units,
	opts,
	repeating,
	sources,
	fill,
	onOpen,
}: ChipProps) {
	const color = chipColor(board, occRef, card);
	const done = ops.isCardDone(card);
	const filled = !!fill && !!color;
	// A duration is drawn only when it is both known and worth a row of its own.
	const span = units !== undefined && units > 1;
	const style = [
		colorStyle(color, filled) ?? '',
		span ? `--eb-cal-chip-units: ${String(units)}` : '',
	]
		.filter(Boolean)
		.join('; ');
	return (
		<div
			class={`eb-cal-chip${done ? ' is-done' : ''}${color ? ' is-colored' : ''}${filled ? ' is-filled' : ''}${span ? ' is-span' : ''}`}
			data-index={index}
			style={style || undefined}
			title={chipTooltip(card, sources)}
			onClick={(e) => {
				e.stopPropagation();
				if (!isDragging()) onOpen();
			}}
		>
			{color && !filled ? <span class="eb-cal-dot" /> : null}
			{done ? <Icon name="check" class="eb-cal-chip-check" /> : null}
			{repeating ? <Icon name="repeat" class="eb-cal-chip-repeat" /> : null}
			{time !== undefined && opts ? (
				<span class="eb-cal-chip-time">
					{endTime !== undefined && endTime > time
						? `${formatTimePart(time, opts)}\u2013${formatTimePart(endTime, opts)}`
						: formatTimePart(time, opts)}
				</span>
			) : null}
			<span class="eb-cal-chip-text">{chipText(card)}</span>
		</div>
	);
}

// --- bars -------------------------------------------------------------------

interface Segment {
	occurrence: Occurrence;
	index: number;
	/** Column within the row, 0–6. */
	column: number;
	span: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

/**
 * Lay a row's multi-day occurrences into lanes (§3.2): greedy in the order the
 * placement already sorted them (earliest start, longest first), reusing a lane
 * as soon as it is free.
 */
function layoutRow(occurrences: Occurrence[], indexOf: Map<Occurrence, number>, rowStart: CalDate): Segment[] {
	const laneEnds: number[] = [];
	const segments: Segment[] = [];
	for (const occurrence of occurrences) {
		if (occurrence.length < 2) continue;
		const from = Math.max(0, daysBetween(occurrence.start, rowStart));
		const to = Math.min(6, daysBetween(occurrence.end, rowStart));
		if (to < 0 || from > 6) continue;
		let lane = laneEnds.findIndex((end) => end < from);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(to);
		} else {
			laneEnds[lane] = to;
		}
		segments.push({
			occurrence,
			index: indexOf.get(occurrence) ?? 0,
			column: from,
			span: to - from + 1,
			lane,
			continuesBefore: daysBetween(occurrence.start, rowStart) < 0,
			continuesAfter: daysBetween(occurrence.end, rowStart) > 6,
		});
	}
	return segments;
}

// --- the view ---------------------------------------------------------------

export function CalendarView({ board, view, api, settings }: Props) {
	// Navigation is view-local and deliberately not persisted (§2).
	const [anchor, setAnchor] = useState<CalDate>(() => today());
	const [trayOpen, setTrayOpen] = useState(false);
	const gridRef = useRef<HTMLDivElement>(null);
	const capacity = useCellCapacity(gridRef, view.mode);
	// Two consequences of one measurement. `narrow` is about the whole view — the
	// head's three groups stop fitting on one line well before the cells do — and
	// `compact` is the cell renderer, which week mode never takes: seven columns
	// with far more vertical room per day is a different problem (mobile.md §6).
	const narrow = useCompactGrid(gridRef);
	const compact = narrow && view.mode === 'month';
	// Only the week grid draws duration: a month cell is a few chips tall, and
	// stretching one there would cost the day its other cards (§3.3).
	const stretch = view.mode === 'week' && !compact;

	// The properties this grid is actually computed from: the view's list minus
	// whatever the board stopped declaring as a date (§7).
	const properties = usableDateProperties(board.config, view);
	const dateTimeOpts = dateTimeOptsFor(settings);
	const usable = properties.length > 0;
	/** Several properties means a placement can be ambiguous; one never is. */
	const multi = properties.length > 1;

	// The drawn window, computed before the broken-view return below so the hooks
	// that depend on it keep their order.
	const first = resolveWeekStart(settings.weekStart);
	const start = view.mode === 'month' ? startOfWeek(startOfMonth(anchor), first) : startOfWeek(anchor, first);
	const rows = view.mode === 'month' ? 6 : 1;
	const days: CalDate[] = Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));

	// Recurrences are unbounded, so placement is asked for this window only
	// (recurrence.md §3); a rule with no hit here is still a dated card.
	//
	// Memoized on the board's identity plus the window (m10-perf.md §4): the
	// board object changes exactly when its content does, so this re-expands
	// every rule only when there is a reason to — not on a minute tick, and not
	// when an unrelated piece of view state changes.
	const { occurrences, undated }: Placement = useMemo(
		() =>
			usable
				? placeCards(board, properties, { from: start, to: days[days.length - 1]! })
				: { occurrences: [], undated: [] },
		[board, view.dateProperties, usable, dayKey(start), days.length],
	);

	// A view whose properties are all gone renders its reason, not an empty grid (§7).
	if (!usable) {
		const [before, after] = t('calendar.brokenMessage').split('{property}');
		return (
			<div class="eb-cal-broken">
				<p>
					{before}
					<strong>{view.dateProperties.join(', ')}</strong>
					{after}
				</p>
				<button
					type="button"
					class="mod-cta"
					onClick={() => {
						api.manageViews();
					}}
				>
					{t('command.manageViews')}
				</button>
			</div>
		);
	}

	// The clock, from the context rather than `today()`, so midnight moves the
	// "today" cell without a full board refresh (m10-perf.md §2.3).
	const now = useNow().date;

	const indexOf = new Map(occurrences.map((o, i) => [o, i]));

	const byDay = new Map<string, Occurrence[]>();
	for (const occurrence of occurrences) {
		if (occurrence.length > 1) continue;
		const key = dayKey(occurrence.start);
		const list = byDay.get(key);
		if (list) list.push(occurrence);
		else byDay.set(key, [occurrence]);
	}
	// By the clock, and the longer of two that start together first — a week
	// cell reads top to bottom as the day runs (§3.3).
	for (const list of byDay.values()) {
		list.sort((a, b) => compareDates(a.start, b.start) || durationOf(b) - durationOf(a));
	}

	const marks = compact ? marksByDay(occurrences, days) : null;

	const openDay = (day: CalDate | null): void => {
		openDayModal(api.app, { api, settings, view, day });
	};

	/**
	 * Which values an edit is about (§6.2). One is decided here; several is a
	 * question only the user can answer, so the drop stops and asks — and a
	 * dismissed question moves nothing.
	 */
	const chooseSources = (
		ref: ops.ItemRef,
		sources: OccurrenceSource[],
		title: string,
		message: string,
	): Promise<OccurrenceSource[] | null> => {
		if (sources.length < 2) return Promise.resolve(sources.length ? sources : null);
		const card = cardOf(board, ref);
		return pickDateProperty(api.app, {
			title,
			message,
			allowAll: true,
			choices: sources.map((source) => ({
				source,
				label: source.property,
				value: sourceValue(card, source),
			})),
		});
	};

	/**
	 * One drop handler for the whole grid (§6). `fromList` says where the drag
	 * started — a day cell, the row of a bar, or the tray — and that is enough to
	 * recover the day the delta is measured from.
	 */
	const onDrop = (drop: DropInfo): void => {
		const fromTray = drop.fromList === TRAY;
		const toTray = drop.toList === TRAY;
		if (fromTray && toTray) return;

		if (fromTray) {
			const ref = undated[drop.fromIndex];
			const target = days[drop.toList];
			if (!ref || !target) return;
			// An undated card has no value to point at, so the choice is over the
			// view's own properties.
			const sources = properties.map((property) => ({ property, index: 0 }));
			void chooseSources(ref, sources, t('dateProperty.setTitle'), t('dateProperty.setMessage')).then(
				(picked) => {
					if (!picked) return;
					api.update((b) =>
						picked.reduce(
							(acc, source) =>
								setCardDay(
									acc,
									ref,
									source.property,
									datePropertyType(acc.config, source.property),
									target,
								),
							b,
						),
					);
				},
			);
			return;
		}

		const occurrence = occurrences[drop.fromIndex];
		if (!occurrence) return;
		if (toTray) {
			void chooseSources(
				occurrence.ref,
				occurrence.sources,
				t('dateProperty.clearTitle'),
				t('dateProperty.moveMessage'),
			).then((picked) => {
				if (!picked) return;
				api.update((b) =>
					picked.reduce(
						(acc, source) =>
							clearOccurrence(acc, occurrence, source, datePropertyType(acc.config, source.property)),
						b,
					),
				);
			});
			return;
		}
		const target = days[drop.toList];
		const rowDay = days[drop.fromList];
		if (!target || !rowDay) return;
		// For a chip this is its own day; for a bar segment, the later of the
		// occurrence's start and the row's first day — i.e. the segment's left edge.
		const from = compareDates(occurrence.start, rowDay) > 0 ? occurrence.start : rowDay;
		void chooseSources(
			occurrence.ref,
			occurrence.sources,
			t('dateProperty.moveTitle'),
			t('dateProperty.moveMessage'),
		).then((picked) => {
			if (!picked) return;
			api.update((b) =>
				picked.reduce(
					(acc, source) =>
						moveOccurrence(
							acc,
							occurrence,
							source,
							datePropertyType(acc.config, source.property),
							from,
							target,
						),
					b,
				),
			);
		});
	};

	const step = (delta: number): void => {
		setAnchor(view.mode === 'month' ? addMonths(anchor, delta) : addDays(anchor, delta * 7));
	};

	const setMode = (mode: 'month' | 'week'): void => {
		if (mode === view.mode) return;
		api.update((b) => ops.updateView(b, view.id, { mode }));
	};

	return (
		<div class={`eb-cal${narrow ? ' is-narrow' : ''}`}>
			<div class="eb-cal-head">
				<div class="eb-cal-nav">
					<button type="button" aria-label={t('calendar.previous')} onClick={() => step(-1)}>
						<Icon name="chevron-left" />
					</button>
					<button type="button" onClick={() => setAnchor(today())}>
						{t('calendar.today')}
					</button>
					<button type="button" aria-label={t('calendar.next')} onClick={() => step(1)}>
						<Icon name="chevron-right" />
					</button>
				</div>
				<div class="eb-cal-title">{periodLabel(anchor, view.mode, start)}</div>
				<div class="eb-cal-modes">
					<button
						type="button"
						class={view.mode === 'month' ? 'is-active' : ''}
						onClick={() => setMode('month')}
					>
						{t('modal.views.mode.month')}
					</button>
					<button
						type="button"
						class={view.mode === 'week' ? 'is-active' : ''}
						onClick={() => setMode('week')}
					>
						{t('modal.views.mode.week')}
					</button>
				</div>
			</div>

			<div class="eb-cal-weekdays">
				{weekdayNames(first).map((name) => (
					<div class="eb-cal-weekday" key={name}>
						{name}
					</div>
				))}
			</div>

			<div class={`eb-cal-grid is-${view.mode}${compact ? ' is-compact' : ''}`} ref={gridRef}>
				{Array.from({ length: rows }, (_, row) => {
					const rowStart = days[row * 7]!;
					// A compact row has no bar overlay, so it needs neither the lane
					// layout nor the chip budget the lanes eat into.
					const segments = compact ? [] : layoutRow(occurrences, indexOf, rowStart);
					const lanes = segments.reduce((max, s) => Math.max(max, s.lane + 1), 0);
					return (
						<WeekRow
							key={dayKey(rowStart)}
							board={board}
							days={days.slice(row * 7, row * 7 + 7)}
							offset={row * 7}
							anchorMonth={anchor.m}
							showOutside={view.mode === 'month'}
							today={now}
							byDay={marks ?? byDay}
							indexOf={indexOf}
							segments={segments}
							lanes={lanes}
							capacity={Math.max(1, capacity - lanes)}
							compact={compact}
							stretch={stretch}
							fill={settings.fillCalendarEvents}
							multi={multi}
							rowStartIndex={row * 7}
							dateTimeOpts={dateTimeOpts}
							onOpenDay={openDay}
							onDrop={onDrop}
						/>
					);
				})}
			</div>

			<Tray
				board={board}
				undated={undated}
				fill={settings.fillCalendarEvents}
				open={trayOpen}
				onToggle={() => setTrayOpen(!trayOpen)}
				onOpen={() => openDay(null)}
				onDrop={onDrop}
			/>
		</div>
	);
}

// --- a week row -------------------------------------------------------------

interface RowProps {
	board: Board;
	days: CalDate[];
	offset: number;
	anchorMonth: number;
	showOutside: boolean;
	today: CalDate;
	byDay: Map<string, Occurrence[]>;
	indexOf: Map<Occurrence, number>;
	segments: Segment[];
	lanes: number;
	capacity: number;
	/** Day number plus colored marks instead of chips and bars (mobile.md §6). */
	compact: boolean;
	/** Draw a timespan chip as tall as it is long (week mode, §3.3). */
	stretch: boolean;
	/** Paint a card's colour over its whole chip or bar, not as a dot (§3.4). */
	fill: boolean;
	/** The view reads several date properties, so tooltips name them (§3.1). */
	multi: boolean;
	rowStartIndex: number;
	dateTimeOpts: DateTimeOpts;
	onOpenDay: (day: CalDate) => void;
	onDrop: (drop: DropInfo) => void;
}

function WeekRow({
	board,
	days,
	offset,
	anchorMonth,
	showOutside,
	today: now,
	byDay,
	indexOf,
	segments,
	lanes,
	capacity,
	compact,
	stretch,
	fill,
	multi,
	rowStartIndex,
	dateTimeOpts,
	onOpenDay,
	onDrop,
}: RowProps) {
	const barsRef = useRef<HTMLDivElement>(null);
	// Bars live in an overlay above the cells, because a span crosses columns and
	// a cell cannot hold it. The overlay is a drag source of its own.
	useSortable(barsRef, { group: { name: 'eb-cal', pull: true, put: false }, sort: false, draggable: '.eb-cal-bar' }, onDrop);

	return (
		<div class="eb-cal-row">
			<div class="eb-cal-bars" ref={barsRef} data-list={rowStartIndex}>
				{segments.map((segment) => {
					const card = cardOf(board, segment.occurrence.ref);
					if (!card) return null;
					const color = chipColor(board, segment.occurrence.ref, card);
					const filled = fill && !!color;
					const paint = colorStyle(color, filled);
					return (
						<div
							key={`${String(segment.index)}`}
							class={[
								'eb-cal-bar',
								segment.continuesBefore ? 'is-cut-start' : '',
								segment.continuesAfter ? 'is-cut-end' : '',
								color ? 'is-colored' : '',
								filled ? 'is-filled' : '',
							]
								.filter(Boolean)
								.join(' ')}
							data-index={segment.index}
							style={`grid-column: ${String(segment.column + 1)} / span ${String(segment.span)}; grid-row: ${String(segment.lane + 1)};${paint === undefined ? '' : ` ${paint};`}`}
							title={chipTooltip(card, multi ? segment.occurrence.sources : undefined)}
							onClick={(e) => {
								e.stopPropagation();
								if (!isDragging()) onOpenDay(days[Math.max(0, segment.column)]!);
							}}
						>
							{color && !filled ? <span class="eb-cal-dot" /> : null}
							<span class="eb-cal-bar-text">{chipText(card)}</span>
						</div>
					);
				})}
			</div>
			<div class="eb-cal-cells">
				{days.map((day, i) => {
					const shared = {
						board,
						day,
						index: offset + i,
						dim: showOutside && day.m !== anchorMonth,
						isToday: sameDay(day, now),
						occurrences: byDay.get(dayKey(day)) ?? [],
						onOpen: () => onOpenDay(day),
						onDrop,
					};
					// Two renderers side by side rather than conditionals inside one
					// cell body, so neither path carries the other's cases.
					return compact ? (
						<CompactDayCell key={dayKey(day)} {...shared} />
					) : (
						<DayCell
							key={dayKey(day)}
							{...shared}
							lanes={lanes}
							capacity={capacity}
							indexOf={indexOf}
							stretch={stretch}
							fill={fill}
							multi={multi}
							dateTimeOpts={dateTimeOpts}
						/>
					);
				})}
			</div>
		</div>
	);
}

// --- a day cell -------------------------------------------------------------

interface BaseCellProps {
	board: Board;
	day: CalDate;
	index: number;
	dim: boolean;
	isToday: boolean;
	occurrences: Occurrence[];
	onOpen: () => void;
	onDrop: (drop: DropInfo) => void;
}

interface CellProps extends BaseCellProps {
	lanes: number;
	capacity: number;
	indexOf: Map<Occurrence, number>;
	/** Draw a timespan as tall as it is long, and budget the cell by height. */
	stretch: boolean;
	/** Paint a card's colour over its whole chip (§3.4). */
	fill: boolean;
	/** Name the properties in chip tooltips (§3.1). */
	multi: boolean;
	dateTimeOpts: DateTimeOpts;
}

function cellClass(dim: boolean, isToday: boolean): string {
	return `eb-cal-cell${dim ? ' is-dim' : ''}${isToday ? ' is-today' : ''}`;
}

/**
 * The narrow-container cell (mobile.md §6): the day number plus one colored
 * mark per card, and a tap that opens the day modal — which carries the board's
 * full editing, so nothing is lost by dropping the chips. No `+N`, because no
 * chip text is drawn for it to truncate.
 *
 * The marks are not drag *sources* — there is nothing legible to grab at this
 * width — but the container keeps its `data-list`, so a card can still be
 * dropped onto a day from the "No date" tray.
 */
function CompactDayCell({ board, day, index, dim, isToday, occurrences, onOpen, onDrop }: BaseCellProps) {
	const listRef = useRef<HTMLDivElement>(null);
	useSortable(listRef, { group: 'eb-cal', sort: false, draggable: '.eb-cal-chip' }, onDrop);

	return (
		<div
			class={cellClass(dim, isToday)}
			onClick={() => {
				if (!isDragging()) onOpen();
			}}
		>
			<div class="eb-cal-daynum">{day.d}</div>
			<div class="eb-cal-marks" ref={listRef} data-list={index}>
				{occurrences.map((occurrence, i) => {
					const card = cardOf(board, occurrence.ref);
					if (!card) return null;
					const color = chipColor(board, occurrence.ref, card);
					return (
						<span
							key={`${String(occurrence.ref.stack)}-${String(occurrence.ref.item)}-${String(i)}`}
							class={`eb-cal-mark${ops.isCardDone(card) ? ' is-done' : ''}${color ? ' is-colored' : ''}`}
							style={color ? `--eb-card-color: ${color}` : undefined}
							title={chipText(card)}
						/>
					);
				})}
			</div>
		</div>
	);
}

/** As many chips as the cell has rows, keeping one row for the `+N` when it clips. */
function fitByCount(occurrences: Occurrence[], capacity: number): Occurrence[] {
	return occurrences.length > capacity ? occurrences.slice(0, Math.max(0, capacity - 1)) : occurrences;
}

/** The same budget, spent in chip units so a tall chip costs what it takes. */
function fitByHeight(occurrences: Occurrence[], capacity: number): Occurrence[] {
	let used = 0;
	const shown: Occurrence[] = [];
	for (const occurrence of occurrences) {
		const units = chipUnits(occurrence);
		// The last row is kept for `+N` whenever anything is left behind.
		const room = shown.length === occurrences.length - 1 ? capacity : capacity - 1;
		if (used + units > room) break;
		used += units;
		shown.push(occurrence);
	}
	return shown;
}

function DayCell({
	board,
	day,
	index,
	dim,
	isToday,
	lanes,
	capacity,
	occurrences,
	indexOf,
	stretch,
	fill,
	multi,
	dateTimeOpts,
	onOpen,
	onDrop,
}: CellProps) {
	const listRef = useRef<HTMLDivElement>(null);
	useSortable(listRef, { group: 'eb-cal', sort: false, draggable: '.eb-cal-chip' }, onDrop);

	// The budget is a height, not a count: a stretched chip spends as many chip
	// rows as it is tall, so what is left over is what still fits (§3.3).
	const shown = stretch ? fitByHeight(occurrences, capacity) : fitByCount(occurrences, capacity);
	const hidden = occurrences.length - shown.length;

	return (
		<div
			class={cellClass(dim, isToday)}
			onClick={() => {
				// A mouse drag ends in a synthetic click; it must not open a day.
				if (!isDragging()) onOpen();
			}}
		>
			<div class="eb-cal-daynum">{day.d}</div>
			{lanes > 0 ? <div class="eb-cal-lane-space" style={`height: calc(${String(lanes)} * var(--eb-cal-bar-h))`} /> : null}
			<div class="eb-cal-chips" ref={listRef} data-list={index}>
				{shown.map((occurrence) => {
					const card = cardOf(board, occurrence.ref);
					if (!card) return null;
					return (
						<Chip
							key={`${dayKey(occurrence.start)}-${String(indexOf.get(occurrence) ?? 0)}`}
							board={board}
							card={card}
							occRef={occurrence.ref}
							index={indexOf.get(occurrence) ?? 0}
							time={occurrence.start.minutes}
							endTime={stretch ? occurrence.end.minutes : undefined}
							units={stretch ? chipUnits(occurrence) : undefined}
							opts={dateTimeOpts}
							repeating={occurrence.repeating}
							sources={multi ? occurrence.sources : undefined}
							fill={fill}
							onOpen={onOpen}
						/>
					);
				})}
			</div>
			{hidden > 0 ? <div class="eb-cal-more">+{hidden}</div> : null}
		</div>
	);
}

// --- the "No date" tray -----------------------------------------------------

interface TrayProps {
	board: Board;
	undated: ops.ItemRef[];
	/** Paint a card's colour over its whole chip (§3.4). */
	fill: boolean;
	open: boolean;
	onToggle: () => void;
	onOpen: () => void;
	onDrop: (drop: DropInfo) => void;
}

function Tray({ board, undated, fill, open, onToggle, onOpen, onDrop }: TrayProps) {
	const listRef = useRef<HTMLDivElement>(null);
	// Always mounted as a drop target, so a date can be cleared even while the
	// tray is collapsed (§4).
	useSortable(listRef, { group: 'eb-cal', sort: false, draggable: '.eb-cal-chip' }, onDrop);
	if (undated.length === 0) return null;

	return (
		<div class={`eb-cal-tray${open ? ' is-open' : ''}`}>
			<button type="button" class="eb-cal-tray-head" onClick={onToggle}>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} />
				<span>{t('modal.day.noDate')}</span>
				<span class="eb-cal-tray-count">{undated.length}</span>
			</button>
			<div class="eb-cal-tray-list" ref={listRef} data-list={TRAY}>
				{undated.map((ref, i) => {
					const card = cardOf(board, ref);
					if (!card) return null;
					return (
						<Chip
							key={`${String(ref.stack)}-${String(ref.item)}`}
							board={board}
							card={card}
							occRef={ref}
							index={i}
							fill={fill}
							onOpen={onOpen}
						/>
					);
				})}
			</div>
		</div>
	);
}
