import { useEffect, useRef, useState } from 'preact/hooks';
import { currentLanguage, t } from '../../i18n';
import { dateTimeFormat } from '../../i18n/intl';
import { resolveWeekStart, weekdayName } from '../../i18n/dates';
import {
	addMonths,
	compareDates,
	dayKey,
	formatClock,
	formatDate,
	formatSpan,
	parseDate,
	parseSpan,
	parseTimespan,
	sameDay,
	stripTime,
	today,
	type CalDate,
} from '../../model/dates';
import {
	inSelection,
	insertDateEntry,
	isSameMonth,
	monthGrid,
	readDateEntry,
	selectCalendarDay,
	type DateSelection,
} from '../../model/dateSelection';
import { isRecurrence } from '../../model/recurrence';
import type { PropertyDef, PropertyValue } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { editRecurrence } from '../../ui/RecurrenceModal';
import type { BoardApi } from '../api';
import { Icon } from './Icon';

type DatePropertyValue = Extract<PropertyValue, { type: 'datetime' | 'date-range' | 'date-list' }>;

interface Props {
	name: string;
	type: DatePropertyValue['type'];
	def: PropertyDef | undefined;
	pv: PropertyValue | undefined;
	api: BoardApi;
	settings: ExtraboardSettings;
	onCommit: (pv: PropertyValue | null) => void;
	/** Where the editor leaves {@link DateEditorHandle} for its host. */
	handleRef?: { current: DateEditorHandle | null };
}

/** What the editor's host can do to it from its own buttons. */
export interface DateEditorHandle {
	/**
	 * Save what is selected, for the host's **Done** button — `null` when there
	 * is nothing pending to save. Closing is a commit for the edits that have no
	 * button of their own: a first entry in an empty list, and one taken back
	 * out of the list to be changed.
	 */
	commit: (() => void) | null;
	/**
	 * Forget the entry taken out of the list for editing, so closing does not
	 * put it back — for the host's **Remove**, which is taking the whole
	 * property away and must not resurrect it.
	 */
	forget: () => void;
}

const initialDate = (type: DatePropertyValue['type'], pv: PropertyValue | undefined): CalDate => {
	// `parseSpan`, not `parseDate`: a `datetime` that carries a timespan is a
	// two-ended value, and it still opens on the day it starts.
	if (type === 'datetime' && pv?.type === 'datetime') return parseSpan(pv.raw)?.start ?? today();
	if (type === 'date-range' && pv?.type === 'date-range') return parseSpan(pv.raw)?.start ?? today();
	if (type === 'date-list' && pv?.type === 'date-list') {
		for (const raw of pv.raw) {
			const span = parseSpan(raw);
			if (span) return span.start;
		}
	}
	return today();
};

const initialSelection = (
	type: DatePropertyValue['type'],
	pv: PropertyValue | undefined,
): DateSelection | null => {
	if (type === 'datetime' && pv?.type === 'datetime') {
		const span = parseSpan(pv.raw);
		return span ? { start: stripTime(span.start) } : null;
	}
	if (type === 'date-range' && pv?.type === 'date-range') {
		const span = parseSpan(pv.raw);
		return span ? { start: stripTime(span.start), end: stripTime(span.end) } : null;
	}
	return null;
};

/** The two clocks a `datetime` opens with: its time, and a timespan's end. */
const initialTimes = (pv: PropertyValue | undefined): { time: string; endTime: string } => {
	if (pv?.type !== 'datetime') return { time: '', endTime: '' };
	const span = parseTimespan(pv.raw);
	if (span) return { time: formatClock(span.start), endTime: formatClock(span.end) };
	const date = parseDate(pv.raw);
	return { time: date ? formatClock(date) : '', endTime: '' };
};

/** Whether `day` falls inside an already-saved date/date-range/date-list entry. */
const isTaken = (day: CalDate, list: string[]): boolean =>
	list.some((raw) => {
		const span = parseSpan(raw);
		return (
			!!span &&
			compareDates(day, stripTime(span.start)) >= 0 &&
			compareDates(day, stripTime(span.end)) <= 0
		);
	});

