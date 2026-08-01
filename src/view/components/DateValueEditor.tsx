import { useState } from 'preact/hooks';
import { currentLanguage, t } from '../../i18n';
import { dateTimeFormat } from '../../i18n/intl';
import { resolveWeekStart, weekdayName } from '../../i18n/dates';
import {
	addMonths,
	dayKey,
	formatDate,
	formatSpan,
	parseDate,
	parseSpan,
	stripTime,
	today,
	type CalDate,
} from '../../model/dates';
import {
	inSelection,
	isSameMonth,
	monthGrid,
	selectCalendarDay,
	type DateSelection,
} from '../../model/dateSelection';
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
	if (date?.minutes === undefined) return '';
	const hours = String(Math.floor(date.minutes / 60)).padStart(2, '0');
	const minutes = String(date.minutes % 60).padStart(2, '0');
	return `${hours}:${minutes}`;
};

const withTime = (date: CalDate, value: string): CalDate => {
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return date;
	return { ...date, minutes: Number(match[1]) * 60 + Number(match[2]) };
};

export function DateValueEditor({ name, type, def, pv, api, settings, onCommit }: Props) {
	const [month, setMonth] = useState(() => initialDate(type, pv));
	const [selection, setSelection] = useState<DateSelection | null>(() => initialSelection(type, pv));
	const [time, setTime] = useState(() => initialTime(pv));
	const lang = currentLanguage();
	const firstDay = resolveWeekStart(settings.weekStart, lang);
	const days = monthGrid(month, firstDay);
	const allowRange = type !== 'datetime';
	const list = pv?.type === 'date-list' ? pv.raw : [];
	const timeEnabled = type === 'datetime' && def?.time !== undefined && def.time !== 'none';
	const timeRequired = def?.time === 'required';

	const select = (day: CalDate): void => {
		setSelection((current) => selectCalendarDay(current, stripTime(day), allowRange));
	};

	const saveSelection = (): void => {
		if (!selection) return;
		if (type === 'datetime') {
			if (timeRequired && !time) return;
			onCommit({ name, type, raw: formatDate(withTime(selection.start, time)) });
			return;
		}
		const span = { start: selection.start, end: selection.end ?? selection.start };
		const raw = selection.end ? formatSpan(span) : dayKey(selection.start);
		if (type === 'date-range') {
			onCommit({ name, type, raw: formatSpan(span) });
			return;
		}
		onCommit({ name, type, raw: [...list, raw] });
		setSelection(null);
	};

	const removeListItem = (index: number): void => {
		const next = list.filter((_, itemIndex) => itemIndex !== index);
		onCommit(next.length ? { name, type: 'date-list', raw: next } : null);
	};

	const addRecurrence = async (): Promise<void> => {
		const raw = await editRecurrence(api.app, { name, value: '' });
		if (!raw) return;
		onCommit({ name, type: 'date-list', raw: [...list, raw] });
	};

	const monthTitle = dateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(
		new Date(month.y, month.m - 1, 1),
	);

	return (
		<div class="eb-date-editor">
			{type === 'date-list' && list.length ? (
				<div class="eb-date-values">
					{list.map((raw, index) => (
						<div class="eb-date-value" key={`${String(index)}-${raw}`}>
							<span>{raw}</span>
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
					return (
						<button
							type="button"
							key={key}
							class={`eb-date-day${isSameMonth(day, month) ? '' : ' is-outside'}${selected ? ' is-selected' : ''}${endpoint ? ' is-endpoint' : ''}`}
							aria-label={key}
							aria-pressed={selected}
							onClick={() => select(day)}
						>
							{day.d}
						</button>
					);
				})}
			</div>

			{timeEnabled ? (
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
					disabled={!selection || (timeRequired && !time)}
					onClick={saveSelection}
				>
					{type === 'date-list' ? t('propertyBadges.addDate') : t('propertyBadges.setDate')}
				</button>
			</div>
		</div>
	);
}
