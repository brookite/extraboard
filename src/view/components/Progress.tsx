// Checklist `N/M` and `percent` values, drawn in the board's progress style.
// Spec: docs/specs/kanban-view.md §5.5, settings.md §progressStyle.

import type { Board, ProgressStyle } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { ProgressRing } from './ProgressRing';
import { t } from '../../i18n';

/** Board config first, then the plugin setting — two levels, board wins. */
export function progressStyleFor(board: Board, settings: ExtraboardSettings): ProgressStyle {
	return board.config.progressStyle ?? settings.progressStyle;
}

interface ChecklistProps {
	done: number;
	total: number;
	style: ProgressStyle;
	/** Absent => the indicator is inert (an archived card, archive.md §6). */
	onOpen?: () => void;
}

/**
 * The card's checklist indicator. Selecting it opens the checklist modal, and
 * the click never reaches the card, so it does not open the inline editor.
 * A card with no checklist shows nothing at all.
 */
export function ChecklistProgress({ done, total, style, onOpen }: ChecklistProps) {
	if (total === 0) return null;
	const label = `${String(done)}/${String(total)}`;
	const percent = Math.round((done / total) * 100);
	const body =
		style === 'ring' ? (
			<ProgressRing value={percent} label={String(done)} title={label} />
		) : (
			<span class="eb-chip">{style === 'percent' ? `${String(percent)}%` : label}</span>
		);

	if (!onOpen) {
		return (
			<span class="eb-progress is-static" title={label} aria-label={t('progress.checklistAria', { label })}>
				{body}
			</span>
		);
	}
	return (
		<button
			type="button"
			class="eb-progress"
			title={label}
			aria-label={t('progress.checklistAria', { label })}
			onClick={(e) => {
				e.stopPropagation();
				onOpen();
			}}
		>
			{body}
		</button>
	);
}

/**
 * A `percent` property value. It has no denominator, so `fraction` falls back
 * to the percent text.
 */
export function PercentValue({ value, style }: { value: number; style: ProgressStyle }) {
	if (style === 'ring') return <ProgressRing value={value} />;
	return <span class="eb-badge eb-badge-num">{value}%</span>;
}
