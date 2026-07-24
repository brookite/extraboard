import type { BoardConfig, Stack as StackModel } from '../../model/types';
import { CardTile } from './Card';
import { DividerRow } from './Divider';

function cardCount(stack: StackModel): number {
	return stack.items.filter((i) => i.kind === 'card').length;
}

export function StackColumn({ stack, config }: { stack: StackModel; config: BoardConfig }) {
	return (
		<div class="eb-stack">
			<div class="eb-stack-header">
				<span class={`eb-chevron${stack.collapsed ? ' is-collapsed' : ''}`} />
				<span class="eb-stack-name">{stack.name}</span>
				<span class="eb-stack-count">{cardCount(stack)}</span>
			</div>
			<div class="eb-stack-body">
				{stack.items.map((item, i) =>
					item.kind === 'card' ? (
						<CardTile key={i} card={item.card} config={config} />
					) : (
						<DividerRow key={i} divider={item.divider} />
					),
				)}
			</div>
		</div>
	);
}
