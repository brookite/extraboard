import { Menu } from 'obsidian';
import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { Board } from '../../model/types';
import type { BoardApi } from '../api';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';

interface Props {
	board: Board;
	stackIndex: number;
	index: number;
	api: BoardApi;
	/** Cards this divider is currently hiding (0 when expanded). */
	hiddenCount: number;
}

export function DividerRow({ board, stackIndex, index, api, hiddenCount }: Props) {
	const [editing, setEditing] = useState(false);
	const entry = board.stacks[stackIndex]?.items[index];
	if (entry?.kind !== 'divider') return null;

	const divider = entry.divider;
	const ref = { stack: stackIndex, item: index };
	const named = divider.name !== undefined;
	const toggleLabel = divider.collapsed ? 'Expand group' : 'Collapse group';

	const toggle = (): void =>
		api.update((b) => ops.setDividerCollapsed(b, ref, !divider.collapsed));

	const openMenu = (event: MouseEvent): void => {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(toggleLabel)
				.setIcon(divider.collapsed ? 'chevron-down' : 'chevron-right')
				.onClick(toggle),
		);
		menu.addItem((item) =>
			item
				.setTitle(named ? 'Rename divider' : 'Name divider')
				.setIcon('pencil')
				.onClick(() => setEditing(true)),
		);
		if (named) {
			menu.addItem((item) =>
				item
					.setTitle('Remove name')
					.setIcon('minus')
					.onClick(() => api.update((b) => ops.renameDivider(b, ref, undefined))),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Delete divider')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => api.update((b) => ops.deleteItem(b, ref))),
		);
		menu.showAtMouseEvent(event);
	};

	if (editing) {
		return (
			<div class="eb-item eb-divider-row is-editing" data-index={index}>
				<InlineEditor
					value={divider.name ?? ''}
					placeholder="Divider name"
					onSubmit={(name) => {
						setEditing(false);
						api.update((b) => ops.renameDivider(b, ref, name));
					}}
					onCancel={() => setEditing(false)}
				/>
			</div>
		);
	}

	return (
		<div
			class={`eb-item eb-divider-row${divider.collapsed ? ' is-collapsed' : ''}`}
			data-index={index}
			onContextMenu={(e) => {
				e.preventDefault();
				openMenu(e);
			}}
		>
			<button
				type="button"
				class="eb-icon-button"
				aria-label={toggleLabel}
				title={toggleLabel}
				onClick={(e) => {
					e.stopPropagation();
					toggle();
				}}
			>
				<Icon
					name="chevron-down"
					class={`eb-chevron${divider.collapsed ? ' is-collapsed' : ''}`}
				/>
			</button>
			{named ? (
				<span class="eb-divider-label" onClick={() => setEditing(true)}>
					{divider.name || <span class="eb-placeholder">Unnamed</span>}
				</span>
			) : null}
			<span class="eb-divider-line" />
			{divider.collapsed && hiddenCount > 0 ? (
				<span class="eb-stack-count" title="Hidden cards">
					{hiddenCount}
				</span>
			) : null}
			<IconButton
				icon="more-vertical"
				label="Divider options"
				class="eb-hover-only"
				onClick={openMenu}
			/>
		</div>
	);
}
