// Moving date windows on the model's timezone-free calendar/minute scale.
import { addDays, addMonths, fromOrdinal, startOfMonth, startOfWeek, toOrdinal, type CalDate } from './dates';

export const FILTER_DATE_UNITS = ['minute', 'hour', 'day', 'week', 'month'] as const;
export const FILTER_DATE_PRESETS = ['yesterday', 'today', 'thisWeek', 'nextWeek', 'thisMonth', 'nextMonth'] as const;

export interface FilterDateWindow {
	from: number;
	to: number;
}

export function dateMinute(date: CalDate, end = false): number {
	return toOrdinal(date) * 1440 + (date.minutes ?? (end ? 1439 : 0));
}

/** Inclusive windows, evaluated afresh rather than saved as absolute dates. */
export function filterDateWindow(
	op: 'inLast' | 'inNext' | 'inPeriod',
	value: string,
	today: CalDate,
	minutes = 0,
	weekStart = 1,
): FilterDateWindow | null {
	if (op === 'inPeriod') {
		let start: CalDate;
		let end: CalDate;
		switch (value) {
			case 'today':
			case 'yesterday':
				start = addDays(today, value === 'yesterday' ? -1 : 0);
				end = addDays(start, 1);
				break;
			case 'thisWeek':
			case 'nextWeek':
				start = addDays(startOfWeek(today, weekStart), value === 'nextWeek' ? 7 : 0);
				end = addDays(start, 7);
				break;
			case 'thisMonth':
			case 'nextMonth':
				start = addMonths(startOfMonth(today), value === 'nextMonth' ? 1 : 0);
				end = addMonths(start, 1);
				break;
			default:
				return null;
		}
		return { from: toOrdinal(start) * 1440, to: toOrdinal(end) * 1440 - 1 };
	}
	const match = /^(\d+) (minute|hour|day|week|month)$/.exec(value);
	if (!match) return null;
	const amount = Number(match[1]);
	if (!Number.isSafeInteger(amount)) return null;
	const direction = op === 'inLast' ? -1 : 1;
	const current = toOrdinal(today) * 1440 + minutes;
	const unit = match[2];
	const shifted = unit === 'month'
		? toOrdinal(addMonths(today, direction * amount)) * 1440 + minutes
		: current + direction * amount * (unit === 'week' ? 10080 : unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1);
	// Keep arithmetic inside the supported four-digit calendar domain.
	const year = fromOrdinal(Math.floor(shifted / 1440)).y;
	if (!Number.isSafeInteger(shifted) || year < 0 || year > 9999) return null;
	return { from: Math.min(current, shifted), to: Math.max(current, shifted) };
}
