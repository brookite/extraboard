// The calendar: a month or week grid placing cards by one date property.
// Spec: docs/specs/calendar-view.md §2–§4, §6.
//
// The rule that shapes this file: **a day cell is a read-only summary.** Chips
// render plain text with no Markdown, no badges and no menu — a month of cells
// must stay cheap — and every click in a cell opens the day modal, which is
// where the day's cards are actually edited (§5).

import { moment } from 'obsidian';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import {
	Occurrence,
	clearOccurrence,
	moveOccurrence,
	placeCards,
	setCardDay,
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
import type { Board, Card, PropertyType, ViewDef } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import { openDayModal } from '../ui/DayModal';
import type { BoardApi } from './api';
import { Icon } from './components/Icon';
import { safeColor } from './components/style';
import { DropInfo, isDragging, useSortable } from './useSortable';

/** `data-list` of the "No date" tray — the one container that is not a day. */
const TRAY = -1;

/** Used only when the cell cannot be measured (§3.1). */
const FALLBACK_CAPACITY = { month: 3, week: 8 };

type CalendarDef = Extract<ViewDef, { type: 'calendar' }>;

interface Props {
	board: Board;
	view: CalendarDef;
	api: BoardApi;
	settings: ExtraboardSettings;
}

// --- locale helpers ---------------------------------------------------------
// M11 moves all of this onto the shared formatter (`i18n/dates.ts`); until then
// the calendar reads the locale directly (§2).

function locale(): string | undefined {
	try {
		return moment.locale();
	} catch {
		return undefined;
	}
}

function firstDayOfWeek(): number {
	try {
		return moment.localeData().firstDayOfWeek();
	} catch {
		return 1;
	}
}

const asDate = (d: CalDate): Date => new Date(d.y, d.m - 1, d.d);

function formatTime(minutes: number): string {
	const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
	return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(d);
}

function periodLabel(anchor: CalDate, mode: 'month' | 'week', start: CalDate): string {
	if (mode === 'month') {
		return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(asDate(anchor));
	}
	const end = addDays(start, 6);
	const fmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
	try {
		return fmt.formatRange(asDate(start), asDate(end));
	} catch {
		return `${fmt.format(asDate(start))} – ${fmt.format(asDate(end))}`;
	}
}

function weekdayNames(first: number): string[] {
	const fmt = new Intl.DateTimeFormat(locale(), { weekday: 'short' });
	// 2024-01-07 was a Sunday, so it anchors the names to weekday numbers.
	return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + ((first + i) % 7))));
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

// --- chips ------------------------------------------------------------------

function cardOf(board: Board, occurrenceRef: ops.ItemRef): Card | null {
	const entry = board.stacks[occurrenceRef.stack]?.items[occurrenceRef.item];
	return entry?.kind === 'card' ? entry.card : null;
}

/** Plain, cheap card text: the title with its link flattened and tokens gone. */
function chipText(card: Card): string {
	const text = unlinkedTitle(card.title).trim();
	return text || 'Untitled';
}

function chipColor(board: Board, ref: ops.ItemRef, card: Card): string | undefined {
	const own = card.properties.find((pv) => pv.type === 'color');
	const stack = board.stacks[ref.stack];
	const color =
		safeColor(own?.type === 'color' ? own.value : '') ??
		(stack ? safeColor(ops.groupColor(stack, ref.item)) : null);
	return color ?? undefined;
}

interface ChipProps {
	board: Board;
	card: Card;
	occRef: ops.ItemRef;
	/** `data-index` — the occurrence's index, or the undated card's in the tray. */
	index: number;
	time?: number;
	/** From a repetition rule: one card showing up on many days (recurrence.md §3). */
	repeating?: boolean;
	onOpen: () => void;
}