const withTime = (date: CalDate, value: string): CalDate => {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return date;
	return { ...date, minutes: Number(match[1]) * 60 + Number(match[2]) };
};

export function DateValueEditor({ name, type, def, pv, api, settings, onCommit, handleRef }: Props) {
	const [month, setMonth] = useState(() => initialDate(type, pv));
	const [selection, setSelection] = useState<DateSelection | null>(() => initialSelection(type, pv));
	const [time, setTime] = useState(() => initialTimes(pv).time);
	const [endTime, setEndTime] = useState(() => initialTimes(pv).endTime);
	// The list index an entry was taken out of, while it is being edited on the
	// grid; it goes back where it was, not to the end of the list.
	const [editing, setEditing] = useState<number | null>(null);
	/**
	 * The entry as it stood when it was taken out of the list, kept until
	 * something writes it back. An edit that is never confirmed — the panel
	 * closed, the modal dismissed, focus taken elsewhere — restores it
	 * (2026-08-01-v0.3.1-date-editor.md §2.1): the list is where it lived, and leaving is not an
	 * instruction to delete it.
	 */
	const takenOut = useRef<{ index: number; raw: string } | null>(null);
	const lang = currentLanguage();
	const firstDay = resolveWeekStart(settings.weekStart, lang);
	const days = monthGrid(month, firstDay);
	const allowRange = type !== 'datetime';
	const list = pv?.type === 'date-list' ? pv.raw : [];
	// What the unmount cleanup below has to work from: it runs after the last
	// render, and must not close over the values of the first one.
	const latest = useRef({ list, onCommit });
	latest.current = { list, onCommit };
	useEffect(
		() => () => {
			const taken = takenOut.current;
			if (!taken) return;
			takenOut.current = null;
			const { list: current, onCommit: commit } = latest.current;
			// Not inside the render that is unmounting this editor: the commit
			// re-enters the board's own rendering.
			queueMicrotask(() => {
				commit({
					name,
					type: 'date-list',
					raw: insertDateEntry(current, taken.index, taken.raw),
				});
			});
		},
		[],
	);
	// date-range never carries a time; date-list carries one only on a single-day
	// entry. An absent `time` is **optional**, which is what the property editor
	// has always shown for one (properties.md §time) — only `none` takes the
	// clock away.
	const timeEnabled = (type === 'datetime' || type === 'date-list') && def?.time !== 'none';
	const timeRequired = def?.time === 'required';
	const isSingleDay = !!selection && !selection.end;
	const showTime = timeEnabled && (type !== 'date-list' || isSingleDay);
	// A second clock turns the value into a timespan (`d HH:mm → d HH:mm`).
	// Allowed by default wherever a time is: only an explicit `false` takes it
	// away (properties.md §time).
	const spanEnabled = timeEnabled && def?.timespan !== false;
	// An end alone means nothing, and an end that is not later is not a duration.
	const endValid = !endTime || (!!time && endTime > time);

	const select = (day: CalDate): void => {
		setSelection((current) => {
			const next = selectCalendarDay(current, stripTime(day), allowRange);
			// A range of days never carries a time; drop any picked before it formed.
			if (next?.end) {
				setTime('');
				setEndTime('');
			}
			return next;
		});
	};

	/**
	 * One day as the text it is written with: a bare date, a date with a time,
	 * or — with both clocks set — the timespan the two of them make.
	 */
	const rawForDay = (day: CalDate): string | null => {
		if (timeRequired && !time) return null;
		if (!endValid) return null;
		const start = withTime(day, time);
		if (!spanEnabled || !time || !endTime) return formatDate(start);
		return formatSpan({ start, end: withTime(day, endTime) });
	};

	/** The selection as the text one `date-list` entry would be written with. */
	const pendingEntry = (): string | null => {
		if (!selection) return null;
		if (selection.end) return formatSpan({ start: selection.start, end: selection.end });
		return rawForDay(selection.start);
	};

	/**
	 * The list with the entry currently on the grid put back in its slot. Every
	 * other list action works against this, so moving on to a second entry does
	 * not drop the one being edited.
	 */
	const listWithPending = (): string[] => {
		const at = editing;
		if (at === null) return [...list];
		const raw = pendingEntry();
		return raw === null ? [...list] : insertDateEntry(list, at, raw);
	};

	const clearPending = (): void => {
		// Whatever called this has put the entry back itself.
		takenOut.current = null;
		setEditing(null);
		setSelection(null);
		setTime('');
		setEndTime('');
	};

	const saveSelection = (): void => {
		if (!selection) return;
		if (type === 'datetime') {
			const raw = rawForDay(selection.start);
			if (raw === null) return;
			onCommit({ name, type, raw });
			return;
		}
		if (type === 'date-range') {
			const span = { start: selection.start, end: selection.end ?? selection.start };
			onCommit({ name, type, raw: formatSpan(span) });
			return;
		}
		// date-list: a range entry is written as a plain span; a single day may
		// carry a time. An entry taken back out for editing returns to its slot.
		const raw = pendingEntry();
		if (raw === null) return;
		onCommit({ name, type, raw: insertDateEntry(list, editing ?? list.length, raw) });
		clearPending();
	};

	const removeListItem = (index: number): void => {
		const next = list.filter((_, itemIndex) => itemIndex !== index);
		onCommit(next.length ? { name, type: 'date-list', raw: next } : null);
		// The slot the edited entry returns to moved up by one.
		if (editing !== null && index < editing) setEditing(editing - 1);
		const taken = takenOut.current;
		if (taken && index < taken.index) takenOut.current = { ...taken, index: taken.index - 1 };
	};

	/**
	 * Take one entry back out of the list to change it: a date or a range
	 * returns to the calendar (and to its time input), a repetition returns to
	 * the form it was written in. Either way the entry leaves the list, and is
	 * written back at the same index once it is saved again.
	 */
	const editListItem = (index: number): void => {
		const raw = list[index];
		if (raw === undefined) return;
		const base = listWithPending();
		const restored = base.length > list.length;
		const at = restored && editing !== null && editing <= index ? index + 1 : index;
		if (isRecurrence(raw)) {
			if (restored) {
				onCommit({ name, type: 'date-list', raw: base });
				clearPending();
			}
			void editListRecurrence(base, at, raw);
			return;
		}
		const entry = readDateEntry(raw);
		// Nothing the calendar can show — leave an unreadable entry where it is.
		if (!entry) return;
		const rest = base.filter((_, itemIndex) => itemIndex !== at);
		onCommit(rest.length ? { name, type: 'date-list', raw: rest } : null);
		takenOut.current = { index: at, raw };
		setEditing(at);
		setSelection(entry.selection);
		setTime(entry.time);
		setEndTime(entry.endTime);
		setMonth(entry.month);
	};

	/**
	 * A repetition is edited in the form it was written in, so it leaves the
	 * list only once that form comes back with something: a dismissed form
	 * changes nothing, and a cleared rule drops the entry.
	 */
	const editListRecurrence = async (base: string[], index: number, raw: string): Promise<void> => {
		const next = await editRecurrence(api.app, { name, value: raw });
		if (next === null) return;
		const rest = base.filter((_, itemIndex) => itemIndex !== index);
		const saved = next ? insertDateEntry(rest, index, next) : rest;
		onCommit(saved.length ? { name, type: 'date-list', raw: saved } : null);
	};

	const addRecurrence = async (): Promise<void> => {
		const base = listWithPending();
		if (base.length > list.length) {
			onCommit({ name, type: 'date-list', raw: base });
			clearPending();
		}
		const raw = await editRecurrence(api.app, { name, value: '' });
		if (!raw) return;
		onCommit({ name, type: 'date-list', raw: [...base, raw] });
	};

	// Whether **Done** should save the pending selection on its way out. A list
	// that already holds entries keeps its explicit Add — there the selection is
	// a new entry the user has not asked for yet; an empty list and an entry
	// taken back out for editing have no other way to be written.
	const commitOnClose =
		!!selection &&
		!(showTime && timeRequired && !time) &&
		endValid &&
		(type !== 'date-list' || editing !== null || list.length === 0);
	if (handleRef) {
		handleRef.current = {
			commit: commitOnClose ? saveSelection : null,
			forget: () => {
				takenOut.current = null;
			},
		};
	}

	const monthTitle = dateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(
		new Date(month.y, month.m - 1, 1),
	);

	return (
		<div class="eb-date-editor">
			{type === 'date-list' && list.length ? (
				<div class="eb-date-values">
					{list.map((raw, index) => (
						<div class="eb-date-value" key={`${String(index)}-${raw}`}>
							<button
								type="button"
								class="eb-date-value-text"
								aria-label={t('propertyBadges.editDate', { value: raw })}
								onClick={() => editListItem(index)}
							>
								{raw}
							</button>
							<button
								type="button"
								class="eb-icon-button"
								aria-label={t('propertyBadges.removeDate', { value: raw })}
								onClick={() => removeListItem(index)}
							>
								<Icon name="x" />
							</button>
						</div>
					))}
				</div>
			) : null}

			<div class="eb-date-nav">
				<button
					type="button"
					class="eb-icon-button"
					aria-label={t('propertyBadges.previousMonth')}
					onClick={() => setMonth(addMonths(month, -1))}
				>
					<Icon name="chevron-left" />
				</button>
				<span>{monthTitle}</span>
				<button
					type="button"
					class="eb-icon-button"
					aria-label={t('propertyBadges.nextMonth')}
					onClick={() => setMonth(addMonths(month, 1))}
				>
					<Icon name="chevron-right" />
				</button>
			</div>
			<div class="eb-date-weekdays" aria-hidden="true">
				{Array.from({ length: 7 }, (_, index) =>
					weekdayName((firstDay + index) % 7, lang, 'short'),
				).map((label, index) => (
					<span key={index}>{label}</span>
				))}
			</div>
			<div class="eb-date-grid">
				{days.map((day) => {
					const key = dayKey(day);
					const selected = inSelection(day, selection);
					const endpoint =
						selection &&
						(key === dayKey(selection.start) ||
							(selection.end && key === dayKey(selection.end)));
					const taken = !selected && type === 'date-list' && isTaken(day, list);
					return (
						<button
							type="button"
							key={key}
							class={`eb-date-day${isSameMonth(day, month) ? '' : ' is-outside'}${selected ? ' is-selected' : ''}${endpoint ? ' is-endpoint' : ''}${taken ? ' is-taken' : ''}${sameDay(day, today()) ? ' is-today' : ''}`}
							aria-label={key}
							aria-pressed={selected}
							onClick={() => select(day)}
						>
							{day.d}
						</button>
					);
				})}
			</div>

			{showTime ? (
				<div class="eb-date-times">
					<label class="eb-date-time">
						<span>{spanEnabled ? t('propertyBadges.timeFrom') : t('propertyBadges.time')}</span>
						<input
							type="time"
							value={time}
							required={timeRequired}
							onChange={(event) => {
								setTime(event.currentTarget.value);
								// An end without a start is not a value; drop it with it.
								if (!event.currentTarget.value) setEndTime('');
							}}
						/>
					</label>
					{spanEnabled ? (
						<label class={`eb-date-time${endValid ? '' : ' is-invalid'}`}>
							<span>{t('propertyBadges.timeTo')}</span>
							<input
								type="time"
								value={endTime}
								disabled={!time}
								aria-invalid={endValid ? undefined : 'true'}
								onChange={(event) => setEndTime(event.currentTarget.value)}
							/>
							<button
								type="button"
								class="eb-icon-button"
								aria-label={t('propertyBadges.clearEndTime')}
								disabled={!endTime}
								onClick={() => setEndTime('')}
							>
								<Icon name="x" />
							</button>
						</label>
					) : null}
				</div>
			) : null}

			<div class={`eb-date-actions${type === 'date-list' ? ' is-list' : ''}`}>
				{type === 'date-list' ? (
					<button type="button" onClick={() => void addRecurrence()}>
						{t('propertyBadges.addRepetition')}
					</button>
				) : null}
				<button
					type="button"
					class="mod-cta"
					disabled={!selection || (showTime && timeRequired && !time) || !endValid}
					onClick={saveSelection}
				>
					{type !== 'date-list'
						? t('propertyBadges.setDate')
						: editing !== null
							? t('propertyBadges.saveDate')
							: t('propertyBadges.addDate')}
				</button>
			</div>
		</div>
	);
}
