import type { BoardConfig } from '../../model/types';
import type { BoardApi } from '../api';
import { isDragging } from '../useSortable';
import { styleFor } from './style';

interface Props {
	tag: string;
	config: BoardConfig;
	api: BoardApi;
}

/** A tag chip; selecting it searches the vault for that tag. */
export function Tag({ tag, config, api }: Props) {
	const color = config.tagColors[tag];
	return (
		<a
			class="eb-tag"
			href={`#${tag}`}
			aria-label={`Search for #${tag}`}
			style={styleFor(color?.bg, color?.fg)}
			onClick={(e) => {
				// Never navigate, and never let the card open its editor as well.
				e.preventDefault();
				e.stopPropagation();
				if (!isDragging()) api.searchTag(tag);
			}}
		>
			#{tag}
		</a>
	);
}
