// Renders a single card property value as a badge. Spec: kanban-view.md §3.

import type { BoardConfig, ProgressStyle, PropertyValue } from '../../model/types';
import { PercentValue } from './Progress';
import { styleFor } from './style';

interface Props {
	pv: PropertyValue;
	config: BoardConfig;
	/** Shape of `percent` values on this board (kanban-view.md §5.5). */
	progress: ProgressStyle;
}

export function PropertyBadge({ pv, config, progress }: Props) {
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
		case 'date-range':
		case 'recurrence':
			return <span class="eb-badge">{pv.raw}</span>;
		case 'date-list':
			return (
				<>
					{pv.raw.map((r, i) => (
						<span class="eb-badge" key={i}>
							{r}
						</span>
					))}
				</>
			);
		case 'raw':
			return <span class="eb-badge eb-badge-muted">{pv.value.join(', ')}</span>;
	}
}
