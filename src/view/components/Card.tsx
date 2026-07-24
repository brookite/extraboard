import type { BoardConfig, Card as CardModel } from '../../model/types';
import { PropertyBadge } from './PropertyBadge';
import { Tag } from './Tag';

export function CardTile({ card, config }: { card: CardModel; config: BoardConfig }) {
	return (
		<div class="eb-card">
			{card.title ? <div class="eb-card-title">{card.title}</div> : null}
			{card.properties.length > 0 ? (
				<div class="eb-card-props">
					{card.properties.map((pv, i) => (
						<PropertyBadge key={i} pv={pv} config={config} />
					))}
				</div>
			) : null}
			{card.tags.length > 0 ? (
				<div class="eb-card-tags">
					{card.tags.map((t) => (
						<Tag key={t} tag={t} config={config} />
					))}
				</div>
			) : null}
		</div>
	);
}
