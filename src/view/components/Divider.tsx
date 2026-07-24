import type { Divider as DividerModel } from '../../model/types';

export function DividerRow({ divider }: { divider: DividerModel }) {
	if (divider.name !== undefined) {
		return (
			<div class="eb-divider eb-divider-named">
				<span class="eb-divider-label">{divider.name}</span>
				{divider.collapsed ? <span class="eb-collapsed-dot" title="Collapsed" /> : null}
			</div>
		);
	}
	return <hr class="eb-divider" />;
}
