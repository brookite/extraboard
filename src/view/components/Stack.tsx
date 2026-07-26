import { Menu } from 'obsidian';
import { useRef, useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { Board } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import type { BoardApi } from '../api';
import { useSortable } from '../useSortable';
import { CardTile } from './Card';
import { DividerRow } from './Divider';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';

interface Props {
	board: Board;
	index: number;
	api: BoardApi;
	settings: ExtraboardSettings;
}

/** How many consecutive items right after `index` are hidden by that divider. */
function countHiddenAfter(hidden: Set<number>, index: number): number {
	let count = 0;
	while (hidden.has(index + 1 + count)) count++;
	return count;
}

export function StackColumn({ board, index, api, settings }: Props) {
	const [renaming, setRenaming] = useState(false);
	// Set right after a fresh card is inserted at the top, so that card's tile
	// opens itself for editing once, then clears this back.
	const [pendingNewCard, setPendingNewCard] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	useSortable(bodyRef, { group: 'eb-items', draggable: '.eb-item' }, (drop) => {
		const from = { stack: drop.fromList, item: drop.fromIndex };
		// Dropping a card on the archive target is not a move (archive.md §5.5).
		if (drop.toArchive) {
			api.update((b) => ops.archiveCard(b, from));
			return;
		}
		api.update((b) => ops.moveItem(b, from, drop.toList, drop.before));
	});

	const stack = board.stacks[index];
	if (!stack) return null;

	const collapsed = stack.collapsed;
	const hidden = ops.hiddenItems(stack);
	const toggleLabel = collapsed ? 'Expand stack' : 'Collapse stack';

	const setCollapsed = (value: boolean): void =>
		api.update((b) => ops.setStackCollapsed(b, index, value));

	/** Insert a blank card at the top and open it for editing right away. */
	const addCard = (): void => {
		setCollapsed(false);
		api.update((b) => ops.addCard(b, index, '', 0));
		setPendingNewCard(true);
	};

	const deleteStack = async (): Promise<void> => {
		const count = ops.cardCount(stack);
		if (count > 0) {
			// The cards are archived, not destroyed (archive.md §5.6) — which is
			// what the confirmation has to say, so "Delete" is not read as "lose".
			const ok = await api.confirm(
				'Delete stack',
				`"${stack.name}" contains ${String(count)} card${count === 1 ? '' : 's'}. Deleting the stack moves ${count === 1 ? 'it' : 'them'} to the archive, where ${count === 1 ? 'it' : 'they'} can be restored.`,
				'Delete',
			);
			if (!ok) return;
		}
		api.update((b) => ops.deleteStack(b, index));
	};

	const openMenu = (event: MouseEvent): void => {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Add card')
				.setIcon('plus')
				.onClick(addCard),
		);
		menu.addItem((item) =>
			item
				.setTitle('Add divider')
				.setIcon('minus')
				.onClick(() => api.update((b) => ops.addDivider(b, index, undefined))),
		);
		menu.addItem((item) =>
			item
				.setTitle('Add named divider')
				.setIcon('heading')
				.onClick(() => api.update((b) => ops.addDivider(b, index, 'Group'))),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Rename stack')
				.setIcon('pencil')
				.onClick(() => setRenaming(true)),
		);
		menu.addItem((item) =>
			item
				.setTitle(toggleLabel)
				.setIcon(collapsed ? 'chevron-down' : 'chevron-right')
				.onClick(() => setCollapsed(!collapsed)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Insert stack left')
				.setIcon('arrow-left')
				.onClick(() => api.update((b) => ops.addStack(b, 'New stack', index))),
		);
		menu.addItem((item) =>
			item
				.setTitle('Insert stack right')
				.setIcon('arrow-right')
				.onClick(() => api.update((b) => ops.addStack(b, 'New stack', index + 1))),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Delete stack')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => void deleteStack()),
		);
		menu.showAtMouseEvent(event);
	};

	return (
		<div
			class={`eb-stack${collapsed ? ' is-collapsed' : ''}`}
			data-index={index}
			onContextMenu={(e) => {
				if (e.target instanceof Element && e.target.closest('.eb-item')) return;
				e.preventDefault();
				openMenu(e);
			}}
		>
			<div class="eb-stack-header">
				{/* The only drag zone for the stack (`handle` in KanbanView), so the
				    rest of the header keeps its click targets. */}
				<span class="eb-stack-grip" title="Drag to reorder" aria-hidden="true">
					<Icon name="grip-vertical" />
				</span>
				<button
					type="button"
					class="eb-icon-button"
					aria-label={toggleLabel}
					title={toggleLabel}
					onClick={(e) => {
						e.stopPropagation();
						setCollapsed(!collapsed);
					}}
				>
					<Icon name="chevron-down" class={`eb-chevron${collapsed ? ' is-collapsed' : ''}`} />
				</button>
				{renaming ? (
					<InlineEditor
						value={stack.name}
						placeholder="Stack name"
						class="eb-stack-name-editor"
						onSubmit={(name) => {
							setRenaming(false);
							api.update((b) => ops.renameStack(b, index, name));
						}}
						onCancel={() => setRenaming(false)}
					/>
				) : (
					<span class="eb-stack-name" onClick={() => setRenaming(true)}>
						{stack.name || <span class="eb-placeholder">Untitled</span>}
					</span>
				)}
				<span class="eb-stack-count">{ops.cardCount(stack)}</span>
				<IconButton icon="more-vertical" label="Stack options" onClick={openMenu} />
			</div>

			{collapsed ? null : (
				<div class="eb-stack-compose">
					<button type="button" class="eb-add-card" onClick={addCard}>
						<Icon name="plus" />
						<span>Add card</span>
					</button>
				</div>
			)}

			<div class="eb-stack-body" ref={bodyRef} data-list={index} hidden={collapsed}>
				{stack.items.map((item, i) =>
					hidden.has(i) ? null : item.kind === 'card' ? (
						<CardTile
							key={i}
							board={board}
							stackIndex={index}
							index={i}
							api={api}
							settings={settings}
							forceEdit={i === 0 && pendingNewCard}
							onForceEditConsumed={() => setPendingNewCard(false)}
						/>
					) : (
						<DividerRow
							key={i}
							board={board}
							stackIndex={index}
							index={i}
							api={api}
							hiddenCount={countHiddenAfter(hidden, i)}
						/>
					),
				)}
			</div>
		</div>
	);
}
