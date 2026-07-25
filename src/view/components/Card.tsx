import { Menu } from 'obsidian';
import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { cardLineContent } from '../../model/serialize';
import type { Board, Card } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import type { BoardApi } from '../api';
import { isDragging } from '../useSortable';
import { IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { PropertyBadge } from './PropertyBadge';
import { safeColor } from './style';
import { Tag } from './Tag';

interface Props {
	board: Board;
	stackIndex: number;
	index: number;
	api: BoardApi;
	settings: ExtraboardSettings;
}

/** The board's single `color` property paints the card instead of a badge. */
function cardColor(card: Card): string {
	const pv = card.properties.find((p) => p.type === 'color');
	return pv?.type === 'color' ? pv.value : '';
}

export function CardTile({ board, stackIndex, index, api, settings }: Props) {
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

	const rawColor = cardColor(card);
	const color = safeColor(rawColor);

	const chooseColor = async (): Promise<void> => {
		const next = await api.pickColor({
			title: 'Card color',
			value: rawColor,
			clearLabel: 'No color',
		});
		if (next === null) return;
		api.update((b) => ops.setCardColor(b, ref, next));
	};

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
		menu.addItem((item) =>
			item
				.setTitle(card.task === undefined ? 'Add checkbox' : 'Remove checkbox')
				.setIcon(card.task === undefined ? 'square-check' : 'square')
				.onClick(() =>
					api.update((b) => ops.setCardTask(b, ref, card.task === undefined ? ' ' : undefined)),
				),
		);
		menu.addItem((item) =>
			item
				.setTitle('Card color')
				.setIcon('palette')
				.onClick(() => {
					void chooseColor();
				}),
		);
		// A flat "Move to" section, one item per stack — no submenu, so it works
		// the same way on mobile (kanban-view.md §5.3).
		if (board.stacks.length > 1) {
			menu.addSeparator();
			board.stacks.forEach((stack, i) => {
				menu.addItem((item) =>
					item
						.setTitle(`Move to ${stack.name || 'Untitled'}`)
						.setIcon('corner-up-right')
						.setDisabled(i === stackIndex)
						.onClick(() => api.update((b) => ops.moveItem(b, ref, i, null))),
				);
			});
		}
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

	// The color property is chrome, not a badge (kanban-view.md §3).
	const badges = card.properties.filter((pv) => pv.type !== 'color');
	const done = ops.isCardDone(card);
	const hasCheckbox = card.task !== undefined || board.config.showCardCheckbox === true;
	const classes = [
		'eb-item',
		'eb-card',
		color ? 'is-colored' : '',
		color && settings.fillCardWithColor ? 'is-filled' : '',
		done ? 'is-done' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<div
			class={classes}
			data-index={index}
			style={color ? `--eb-card-color: ${color}` : undefined}
			onClick={() => {
				if (!isDragging()) setEditing(true);
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				openMenu(e);
			}}
		>
			<div class="eb-card-head">
				{hasCheckbox ? (
					<input
						type="checkbox"
						class="eb-card-check task-list-item-checkbox"
						checked={done}
						aria-label={done ? 'Mark as not done' : 'Mark as done'}
						onClick={(e) => {
							e.stopPropagation();
							api.update((b) => ops.toggleCardTask(b, ref));
						}}
					/>
				) : null}
				<div class="eb-card-title">
					{card.title || <span class="eb-placeholder">Untitled</span>}
				</div>
				<IconButton
					icon="more-horizontal"
					label="Card options"
					class="eb-hover-only eb-card-menu"
					onClick={openMenu}
				/>
			</div>
			{badges.length > 0 ? (
				<div class="eb-card-props">
					{badges.map((pv, i) => (
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
