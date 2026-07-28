import { useCallback, useRef, useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { BoardConfig, Stack } from '../../model/types';
import { archiveOpts, cardEntryPos, type ExtraboardSettings } from '../../settings';
import { editStack } from '../../ui/StackModal';
import type { BoardApi } from '../api';
import { memo } from '../memo';
import { useCloseOnReload } from '../reload';
import { revealStack } from '../revealStack';
import { useSortable } from '../useSortable';
import { CardTile } from './Card';
import { DividerRow } from './Divider';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { t } from '../../i18n';
import { showDropdownMenu } from '../../util/menu';

/** Identity-stable props, so the memo below holds across an edit in another
 * stack (m10-perf.md §2) — the stack object and the board's config, never the
 * board, which every edit replaces. */
interface Props {
	stack: Stack;
	index: number;
	config: BoardConfig;
	api: BoardApi;
	settings: ExtraboardSettings;
}

/** How many consecutive items right after `index` are hidden by that divider. */
function countHiddenAfter(hidden: Set<number>, index: number): number {
	let count = 0;
	while (hidden.has(index + 1 + count)) count++;
	return count;
}

function StackColumnInner({ stack, index, config, api, settings }: Props) {
	const [renaming, setRenaming] = useState(false);
	// Set right after a fresh card is inserted at the top, so that card's tile
	// opens itself for editing once, then clears this back.
	const [pendingNewCard, setPendingNewCard] = useState(false);
	// Stable across renders: an inline lambda here would change on every render of
	// this column and defeat every card's memo (m10-perf.md §2).
	const clearPendingNewCard = useCallback(() => setPendingNewCard(false), []);
	// As for a card or a divider: the rename is the slot's state, and an external
	// reload can put a different stack at this index (view/reload.ts).
	useCloseOnReload(() => setRenaming(false));
	const bodyRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	useSortable(bodyRef, { group: 'eb-items', draggable: '.eb-item' }, (drop) => {
		const from = { stack: drop.fromList, item: drop.fromIndex };
		// Dropping a card on the archive target is not a move (archive.md §5.5).
		if (drop.toArchive) {
			api.update((b) => ops.archiveCard(b, from, archiveOpts(settings)));
			return;
		}
		api.update((b) => ops.moveItem(b, from, drop.toList, drop.before));
	});

	const collapsed = stack.collapsed;
	const hidden = ops.hiddenItems(stack);
	const toggleLabel = collapsed ? t('stack.expand') : t('stack.collapse');

	const setCollapsed = (value: boolean): void =>
		api.update((b) => ops.setStackCollapsed(b, index, value));

	// Where a new card lands, and so which tile the composer must open (§6.7).
	const entryPos = cardEntryPos(stack, config, settings);

	/** Insert a blank card and open it for editing right away. */
	const addCard = (): void => {
		setCollapsed(false);
		api.update((b) => ops.addCard(b, index, '', entryPos));
		setPendingNewCard(true);
	};

	/** Name plus the completion flag, in one form (§3.3). */
	const editParameters = async (): Promise<void> => {
		const fields = await editStack(api.app, {
			title: t('modal.stack.editTitle'),
			cta: t('modal.stack.editCta'),
			name: stack.name,
			completes: stack.completes,
		});
		if (!fields) return;
		api.update((b) => ops.setStackCompletes(ops.renameStack(b, index, fields.name), index, fields.completes));
	};

	/** Insert a stack beside this one, configured before it exists. */
	const insertStack = async (at: number): Promise<void> => {
		const fields = await editStack(api.app, {
			title: t('modal.stack.addTitle'),
			cta: t('modal.stack.addCta'),
		});
		if (!fields) return;
		api.update((b) => ops.addStack(b, fields.name, at, fields.completes));
	};

	const deleteStack = async (): Promise<void> => {
		const count = ops.cardCount(stack);
		if (count > 0) {
			// The cards are archived, not destroyed (archive.md §5.6) — which is
			// what the confirmation has to say, so "Delete" is not read as "lose".
			const ok = await api.confirm(
				t('stack.deleteStack'),
				count === 1
					? t('stack.deleteConfirmMessageOne', { name: stack.name })
					: t('stack.deleteConfirmMessageMany', { name: stack.name, count }),
				t('common.delete'),
			);
			if (!ok) return;
		}
		api.update((b) => ops.deleteStack(b, index, archiveOpts(settings)));
	};

	const openMenu = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			menu.addItem((item) =>
			item
				.setTitle(t('stack.addCard'))
				.setIcon('plus')
				.onClick(addCard),
			);
			menu.addItem((item) =>
			item
				.setTitle(t('stack.addDivider'))
				.setIcon('minus')
				.onClick(() => api.update((b) => ops.addDivider(b, index, undefined))),
			);
			menu.addItem((item) =>
			item
				.setTitle(t('stack.addNamedDivider'))
				.setIcon('heading')
				.onClick(() => api.update((b) => ops.addDivider(b, index, 'Group'))),
			);
			menu.addSeparator();
		// "Edit", not "Rename": the flag belongs to the same form as the name
		// (stack-completion-and-divider-colors.md §3.3). Clicking the name still
		// renames inline, which is the faster path when that is all one wants.
			menu.addItem((item) =>
			item
				.setTitle(t('modal.stack.editTitle'))
				.setIcon('pencil')
				.onClick(() => {
					void editParameters();
				}),
			);
			menu.addItem((item) =>
			item
				.setTitle(toggleLabel)
				.setIcon(collapsed ? 'chevron-down' : 'chevron-right')
				.onClick(() => setCollapsed(!collapsed)),
			);
			menu.addItem((item) =>
			item
				.setTitle(t('stack.insertLeft'))
				.setIcon('arrow-left')
				.onClick(() => {
					void insertStack(index);
				}),
			);
			menu.addItem((item) =>
			item
				.setTitle(t('stack.insertRight'))
				.setIcon('arrow-right')
				.onClick(() => {
					void insertStack(index + 1);
				}),
			);
			menu.addSeparator();
			menu.addItem((item) =>
			item
				.setTitle(t('stack.deleteStack'))
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => void deleteStack()),
			);
		});
	};

	return (
		<div
			class={`eb-stack${collapsed ? ' is-collapsed' : ''}`}
			data-index={index}
			ref={rootRef}
			onContextMenu={(e) => {
				if (e.target instanceof Element && e.target.closest('.eb-item')) return;
				e.preventDefault();
				openMenu(e);
			}}
		>
			{/* Clicking the stack's own chrome — the grip included — brings a
			    column that hangs off either end of the board fully into view (§2).
			    It runs alongside whatever the click also did (collapse, rename,
			    open the menu) and does nothing when the stack is already whole, so
			    it never competes with those targets. */}
			<div
				class="eb-stack-header"
				onClick={() => {
					if (rootRef.current) revealStack(rootRef.current);
				}}
			>
				{/* The only drag zone for the stack (`handle` in KanbanView), so the
				    rest of the header keeps its click targets. */}
				<span class="eb-stack-grip" title={t('modal.checklist.dragToReorder')} aria-hidden="true">
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
						placeholder={t('modal.stack.namePlaceholder')}
						class="eb-stack-name-editor"
						onSubmit={(name) => {
							setRenaming(false);
							api.update((b) => ops.renameStack(b, index, name));
						}}
						onCancel={() => setRenaming(false)}
					/>
				) : (
					<span class="eb-stack-name" onClick={() => setRenaming(true)}>
						{stack.name || <span class="eb-placeholder">{t('modal.archive.untitled')}</span>}
					</span>
				)}
				{/* Otherwise the flag would be invisible and cards would look like
				    they complete themselves (§3.3). */}
				{stack.completes ? (
					<span
						class="eb-stack-completes"
						title={t('stack.completesCards')}
						aria-label={t('stack.completesCards')}
					>
						<Icon name="check-check" />
					</span>
				) : null}
				<span class="eb-stack-count">{ops.cardCount(stack)}</span>
				<IconButton icon="more-vertical" label={t('stack.options')} onClick={openMenu} />
			</div>

			{collapsed ? null : (
				<div class="eb-stack-compose">
					<button type="button" class="eb-add-card" onClick={addCard}>
						<Icon name="plus" />
						<span>{t('stack.addCard')}</span>
					</button>
				</div>
			)}

			<div class="eb-stack-body" ref={bodyRef} data-list={index} hidden={collapsed}>
				{stack.items.map((item, i) =>
					hidden.has(i) ? null : item.kind === 'card' ? (
						<CardTile
							key={i}
							card={item.card}
							stackIndex={index}
							index={i}
							config={config}
							groupColor={ops.groupColor(stack, i)}
							api={api}
							settings={settings}
							forceEdit={i === (entryPos === 0 ? 0 : stack.items.length - 1) && pendingNewCard}
							onForceEditConsumed={clearPendingNewCard}
						/>
					) : (
						<DividerRow
							key={i}
							divider={item.divider}
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

export const StackColumn = memo(StackColumnInner);
