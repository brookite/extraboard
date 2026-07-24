import type { BoardConfig } from '../../model/types';
import { styleFor } from './style';

export function Tag({ tag, config }: { tag: string; config: BoardConfig }) {
	const color = config.tagColors[tag];
	return (
		<span class="eb-tag" style={styleFor(color?.bg, color?.fg)}>
			#{tag}
		</span>
	);
}
