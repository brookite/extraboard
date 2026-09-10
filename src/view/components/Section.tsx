// One group of the list view: its header, its rows and its composer.
// Spec: docs/specs/list-view.md §1.0, §2, §3, §4.
//
// A row is the board's own `CardTile` plus a badge naming the **other** axis:
// grouped by section a row says which stack it came from, grouped by stack it
// says which section — the day modal's shape (calendar-view.md §5.2), for the
// same reason: a card read outside its column has to say where it came from.
//
// Both readings are one component, because a group is a group: what changes is
// what the header edits, what the badge names, and what a drop means.

import { Menu } from 'obsidian';
import { useRef, useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { sameKey, sectionsOf, type Section, type SectionKey } from '../../model/sections';
import { isStackBoundary } from '../../model/sectionView';
import type { Board, BoardConfig, SectionState, ViewDisplay } from '../../model/types';
import { archiveOpts, type ExtraboardSettings } from '../../settings';
import { editStack } from '../../ui/StackModal';
import type { BoardApi } from '../api';
import { useSortable, type DropInfo } from '../useSortable';
import { CardTile } from './Card';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { t } from '../../i18n';
import { showDropdownMenu } from '../../util/menu';
import { isDoubleTap } from '../../util/gesture';

export interface SectionProps {
	board: Board;
	section: Section;
	/** Position in the rendered group list — the drag protocol's coordinate. */
	index: number;
	config: BoardConfig;
	/** Cards to draw, already sorted and filtered (§3). */
	rows: ops.ItemRef[];
	state: SectionState;
	/** Document order — the only order rows may be dragged in (§4.3). */
	ordered: boolean;
	api: BoardApi;
	settings: ExtraboardSettings;
	/** The stack the composer adds to, and the way to change it (section groups). */
	composerStack: number;
	onComposerStack: (stack: number) => void;
	/** The section the composer adds to, and the way to change it (stack groups). */
	composerSection: SectionKey;
	onComposerSection: (key: SectionKey) => void;
	onState: (patch: Partial<SectionState>) => void;
	/** Create an empty card in this group, where its composer points (§4.2). */
	onAddCard: () => void;
	/**
	 * That card, for as long as it is the newest one: its tile opens the inline
	 * editor, and the row is drawn even when the filter would hide it. The list
	 * clears it on the next edit (§4.2).
	 */
	pending: ops.ItemRef | null;
	/** A row was dropped somewhere: the list resolves it, since it owns the map
	 * from rendered positions back to `ItemRef`s. */
	onDrop: (info: DropInfo) => void;
	/** "Move to section" for the card menu — the pointer-free way to do what a
	 * drag does (§4.3). Stable, or every row's memo misses. */
	menuExtra: (menu: Menu, ref: ops.ItemRef, event: MouseEvent) => void;
	/** Open the card header's move picker. Stable for card memoization. */
	onStackPick: (event: MouseEvent, ref: ops.ItemRef) => void;
	/** Group reordering, absent when this group cannot move (§1.3, §1.4). */
	onMove?: (direction: -1 | 1) => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
	/** What this view draws on a card (views.md §5). */
	display?: ViewDisplay;
}

/** One entry of a move badge's menu. */
interface PickOption {
	label: string;
	icon: string;
	/** The composer marks its choice; a row's badge disables the value it names. */
	checked?: boolean;
	disabled?: boolean;
	onPick: () => void;
}

/**
 * The badge a row wears and the composer's picker, in one shape: a label, an
 * icon, and the list it opens. `move` is a row's — it cannot pick the value it
 * already names — and `pick` is the composer's, which marks it instead.
 */
function MoveBadge({
	label,
	icon,
	aria,
	cls,
	mode,
	options,
}: {
	label: string;
	icon: string;
	aria: string;
	cls: string;
	mode: 'move' | 'pick';
	options: () => PickOption[];
}) {
	const choose = (event: MouseEvent): void => {
		event.stopPropagation();
		showDropdownMenu(event, (menu) => {
			for (const option of options()) {
				menu.addItem((item) =>
					item
						.setTitle(option.label)
						.setIcon(option.icon)
						.setChecked(option.checked === true)
						.setDisabled(option.disabled === true)
						.onClick(option.onPick),
				);
			}
		});
	};
	return (
		<button
			type="button"
			class={`eb-badge ${cls} is-${mode}`}
			aria-label={`${aria}: ${label}`}
			title={label}
			onClick={choose}
		>
			<Icon name={icon} class="eb-button-icon" />
			<span>{label}</span>
		</button>
	);
}

/** A stack's label as every picker writes it. */
function stackLabel(board: Board, index: number): string {
	return board.stacks[index]?.name || t('modal.archive.untitled');
}

/** A section's label as every picker writes it. */
function sectionKeyLabel(board: Board, key: SectionKey): string {
	if (key.kind === 'named') return key.name;
	if (key.kind === 'anon') return t('list.unnamedSection', { stack: stackLabel(board, key.ref.stack) });
	if (key.kind === 'stack') return stackLabel(board, key.index);
	return t('list.noSection');
}

/**
 * The section each item of one stack sits in, by index — one pass down the
 * stack rather than a walk back up from every row (m10-perf.md §2). Only the
 * stack-grouped reading needs it, since only there does a group hold cards from
 * several sections.
 */
function sectionsInStack(board: Board, stackIndex: number): SectionKey[] {
	const stack = board.stacks[stackIndex];
	if (!stack) return [];
	let current: SectionKey = { kind: 'none' };
	return stack.items.map((entry, item) => {
		if (entry.kind === 'divider') {
			const name = entry.divider.name?.trim();
			current = name ? { kind: 'named', name } : { kind: 'anon', ref: { stack: stackIndex, item } };
		}
		return current;
	});
}

/** The sections a card can be moved into from a picker: the named ones and none. */
function sectionTargets(board: Board): SectionKey[] {
	const named = sectionsOf(board)
		.filter((section) => section.key.kind === 'named')
		.map((section) => section.key);
	return [{ kind: 'none' }, ...named];
}

export function SectionGroup(props: SectionProps) {
	const {
		board,
		section,
		index,
		config,
		rows,
		state,
		ordered,
		api,
		settings,
		composerStack,
		onComposerStack,
		composerSection,
		onComposerSection,
		onState,
		onAddCard,
		pending,
		onDrop,
		menuExtra,
		onStackPick,
		onMove,
		canMoveUp,
		canMoveDown,
		display,
	} = props;

	const [renaming, setRenaming] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	const collapsed = state.collapsed === true;
	const key = section.key;
	const named = key.kind === 'named';
	/** The stack this group *is*, when the list is grouped by stack (§1.0). */
	const stackIndex = key.kind === 'stack' ? key.index : null;
	const byStack = stackIndex !== null;
	const stack = stackIndex === null ? undefined : board.stacks[stackIndex];
	/** Which section each row of this stack belongs to — the row badges (§1.0). */
	const rowSections = byStack && stackIndex !== null ? sectionsInStack(board, stackIndex) : [];

	// Rows move within and between groups; a sorted group shows the order the
	// user asked for, not the file's, so it accepts drops but not positions.
	useSortable(bodyRef, { group: 'eb-list-rows', draggable: '.eb-list-row', sort: ordered }, onDrop);

	const setCollapsed = (value: boolean): void => onState({ collapsed: value });

	/** Renaming is offered wherever there is a name in the file to change. */
	const renameable = byStack || key.kind !== 'none';

	// The header name carries the divider row's two gestures (mobile.md §8): one
	// tap collapses or expands the group, a second one within the window puts it
	// back and opens the rename editor. The sectionless group has no name to edit,
	// so there its tap only ever collapses.
	const tap = useRef({ at: 0, collapsed: false });
	const onNameClick = (): void => {
		const now = Date.now();
		if (renameable && isDoubleTap(tap.current.at, now)) {
			tap.current.at = 0;
			setCollapsed(tap.current.collapsed);
			setRenaming(true);
			return;
		}
		tap.current = { at: now, collapsed };
		setCollapsed(!collapsed);
	};

	/**
	 * Insert an empty card and let its tile open the board's own inline editor —
	 * the Kanban composer's gesture (kanban-view.md §6.7). A plain text field
	 * here would have been a second, poorer way to write a card: no `[[`
	 * completion, no tag completion, no property badges. The list performs it,
	 * because the card it creates has to be visible even when the group's
	 * filter would hide it.
	 */
	const addCard = (): void => {
		setCollapsed(false);
		onAddCard();
	};

	const label = sectionKeyLabel(board, key);

	const rename = (name: string): void => {
		setRenaming(false);
		const next = name.trim();
		if (!next) return;
		if (stackIndex !== null) api.update((b) => ops.renameStack(b, stackIndex, next));
		else if (key.kind === 'named') api.update((b) => ops.renameSection(b, key.name, next));
		else if (key.kind === 'anon') api.update((b) => ops.renameDivider(b, key.ref, next));
	};

	/** Name plus the completion flag, in the stack form the board itself uses
	 * (stack-completion-and-divider-colors.md §3.3). */
	const editParameters = async (): Promise<void> => {
		if (stackIndex === null || !stack) return;
		const fields = await editStack(api.app, {
			title: t('modal.stack.editTitle'),
			cta: t('modal.stack.editCta'),
			name: stack.name,
			completes: stack.completes,
		});
		if (!fields) return;
		api.update((b) =>
			ops.setStackCompletes(ops.renameStack(b, stackIndex, fields.name), stackIndex, fields.completes),
		);
	};

	/** The Kanban board's own deletion, offered where the stack is (§4.5). */
	const deleteStack = async (): Promise<void> => {
		if (stackIndex === null || !stack) return;
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
		api.update((b) => ops.deleteStack(b, stackIndex, archiveOpts(settings)));
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
				.setTitle(collapsed ? t('stack.expand') : t('stack.collapse'))
				.setIcon(collapsed ? 'chevron-down' : 'chevron-right')
				.onClick(() => setCollapsed(!collapsed)),
			);
			if (onMove) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(byStack ? t('list.moveStackUp') : t('list.moveUp'))
					.setIcon('chevron-up')
					.setDisabled(!canMoveUp)
					.onClick(() => onMove(-1)),
			);
			menu.addItem((item) =>
				item
					.setTitle(byStack ? t('list.moveStackDown') : t('list.moveDown'))
					.setIcon('chevron-down')
					.setDisabled(!canMoveDown)
					.onClick(() => onMove(1)),
			);
			}
			if (byStack) {
			// A stack group edits the stack itself: the same form the board offers,
			// so the completion flag is never left to be discovered elsewhere.
			menu.addSeparator();
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
					.setTitle(t('stack.deleteStack'))
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => void deleteStack()),
			);
			return;
			}
			if (key.kind !== 'none') {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(named ? t('list.renameSection') : t('list.nameSection'))
					.setIcon('pencil')
					.onClick(() => setRenaming(true)),
			);
			}
			if (named) {
			menu.addItem((item) =>
				item
					.setTitle(t('list.removeSection'))
					.setIcon('trash-2')
					// Nothing is lost — the cards stay and join the group above — so
					// this is not a destructive item and asks for no confirmation (§4.4).
					.onClick(() => api.update((b) => ops.removeSection(b, key.name))),
			);
			}
		});
	};

	/** A row's badge: the stack it came from, or the section it sits in (§1.0). */
	const rowBadge = (ref: ops.ItemRef) => {
		if (!byStack) {
			return (
				<MoveBadge
					label={stackLabel(board, ref.stack)}
					icon="square-kanban"
					aria={t('card.moveToStack')}
					cls="eb-list-stack"
					mode="move"
					options={() =>
						board.stacks.map((target, i) => ({
							label: target.name || t('modal.archive.untitled'),
							icon: 'square-kanban',
							disabled: i === ref.stack,
							onPick: () => api.update((b) => ops.moveCardToStack(b, ref, i)),
						}))
					}
				/>
			);
		}
		const here = rowSections[ref.item] ?? { kind: 'none' };
		return (
			<MoveBadge
				label={sectionKeyLabel(board, here)}
				icon={here.kind === 'named' ? 'heading' : 'minus'}
				aria={t('list.moveToSection')}
				cls="eb-list-section"
				mode="move"
				options={() =>
					sectionTargets(board).map((target) => ({
						label: sectionKeyLabel(board, target),
						icon: target.kind === 'named' ? 'heading' : 'minus',
						disabled: sameKey(here, target),
						onPick: () => api.update((b) => ops.moveCardToSection(b, ref, ref.stack, target)),
					}))
				}
			/>
		);
	};

	/** The composer's picker: which stack a card is written into, or which section. */
	const composerBadge = () =>
		byStack ? (
			<MoveBadge
				label={sectionKeyLabel(board, composerSection)}
				icon={composerSection.kind === 'named' ? 'heading' : 'minus'}
				aria={t('list.moveToSection')}
				cls="eb-list-section"
				mode="pick"
				options={() =>
					sectionTargets(board).map((target) => ({
						label: sectionKeyLabel(board, target),
						icon: target.kind === 'named' ? 'heading' : 'minus',
						checked: sameKey(composerSection, target),
						onPick: () => onComposerSection(target),
					}))
				}
			/>
		) : (
			<MoveBadge
				label={stackLabel(board, Math.min(composerStack, board.stacks.length - 1))}
				icon="square-kanban"
				aria={t('card.moveToStack')}
				cls="eb-list-stack"
				mode="pick"
				options={() =>
					board.stacks.map((target, i) => ({
						label: target.name || t('modal.archive.untitled'),
						icon: 'square-kanban',
						checked: i === Math.min(composerStack, board.stacks.length - 1),
						onPick: () => onComposerStack(i),
					}))
				}
			/>
		);

	const classes = ['eb-section', collapsed ? 'is-collapsed' : '', section.movable ? 'is-movable' : '']
		.filter(Boolean)
		.join(' ');

	return (
		<div class={classes} data-index={index}>
			<div class="eb-section-header">
				{section.movable ? (
					<span class="eb-section-grip" title={t('modal.checklist.dragToReorder')} aria-hidden="true">
						<Icon name="grip-vertical" />
					</span>
				) : null}
				<button
					type="button"
					class="eb-icon-button"
					aria-label={collapsed ? t('stack.expand') : t('stack.collapse')}
					onClick={() => setCollapsed(!collapsed)}
				>
					<Icon
						name="chevron-down"
						class={`eb-button-icon eb-chevron${collapsed ? ' is-collapsed' : ''}`}
					/>
				</button>
				{renaming ? (
					<InlineEditor
						value={byStack ? (stack?.name ?? '') : section.name}
						placeholder={byStack ? t('modal.stack.namePlaceholder') : t('list.sectionNamePlaceholder')}
						class="eb-section-name-editor"
						onSubmit={rename}
						onCancel={() => setRenaming(false)}
					/>
				) : (
					<span
						class={`eb-section-name${key.kind === 'none' ? ' is-muted' : ''}`}
						title={collapsed ? t('stack.expand') : t('stack.collapse')}
						onClick={onNameClick}
					>
						{label}
					</span>
				)}
				{/* The same mark the board's column wears, for the same reason: the
				    flag must not be invisible where cards enter the stack (§3.3). */}
				{stack?.completes ? (
					<span
						class="eb-stack-completes"
						title={t('stack.completesCards')}
						aria-label={t('stack.completesCards')}
					>
						<Icon name="check-check" />
					</span>
				) : null}
				<span class="eb-section-count">{rows.length}</span>
				<IconButton icon="more-vertical" label={t('stack.options')} onClick={openMenu} />
			</div>

			<div class="eb-section-body" ref={bodyRef} data-list={index} hidden={collapsed}>
				{rows.flatMap((ref, i) => {
					const rowStack = board.stacks[ref.stack];
					const entry = rowStack?.items[ref.item];
					if (!rowStack || entry?.kind !== 'card') return [];
					const row = (
						<div
							class="eb-list-row"
							key={`${String(ref.stack)}-${String(ref.item)}`}
							data-index={i}
							data-stack={ref.stack}
						>
							{/* `data-stack` is read outside Preact, by `useSortable`'s
							    drag handlers (list-view.md §4.3) — not by this render. */}
							<CardTile
								card={entry.card}
								stackIndex={ref.stack}
								index={ref.item}
								config={config}
								groupColor={ops.groupColor(rowStack, ref.item)}
								api={api}
								settings={settings}
								menuExtra={menuExtra}
								stackLabel={
									byStack
										? sectionKeyLabel(board, rowSections[ref.item] ?? { kind: 'none' })
										: rowStack.name || t('modal.archive.untitled')
								}
								onStackPick={onStackPick}
								forceEdit={pending?.stack === ref.stack && pending.item === ref.item}
								display={display}
							/>
							{/* Keep the move control outside CardTile's read/edit
							    switch: on phones CSS joins both into one visual card,
							    while editing never replaces or hides this footer. */}
							{rowBadge(ref)}
						</div>
					);
					// Only meaningful when the groups are sections: there a drag between
					// rows of different stacks cannot carry the card across, while a
					// stack group's rows are all in one stack already.
					if (byStack || !isStackBoundary(rows, i, ordered)) return [row];
					return [
						<div
							class="eb-list-stack-boundary"
							key={`boundary-${String(ref.stack)}-${String(ref.item)}`}
							title={t('list.stackBoundary')}
							aria-hidden="true"
						/>,
						row,
					];
				})}
			</div>

			{collapsed || !board.stacks.length ? null : (
				<div class="eb-section-compose">
					<button type="button" class="eb-add-card" onClick={addCard}>
						<Icon name="plus" class="eb-button-icon" />
						<span>{t('stack.addCard')}</span>
					</button>
					{/* Which stack the new card is written into, or which section it
					    joins (§4.2) — the one decision a list group has to make that a
					    Kanban column does not. */}
					{composerBadge()}
				</div>
			)}
		</div>
	);
}
