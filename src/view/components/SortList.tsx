// The sort keys of a list view: an ordered, draggable list, most significant
// first. Spec: docs/specs/filters-and-sorting.md §6.

import { useRef } from 'preact/hooks';
import { fieldId, sameField, type FieldRef } from '../../model/fieldValue';
import type { SortRule } from '../../model/sort';
import type { BoardConfig } from '../../model/types';
import { useSortable } from '../useSortable';
import { fieldOptions } from './FilterTree';
import { Icon } from './Icon';
import { t } from '../../i18n';

interface Props {
	config: BoardConfig;
	sorts: SortRule[];
	onChange: (sorts: SortRule[]) => void;
}

export function SortList({ config, sorts, onChange }: Props) {
	const listRef = useRef<HTMLDivElement>(null);
	// The same "revert, then let the model redraw" contract the board uses.
	useSortable(
		listRef,
		{ group: 'eb-sort-rules', draggable: '.eb-sort-rule', handle: '.eb-filter-grip' },
		(info) => {
			const moved = sorts[info.fromIndex];
			if (!moved) return;
			const rest = sorts.filter((_, i) => i !== info.fromIndex);
			const at =
				info.before === null
					? rest.length
					: info.before > info.fromIndex
						? info.before - 1
						: info.before;
			rest.splice(at, 0, moved);
			onChange(rest);
		},
	);

	const options = fieldOptions(config);
	/** A field already sorted by is not offered twice: the second key would never break a tie. */
	const free = (current: FieldRef): typeof options =>
		options.filter(
			(option) => sameField(option.field, current) || !sorts.some((rule) => sameField(rule.field, option.field)),
		);

	const patch = (index: number, next: SortRule): void => {
		onChange(sorts.map((rule, i) => (i === index ? next : rule)));
	};

	const unused = options.find((option) => !sorts.some((rule) => sameField(rule.field, option.field)));

	return (
		<div class="eb-sort">
			<div class="eb-sort-list" ref={listRef} data-list={0}>
				{sorts.map((rule, index) => (
					<div class="eb-sort-rule" key={fieldId(rule.field)} data-index={index}>
						<span class="eb-filter-grip" aria-hidden="true">
							<Icon name="grip-vertical" />
						</span>
						<select
							class="eb-filter-field dropdown"
							value={fieldId(rule.field)}
							onChange={(e) => {
								const id = (e.target as HTMLSelectElement).value;
								const option = options.find((entry) => entry.id === id);
								if (option) patch(index, { ...rule, field: option.field });
							}}
						>
							{free(rule.field).map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>
						<div class="eb-sort-dir">
							{(['asc', 'desc'] as const).map((dir) => (
								<button
									key={dir}
									type="button"
									class={rule.dir === dir ? 'is-active' : ''}
									onClick={() => patch(index, { ...rule, dir })}
								>
									<Icon
										name={dir === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
										class="eb-button-icon"
									/>
									<span>{t(dir === 'asc' ? 'list.sort.ascShort' : 'list.sort.descShort')}</span>
								</button>
							))}
						</div>
						<button
							type="button"
							class="eb-icon-button"
							aria-label={t('filter.removeSort')}
							onClick={() => onChange(sorts.filter((_, i) => i !== index))}
						>
							<Icon name="x" />
						</button>
					</div>
				))}
				{sorts.length === 0 ? <div class="eb-filter-empty">{t('filter.documentOrder')}</div> : null}
			</div>
			<div class="eb-filter-add">
				<button
					type="button"
					disabled={!unused}
					onClick={() => {
						if (unused) onChange([...sorts, { field: unused.field, dir: 'asc' }]);
					}}
				>
					<Icon name="plus" class="eb-button-icon" />
					<span>{t('filter.addSort')}</span>
				</button>
			</div>
		</div>
	);
}
