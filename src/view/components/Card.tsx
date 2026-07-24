import { Menu } from 'obsidian';
import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { cardLineContent } from '../../model/serialize';
import type { Board } from '../../model/types';
import type { BoardApi } from '../api';
import { isDragging } from '../useSortable';
import { IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { PropertyBadge } from './PropertyBadge';
import { Tag } from './Tag';

interface Props {
	board: Board;
	stackIndex: number;
	index: number;
	api: BoardApi;
}

export function CardTile({ board, stackIndex, index, api }: Props) {
	const [editing, setEditing] = useState(false);
	const entry = board.stacks[stackIndex]?.items[index];
	if (entry?.kind !== 'card') return null;

	const card = entry.card;
	const ref = { stack: stackIndex, item: index };

	if (editing) {
		return (
			<div class="eb-item eb-card is-editing" data-index={index}>
				<InlineEditor
					value={cardLineContent(card, board.config)}
					placeholder="Card text, @{property|value}, #tag"
					onSubmit={(text) => {
						setEditing(false);
						api.update((b) => ops.setCardText(b, ref, text));
					}}
					onCancel={() => setEditing(false)}
				/>
			</div>
		);
	}

	const openMenu = (event: MouseEvent): void => {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Edit card')
				.setIcon('pencil')
				.onClick(() => setEditing(true)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Duplicate card')
				.setIcon('copy')
				.onClick(() => api.update((b) => ops.duplicateItem(b, ref))),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Delete card')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => api.update((b) => ops.deleteItem(b, ref))),
		);
		menu.showAtMouseEvent(event);
	};

	return (
		<div
			class="eb-item eb-card"
			data-index={index}
			onClick={() => {
				if (!isDragging()) setEditing(true);
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				openMenu(e);
			}}
		>
			<div class="eb-card-head">
				<div class="eb-card-title">
					{card.title || <span class="eb-placeholder">Untitled</span>}
				</div>
				<IconButton
					icon="more-vertical"
					label="Card options"
					class="eb-hover-only"
					onClick={openMenu}
				/>
			</div>
			{card.properties.length > 0 ? (
				<div class="eb-card-props">
					{card.properties.map((pv, i) => (
						<PropertyBadge key={i} pv={pv} config={board.config} />
					))}
				</div>
			) : null}
			{card.tags.length > 0 ? (
				<div class="eb-card-tags">
					{card.tags.map((t) => (
						<Tag key={t} tag={t} config={board.config} api={api} />
					))}
				</div>
			) : null}
		</div>
	);
}