function Chip({ board, card, occRef, index, time, repeating, onOpen }: ChipProps) {
	const color = chipColor(board, occRef, card);
	const done = ops.isCardDone(card);
	return (
		<div
			class={`eb-cal-chip${done ? ' is-done' : ''}${color ? ' is-colored' : ''}`}
			data-index={index}
			style={color ? `--eb-card-color: ${color}` : undefined}
			title={chipText(card)}
			onClick={(e) => {
				e.stopPropagation();
				if (!isDragging()) onOpen();
			}}
		>
			{done ? <Icon name="check" class="eb-cal-chip-check" /> : null}
			{repeating ? <Icon name="repeat" class="eb-cal-chip-repeat" /> : null}
			{time !== undefined ? <span class="eb-cal-chip-time">{formatTime(time)}</span> : null}
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

	const def = board.config.properties.find((p) => p.name === view.dateProperty);
	const propertyType: PropertyType = def?.type ?? 'datetime';

	// A view whose property is gone renders its reason, not an empty grid (§7).
	if (!def || !['datetime', 'date-range', 'date-list', 'recurrence'].includes(def.type)) {
		return (
			<div class="eb-cal-broken">
				<p>
					This calendar is computed from <strong>{view.dateProperty}</strong>, which the board no
					longer declares as a date property.
				</p>
				<button
					type="button"
					class="mod-cta"
					onClick={() => {
						api.manageViews();
					}}
				>
					Manage views
				</button>
			</div>
		);
	}

	const first = firstDayOfWeek();
	const start = view.mode === 'month' ? startOfWeek(startOfMonth(anchor), first) : startOfWeek(anchor, first);
	const rows = view.mode === 'month' ? 6 : 1;
	const days: CalDate[] = Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
	const now = today();

	// Recurrences are unbounded, so placement is asked for this window only
	// (recurrence.md §3); a rule with no hit here is still a dated card.
	const { occurrences, undated } = placeCards(board, view.dateProperty, {
		from: start,
		to: days[days.length - 1]!,
	});
	const indexOf = new Map(occurrences.map((o, i) => [o, i]));

	const byDay = new Map<string, Occurrence[]>();
	for (const occurrence of occurrences) {
		if (occurrence.length > 1) continue;
		const key = dayKey(occurrence.start);
		const list = byDay.get(key);
		if (list) list.push(occurrence);
		else byDay.set(key, [occurrence]);
	}
	for (const list of byDay.values()) list.sort((a, b) => compareDates(a.start, b.start));

	const openDay = (day: CalDate | null): void => {
		openDayModal(api.app, { api, settings, view, day });
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
			api.update((b) => setCardDay(b, ref, view.dateProperty, propertyType, target));
			return;
		}

		const occurrence = occurrences[drop.fromIndex];
		if (!occurrence) return;
		if (toTray) {
			api.update((b) => clearOccurrence(b, occurrence, view.dateProperty, propertyType));
			return;
		}
		const target = days[drop.toList];
		const rowDay = days[drop.fromList];
		if (!target || !rowDay) return;
		// For a chip this is its own day; for a bar segment, the later of the
		// occurrence's start and the row's first day — i.e. the segment's left edge.
		const source = compareDates(occurrence.start, rowDay) > 0 ? occurrence.start : rowDay;
		api.update((b) =>
			moveOccurrence(b, occurrence, view.dateProperty, propertyType, source, target),
		);
	};

	const step = (delta: number): void => {
		setAnchor(view.mode === 'month' ? addMonths(anchor, delta) : addDays(anchor, delta * 7));
	};

	const setMode = (mode: 'month' | 'week'): void => {
		if (mode === view.mode) return;
		api.update((b) => ops.updateView(b, view.id, { mode }));
	};

	return (
		<div class="eb-cal">
			<div class="eb-cal-head">
				<div class="eb-cal-nav">
					<button type="button" aria-label="Previous" onClick={() => step(-1)}>
						<Icon name="chevron-left" />
					</button>
					<button type="button" onClick={() => setAnchor(today())}>
						Today
					</button>
					<button type="button" aria-label="Next" onClick={() => step(1)}>
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
						Month
					</button>
					<button
						type="button"
						class={view.mode === 'week' ? 'is-active' : ''}
						onClick={() => setMode('week')}
					>
						Week
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

			<div class={`eb-cal-grid is-${view.mode}`} ref={gridRef}>
				{Array.from({ length: rows }, (_, row) => {
					const rowStart = days[row * 7]!;
					const segments = layoutRow(occurrences, indexOf, rowStart);
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
							byDay={byDay}
							indexOf={indexOf}
							segments={segments}
							lanes={lanes}
							capacity={Math.max(1, capacity - lanes)}
							rowStartIndex={row * 7}
							onOpenDay={openDay}
							onDrop={onDrop}
						/>
					);
				})}
			</div>

			<Tray
				board={board}
				undated={undated}
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
	rowStartIndex: number;
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
	rowStartIndex,
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
					return (
						<div
							key={`${String(segment.index)}`}
							class={[
								'eb-cal-bar',
								segment.continuesBefore ? 'is-cut-start' : '',
								segment.continuesAfter ? 'is-cut-end' : '',
								color ? 'is-colored' : '',
							]
								.filter(Boolean)
								.join(' ')}
							data-index={segment.index}
							style={`grid-column: ${String(segment.column + 1)} / span ${String(segment.span)}; grid-row: ${String(segment.lane + 1)};${color ? ` --eb-card-color: ${color};` : ''}`}
							title={chipText(card)}
							onClick={(e) => {
								e.stopPropagation();
								if (!isDragging()) onOpenDay(days[Math.max(0, segment.column)]!);
							}}
						>
							{chipText(card)}
						</div>
					);
				})}
			</div>
			<div class="eb-cal-cells">
				{days.map((day, i) => (
					<DayCell
						key={dayKey(day)}
						board={board}
						day={day}
						index={offset + i}
						dim={showOutside && day.m !== anchorMonth}
						isToday={sameDay(day, now)}
						lanes={lanes}
						capacity={capacity}
						occurrences={byDay.get(dayKey(day)) ?? []}
						indexOf={indexOf}
						onOpen={() => onOpenDay(day)}
						onDrop={onDrop}
					/>
				))}
			</div>
		</div>
	);
}

