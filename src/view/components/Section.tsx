// One section of the list view: its header, its rows and its composer.
// Spec: docs/specs/list-view.md §2, §3, §4.
//
// A row is the board's own `CardTile` plus the badge naming the stack the card
// lives in — the day modal's shape (calendar-view.md §5.2), for the same reason:
// a card read outside its column has to say which column that was.

import { Menu } from 'obsidian';
import { useRef, useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { tagsOf } from '../../model/sectionView';
import type { Section } from '../../model/sections';
import type { Board, BoardConfig, PropertyDef, SectionState } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import type { BoardApi } from '../api';
import { useSortable, type DropInfo } from '../useSortable';
import { CardTile } from './Card';
import { Icon, IconButton } from './Icon';
import { InlineEditor } from './InlineEditor';
import { t } from '../../i18n';
import { showDropdownMenu } from '../../util/menu';

export interface SectionProps {
	board: Board;
	section: Section;
	/** Position in the rendered section list — the drag protocol's coordinate. */
	index: number;
	config: BoardConfig;
	/** Cards to draw, already sorted and filtered (§3). */
	rows: ops.ItemRef[];
	state: SectionState;
	/** Date-family properties the sort menu offers (§3.1). */
	dateProps: PropertyDef[];
	/** `fixed` views own the sort and filter, so the chips are read-only (§3.4). */
	locked: boolean;
	/** Document order — the only order rows may be dragged in (§4.3). */
	ordered: boolean;
	api: BoardApi;
	settings: ExtraboardSettings;
	/** The stack the composer adds to, and the way to change it. */
	composerStack: number;
	onComposerStack: (stack: number) => void;
	onState: (patch: Partial<SectionState>) => void;
	/** Create an empty card in this section, in the composer's stack (§4.2). */
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
	menuExtra: (menu: Menu, ref: ops.ItemRef) => void;
	/** Open the stack picker inside a card header. Stable for card memoization. */
	onStackPick: (event: MouseEvent, ref: ops.ItemRef) => void;
	/** Section reordering, absent when this section cannot move (§1.3, §1.4). */
	onMove?: (direction: -1 | 1) => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
}

/** The stack badge every row wears, and the composer's stack picker. */
function StackBadge({
	board,
	stack,
	mode,
	onPick,
}: {
	board: Board;
	stack: number;
	/** `move` — the row's badge, which cannot pick the stack it names; `pick` —
	 * the composer's, which marks it instead. */
	mode: 'move' | 'pick';
	onPick: (index: number) => void;
}) {
	const name = board.stacks[stack]?.name;
	const label = name || t('modal.archive.untitled');
	const choose = (event: MouseEvent): void => {
		event.stopPropagation();
		showDropdownMenu(event, (menu) => {
			board.stacks.forEach((target, i) => {
				menu.addItem((item) =>
					item
						.setTitle(target.name || t('modal.archive.untitled'))
						.setIcon('square-kanban')
						.setChecked(mode === 'pick' && i === stack)
						.setDisabled(mode === 'move' && i === stack)
						.onClick(() => onPick(i)),
				);
			});
		});
	};
	return (
		<button
			type="button"
			class={`eb-badge eb-list-stack is-${mode}`}
			aria-label={`${t('card.moveToStack')}: ${label}`}
			title={label}
			onClick={choose}
		>
			<Icon name="square-kanban" class="eb-button-icon" />
			<span>{label}</span>
		</button>
	);
}

export function SectionGroup(props: SectionProps) {
	const {
		board,
		section,
		index,
		config,
		rows,
		state,
		dateProps,
		locked,
		ordered,
		api,
		settings,
		composerStack,
		onComposerStack,
		onState,
		onAddCard,
		pending,
		onDrop,
		menuExtra,
		onStackPick,
		onMove,
		canMoveUp,
		canMoveDown,
	} = props;

	const [renaming, setRenaming] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	const collapsed = state.collapsed === true;
	const key = section.key;
	const named = key.kind === 'named';

	// Rows move within and between sections; a sorted section shows the order the
	// user asked for, not the file's, so it accepts drops but not positions.
	useSortable(bodyRef, { group: 'eb-list-rows', draggable: '.eb-list-row', sort: ordered }, onDrop);

	const setCollapsed = (value: boolean): void => onState({ collapsed: value });

	/**
	 * Insert an empty card and let its tile open the board's own inline editor —
	 * the Kanban composer's gesture (kanban-view.md §6.7). A plain text field
	 * here would have been a second, poorer way to write a card: no `[[`
	 * completion, no tag completion, no property badges. The list performs it,
	 * because the card it creates has to be visible even when the section's
	 * filter would hide it.
	 */
	const addCard = (): void => {
		setCollapsed(false);
		onAddCard();
	};

	const label =
		key.kind === 'none'
			? t('list.noSection')
			: named
				? section.name
				: t('list.unnamedSection', { stack: board.stacks[key.ref.stack]?.name || t('modal.archive.untitled') });

	const sortLabel = state.sort
		? `${state.sort.property} ${state.sort.dir === 'asc' ? '↑' : '↓'}`
		: t('list.sort.document');

	const chooseSort = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			menu.addItem((item) =>
				item
					.setTitle(t('list.sort.document'))
					.setIcon('list')
					.setChecked(!state.sort)
					.onClick(() => onState({ sort: undefined })),
			);
			for (const def of dateProps) {
				for (const dir of ['asc', 'desc'] as const) {
					menu.addItem((item) =>
						item
							.setTitle(t(dir === 'asc' ? 'list.sort.asc' : 'list.sort.desc', { name: def.name }))
							.setIcon(dir === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow')
							.setChecked(state.sort?.property === def.name && state.sort.dir === dir)
							.onClick(() => onState({ sort: { property: def.name, dir } })),
					);
				}
			}
			if (!dateProps.length) {
				menu.addItem((item) => item.setTitle(t('list.sort.noDateProperty')).setDisabled(true));
			}
		});
	};

	const chooseTags = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			const active = state.tags ?? [];
			const available = tagsOf(board, section.cards);
			if (!available.length) {
				menu.addItem((item) => item.setTitle(t('list.filter.noTags')).setDisabled(true));
			}
			for (const tag of available) {
				menu.addItem((item) =>
					item
						.setTitle(`#${tag}`)
						.setChecked(active.includes(tag))
						.onClick(() =>
							onState({
								tags: active.includes(tag) ? active.filter((x) => x !== tag) : [...active, tag],
							}),
						),
				);
			}
			if (active.length) {
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle(t('list.filter.clear'))
						.setIcon('filter-x')
						.onClick(() => onState({ tags: [] })),
				);
			}
		});
	};

	const rename = (name: string): void => {
		setRenaming(false);
		const next = name.trim();
		if (!next) return;
		if (key.kind === 'named') api.update((b) => ops.renameSection(b, key.name, next));
		else if (key.kind === 'anon') api.update((b) => ops.renameDivider(b, key.ref, next));
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
			if (!locked) {
			menu.addItem((item) =>
				item
					.setTitle(t('list.sort.label'))
					.setIcon('arrow-up-down')
					.onClick(() => chooseSort(event)),
			);
			menu.addItem((item) =>
				item
					.setTitle(t('list.filter.label'))
					.setIcon('filter')
					.onClick(() => chooseTags(event)),
			);
			if (state.tags?.length) {
				menu.addItem((item) =>
					item
						.setTitle(t('list.filter.clear'))
						.setIcon('filter-x')
						.onClick(() => onState({ tags: [] })),
				);
			}
			}
			if (onMove) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(t('list.moveUp'))
					.setIcon('chevron-up')
					.setDisabled(!canMoveUp)
					.onClick(() => onMove(-1)),
			);
			menu.addItem((item) =>
				item
					.setTitle(t('list.moveDown'))
					.setIcon('chevron-down')
					.setDisabled(!canMoveDown)
					.onClick(() => onMove(1)),
			);
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

	const filtered = (state.tags?.length ?? 0) > 0;
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
						value={section.name}
						placeholder={t('list.sectionNamePlaceholder')}
						class="eb-section-name-editor"
						onSubmit={rename}
						onCancel={() => setRenaming(false)}
					/>
				) : (
					<span
						class={`eb-section-name${key.kind === 'none' ? ' is-muted' : ''}`}
						onClick={() => {
							if (key.kind !== 'none') setRenaming(true);
						}}
					>
						{label}
					</span>
				)}
				<button
					type="button"
					class={`eb-badge eb-section-sort${state.sort ? ' is-active' : ''}`}
					disabled={locked}
					title={locked ? t('list.controlsFixed') : t('list.sort.label')}
					onClick={chooseSort}
				>
					<Icon name="arrow-up-down" class="eb-button-icon" />
					<span class="eb-section-sort-label">{sortLabel}</span>
				</button>
				<button
					type="button"
					class={`eb-badge eb-section-filter${filtered ? ' is-active' : ''}`}
					disabled={locked}
					title={locked ? t('list.controlsFixed') : t('list.filter.label')}
					onClick={chooseTags}
				>
					<Icon name="filter" class="eb-button-icon" />
					{filtered ? (
						<span class="eb-section-filter-label">{state.tags!.map((tag) => `#${tag}`).join(' ')}</span>
					) : null}
				</button>
				<span class="eb-section-count">{rows.length}</span>
				<IconButton icon="more-vertical" label={t('stack.options')} onClick={openMenu} />
			</div>

			<div class="eb-section-body" ref={bodyRef} data-list={index} hidden={collapsed}>
				{rows.map((ref, i) => {
					const stack = board.stacks[ref.stack];
					const entry = stack?.items[ref.item];
					if (!stack || entry?.kind !== 'card') return null;
					return (
						<div class="eb-list-row" key={`${String(ref.stack)}-${String(ref.item)}`} data-index={i}>
							<CardTile
								card={entry.card}
								stackIndex={ref.stack}
								index={ref.item}
								config={config}
								groupColor={ops.groupColor(stack, ref.item)}
								api={api}
								settings={settings}
								menuExtra={menuExtra}
								stackLabel={stack.name || t('modal.archive.untitled')}
								onStackPick={onStackPick}
								forceEdit={pending?.stack === ref.stack && pending.item === ref.item}
							/>
							{/* Keep the stack control outside CardTile's read/edit
							    switch: on phones CSS joins both into one visual card,
							    while editing never replaces or hides this footer. */}
							<StackBadge
								board={board}
								stack={ref.stack}
								mode="move"
								onPick={(target) => api.update((b) => ops.moveCardToStack(b, ref, target))}
							/>
						</div>
					);
				})}
			</div>

			{collapsed || !board.stacks.length ? null : (
				<div class="eb-section-compose">
					<button type="button" class="eb-add-card" onClick={addCard}>
						<Icon name="plus" class="eb-button-icon" />
						<span>{t('stack.addCard')}</span>
					</button>
					{/* Which stack the new card is written into (§4.2) — the one
					    decision a list has to make that a Kanban column does not. */}
					<StackBadge
						board={board}
						stack={Math.min(composerStack, board.stacks.length - 1)}
						mode="pick"
						onPick={onComposerStack}
					/>
				</div>
			)}
		</div>
	);
}
