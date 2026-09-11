import { useState } from 'preact/hooks';
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
	/**
	 * Where the editor leaves the "save what is selected" action for its host's
	 * **Done** button, or `null` when there is nothing pending to save. Closing
	 * is a commit for the edits that have no other button of their own — a first
	 * entry in an empty list, and one taken back out of the list to be changed.
	 */
	commitRef?: { current: (() => void) | null };
}

const initialDate = (type: DatePropertyValue['type'], pv: PropertyValue | undefined): CalDate => {
	if (type === 'datetime' && pv?.type === 'datetime') return parseDate(pv.raw) ?? today();
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
		const date = parseDate(pv.raw);
		return date ? { start: stripTime(date) } : null;
	}
	if (type === 'date-range' && pv?.type === 'date-range') {
		const span = parseSpan(pv.raw);
		return span ? { start: stripTime(span.start), end: stripTime(span.end) } : null;
	}
	return null;
};

const initialTime = (pv: PropertyValue | undefined): string => {
	if (pv?.type !== 'datetime') return '';
	const date = parseDate(pv.raw);
	return date ? formatClock(date) : '';
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

export function DateValueEditor({ name, type, def, pv, api, settings, onCommit, commitRef }: Props) {
	const [month, setMonth] = useState(() => initialDate(type, pv));
	const [selection, setSelection] = useState<DateSelection | null>(() => initialSelection(type, pv));
	const [time, setTime] = useState(() => initialTime(pv));
	// The list index an entry was taken out of, while it is being edited on the
	// grid; it goes back where it was, not to the end of the list.
	const [editing, setEditing] = useState<number | null>(null);
	const lang = currentLanguage();
	const firstDay = resolveWeekStart(settings.weekStart, lang);
	const days = monthGrid(month, firstDay);
	const allowRange = type !== 'datetime';
	const list = pv?.type === 'date-list' ? pv.raw : [];
	// date-range never carries a time; date-list carries one only on a single-day entry.
	const timeEnabled =
		(type === 'datetime' || type === 'date-list') && def?.time !== undefined && def.time !== 'none';
	const timeRequired = def?.time === 'required';
	const isSingleDay = !!selection && !selection.end;
	const showTime = timeEnabled && (type !== 'date-list' || isSingleDay);

	const select = (day: CalDate): void => {
		setSelection((current) => {
			const next = selectCalendarDay(current, stripTime(day), allowRange);
			// A range entry never carries a time; drop any time picked before it formed.
			if (next?.end) setTime('');
			return next;
		});
	};

	/** The selection as the text one `date-list` entry would be written with. */
	const pendingEntry = (): string | null => {
		if (!selection) return null;
		if (selection.end) return formatSpan({ start: selection.start, end: selection.end });
		if (timeRequired && !time) return null;
		return formatDate(withTime(selection.start, time));
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
		setEditing(null);
		setSelection(null);
		setTime('');
	};

	const saveSelection = (): void => {
		if (!selection) return;
		if (type === 'datetime') {
			if (timeRequired && !time) return;
			onCommit({ name, type, raw: formatDate(withTime(selection.start, time)) });
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
		setEditing(at);
		setSelection(entry.selection);
		setTime(entry.time);
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
	const canCommitOnClose =
		!!selection &&
		!(showTime && timeRequired && !time) &&
		(type !== 'date-list' || editing !== null || list.length === 0);
	if (commitRef) commitRef.current = canCommitOnClose ? saveSelection : null;

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
				<label class="eb-date-time">
					<span>{t('propertyBadges.time')}</span>
					<input
						type="time"
						value={time}
						required={timeRequired}
						onChange={(event) => setTime(event.currentTarget.value)}
					/>
				</label>
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
					disabled={!selection || (showTime && timeRequired && !time)}
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