// --- a day cell -------------------------------------------------------------

interface CellProps {
	board: Board;
	day: CalDate;
	index: number;
	dim: boolean;
	isToday: boolean;
	lanes: number;
	capacity: number;
	occurrences: Occurrence[];
	indexOf: Map<Occurrence, number>;
	onOpen: () => void;
	onDrop: (drop: DropInfo) => void;
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
	onOpen,
	onDrop,
}: CellProps) {
	const listRef = useRef<HTMLDivElement>(null);
	useSortable(listRef, { group: 'eb-cal', sort: false, draggable: '.eb-cal-chip' }, onDrop);

	const shown = occurrences.length > capacity ? occurrences.slice(0, Math.max(0, capacity - 1)) : occurrences;
	const hidden = occurrences.length - shown.length;

	return (
		<div
			class={`eb-cal-cell${dim ? ' is-dim' : ''}${isToday ? ' is-today' : ''}`}
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
							repeating={occurrence.repeating}
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
	open: boolean;
	onToggle: () => void;
	onOpen: () => void;
	onDrop: (drop: DropInfo) => void;
}

function Tray({ board, undated, open, onToggle, onOpen, onDrop }: TrayProps) {
	const listRef = useRef<HTMLDivElement>(null);
	// Always mounted as a drop target, so a date can be cleared even while the
	// tray is collapsed (§4).
	useSortable(listRef, { group: 'eb-cal', sort: false, draggable: '.eb-cal-chip' }, onDrop);
	if (undated.length === 0) return null;

	return (
		<div class={`eb-cal-tray${open ? ' is-open' : ''}`}>
			<button type="button" class="eb-cal-tray-head" onClick={onToggle}>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} />
				<span>No date</span>
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
							onOpen={onOpen}
						/>
					);
				})}
			</div>
		</div>
	);
}
