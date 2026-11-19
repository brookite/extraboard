import { FILTER_DATE_PRESETS, FILTER_DATE_UNITS } from '../../model/filterDates';
import { t } from '../../i18n';

/** Moving windows store their definition, never the current resolved dates. */
export function FilterDateEditor({ op, value, onChange }: {
	op: 'inLast' | 'inNext' | 'inPeriod';
	value: string;
	onChange: (value: string) => void;
}) {
	if (op === 'inPeriod') {
		return (
			<select class="eb-filter-value dropdown" value={value}
				aria-label={t('filter.date.preset')}
				onChange={(e) => onChange(e.currentTarget.value)}>
				<option value="">{t('filter.anyValue')}</option>
				{FILTER_DATE_PRESETS.map((preset) => (
					<option key={preset} value={preset}>{t(`filter.date.${preset}`)}</option>
				))}
			</select>
		);
	}
	const [amount = '', unit = 'day'] = value.split(' ');
	return (
		<div class="eb-filter-date-window">
			<input type="number" min="0" step="1" value={amount}
				aria-label={t('filter.date.amount')} placeholder={t('filter.date.amount')}
				onInput={(e) => onChange(`${e.currentTarget.value} ${unit}`)} />
			<select class="dropdown" value={unit} aria-label={t('filter.date.unit')}
				onChange={(e) => onChange(`${amount} ${e.currentTarget.value}`)}>
				{FILTER_DATE_UNITS.map((entry) => (
					<option key={entry} value={entry}>{t(`filter.date.${entry}`)}</option>
				))}
			</select>
		</div>
	);
}
