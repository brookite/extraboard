import { Menu } from 'obsidian';
import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { Board } from '../../model/types';
import type { BoardApi } from '../api';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { safeColor } from './style';
import { t } from '../../i18n';

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
	const toggleLabel = divider.collapsed ? t('divider.expand') : t('divider.collapse');

	const color = safeColor(divider.color);

	const toggle = (): void =>
		api.update((b) => ops.setDividerCollapsed(b, ref, !divider.collapsed));

	/** The color the group's cards inherit (stack-completion-and-divider-colors.md §4). */
	const chooseColor = async (): Promise<void> => {
		const next = await api.pickColor({
			title: t('divider.dividerColor'),
			value: divider.color ?? '',
			clearLabel: t('colorPicker.noColor'),
		});
		if (next === null) return;
		api.update((b) => ops.setDividerColor(b, ref, next));
	};

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
				.setTitle(named ? t('divider.renameDivider') : t('divider.nameDivider'))
				.setIcon('pencil')
				.onClick(() => setEditing(true)),
		);
		if (named) {
			// Only a named divider can carry a color: there is no label to hold it
			// and no group to read as a band (§4.2).
			menu.addItem((item) =>
				item
					.setTitle(t('divider.dividerColor'))
					.setIcon('palette')
					.onClick(() => {
						void chooseColor();
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle(t('divider.removeName'))
					.setIcon('minus')
					.onClick(() => api.update((b) => ops.renameDivider(b, ref, undefined))),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('divider.deleteDivider'))
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
					placeholder={t('divider.namePlaceholder')}
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
			class={`eb-item eb-divider-row${divider.collapsed ? ' is-collapsed' : ''}${color ? ' is-colored' : ''}`}
			data-index={index}
			style={color ? `--eb-divider-color: ${color}` : undefined}
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
					{divider.name || <span class="eb-placeholder">{t('divider.unnamed')}</span>}
				</span>
			) : null}
			<span class="eb-divider-line" />
			{divider.collapsed && hiddenCount > 0 ? (
				<span class="eb-stack-count" title={t('divider.hiddenCards')}>
					{hiddenCount}
				</span>
			) : null}
			<IconButton
				icon="more-vertical"
				label={t('divider.options')}
				class="eb-hover-only"
				onClick={openMenu}
			/>
		</div>
	);
}
