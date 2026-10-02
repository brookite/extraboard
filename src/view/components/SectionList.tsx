// A read-only section list: the list view's section look, without its drag,
// composer and section editing. Used by the digest and reminder modals.
// Spec: docs/specs/digest-and-reminders.md §5.
//
// It shares the list view's markup and classes (`.eb-section`, `.eb-list-row`)
// so both read as one thing; what it leaves out is everything that writes the
// *section* — a row here is still the board's own `CardTile`, editable in place.

import type { ComponentChildren } from 'preact';
import { useCallback } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { Board, ViewDisplay } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { showDropdownMenu } from '../../util/menu';
import type { BoardApi } from '../api';
import { CardTile } from './Card';
import { Icon } from './Icon';
import { t } from '../../i18n';

export interface SectionHeaderProps {
	title: string;
	/** What the header counts: a number of rows, or `done/total`. */
	count: string;
	collapsed: boolean;
	onToggle: () => void;
	/** Extra controls after the count. */
	children?: ComponentChildren;
}

/** The header of one section: chevron, title, count. Controlled. */
export function SectionHeader({ title, count, collapsed, onToggle, children }: SectionHeaderProps) {
	return (
		<div class="eb-section-header">
			<button
				type="button"
				class="eb-icon-button"
				aria-label={collapsed ? t('stack.expand') : t('stack.collapse')}
				onClick={onToggle}
			>
				<Icon
					name="chevron-down"
					class={`eb-button-icon eb-chevron${collapsed ? ' is-collapsed' : ''}`}
				/>
			</button>
			<span class="eb-section-name" title={title} onClick={onToggle}>
				{title}
			</span>
			<span class="eb-section-count">{count}</span>
			{children}
		</div>
	);
}

export interface SectionRowsProps {
	board: Board;
	refs: ops.ItemRef[];
	api: BoardApi;
	settings: ExtraboardSettings;
	display?: ViewDisplay;
}

function stackName(board: Board, index: number): string {
	return board.stacks[index]?.name || t('modal.archive.untitled');
}

/** Rows of cards; each names its stack and can be moved to another. */
export function SectionRows({ board, refs, api, settings, display }: SectionRowsProps) {
	// Read at click time from the live board, and stable, so no tile's memo misses.
	const pickStack = useCallback(
		(event: MouseEvent, ref: ops.ItemRef): void => {
			event.stopPropagation();
			const current = api.getBoard();
			if (!current) return;
			showDropdownMenu(event, (menu) => {
				current.stacks.forEach((stack, index) => {
					menu.addItem((item) =>
						item
							.setTitle(stack.name || t('modal.archive.untitled'))
							.setIcon('square-kanban')
							.setDisabled(index === ref.stack)
							.onClick(() => api.update((b) => ops.moveCardToStack(b, ref, index))),
					);
				});
			});
		},
		[api],
	);

	return (
		<div class="eb-section-body">
			{refs.map((ref) => {
				const stack = board.stacks[ref.stack];
				const entry = stack?.items[ref.item];
				if (!stack || entry?.kind !== 'card') return null;
				const label = stackName(board, ref.stack);
				return (
					<div class="eb-list-row" key={`${String(ref.stack)}-${String(ref.item)}`}>
						<CardTile
							card={entry.card}
							stackIndex={ref.stack}
							index={ref.item}
							config={board.config}
							groupColor={ops.groupColor(stack, ref.item) ?? stack.accent}
							api={api}
							settings={settings}
							stackLabel={label}
							onStackPick={pickStack}
							display={display}
						/>
						{/* The phone's footer badge; desktop shows it inside the tile. */}
						<button
							type="button"
							class="eb-badge eb-list-stack is-move"
							aria-label={`${t('card.moveToStack')}: ${label}`}
							title={label}
							onClick={(event) => pickStack(event, ref)}
						>
							<Icon name="square-kanban" class="eb-button-icon" />
							<span>{label}</span>
						</button>
					</div>
				);
			})}
		</div>
	);
}
