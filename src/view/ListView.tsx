// The list view: the board read across its stacks, grouped into sections.
// Spec: docs/specs/list-view.md.
//
// This component owns three things the sections themselves cannot: the section
// list (one pass over the board), where each section's display state comes from
// (§3.4), and the mapping from a dropped row back to an `ItemRef`.

import { Menu } from 'obsidian';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { countConditions, filterCards, isEmptyFilter, type FilterNode } from '../model/filter';
import * as ops from '../model/ops';
import { sameKey, sectionOf, sectionsOf, stateKeyOf, type Section } from '../model/sections';
import { sectionMoveTargets } from '../model/sectionView';
import { sortCards, type SortRule } from '../model/sort';
import type { Board, SectionState, ViewDef } from '../model/types';
import { cardEntryPos, type ExtraboardSettings } from '../settings';
import { openFilterSortModal } from '../ui/FilterSortModal';
import type { BoardApi } from './api';
import { SectionGroup } from './components/Section';
import { fieldLabel } from './components/FilterTree';
import { Icon } from './components/Icon';
import { InlineEditor } from './components/InlineEditor';
import { useNow } from './now';
import { showDropdownMenu, submenuOf } from '../util/menu';
import { hideMenuTree } from '../util/menuToggle';
import { useSortable, type DropInfo } from './useSortable';
import { t } from '../i18n';

type ListDef = Extract<ViewDef, { type: 'list' }>;

interface Props {
	board: Board;
	view: ListDef;
	api: BoardApi;
	settings: ExtraboardSettings;
}

/**
 * What a `session` view keeps in the component instead of the file (§3.4): the
 * view's own filter and sort, and every section's collapse. Keyed by section,
 * which is stable for as long as the board's shape is — the state is meant to
 * be lost on a reload anyway.
 */
interface SessionState {
	filter?: FilterNode;
	sorts?: SortRule[];
	collapsed: Record<string, boolean>;
}

/** The key a section's session state is held under. */
function sessionKey(section: Section): string {
	const key = section.key;
	if (key.kind === 'none') return 'none';
	if (key.kind === 'named') return `named:${key.name}`;
	return `anon:${String(key.ref.stack)}:${String(key.ref.item)}`;
}

export function ListView({ board, view, api, settings }: Props) {
	const [session, setSession] = useState<SessionState>({ collapsed: {} });
	const [addingSection, setAddingSection] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	// The composer's stack, per section, remembered for as long as the view is
	// mounted — a list is filled section by section, not stack by stack (§4.2).
	const [composerStacks, setComposerStacks] = useState<Record<string, number>>({});
	// The card a composer just created: it opens itself for editing, and it stays
	// visible until the **next** edit lands, whatever the section's filter says.
	// A brand-new card carries no tags, so a filtered section would otherwise
	// hide it the instant it appeared and strand an empty card in the file.
	const [pending, setPending] = useState<ops.ItemRef | null>(null);
	/** The board as it looked right after that insert; the next one clears it. */
	const pendingBoard = useRef<Board | null>(null);

	useEffect(() => {
		if (pending && pendingBoard.current !== board) setPending(null);
	}, [board, pending]);

	const sections = sectionsOf(board);
	const locked = view.controls === 'fixed';
	const persist = view.controls !== 'session';
	// A `session` view's filter and sort live here and are never written; every
	// other mode reads them off the view definition (§3.4).
	const filter = persist ? view.filter : session.filter;
	const sorts = persist ? view.sorts : session.sorts;
	// Filters ask about dates, and a repetition rule's answer moves at midnight,
	// so the clock is part of the query (filters-and-sorting.md §2.3).
	const ctx = { config: board.config, today: useNow().date };

	/**
	 * A section's collapse (§1.4, §5). An anonymous section's is its divider's own
	 * flag, since that is the one piece of its state the file can hold; the rest
	 * follow the view's persistence mode.
	 */
	const stateOf = (section: Section): SectionState => {
		if (section.key.kind === 'anon') return { collapsed: dividerCollapsed(board, section) };
		const key = stateKeyOf(section.key);
		const stored = key === null ? undefined : view.sections?.[key];
		const collapsed = persist ? stored?.collapsed === true : session.collapsed[sessionKey(section)] === true;
		return { collapsed };
	};

	const patchState = (section: Section, patch: Partial<SectionState>): void => {
		if (patch.collapsed === undefined) return;
		const collapsed = patch.collapsed;
		// An anonymous section's collapse is the divider's, so it is an edit like
		// any other and travels through an op (§1.4).
		if (section.key.kind === 'anon') {
			const ref = section.key.ref;
			api.update((b) => ops.setDividerCollapsed(b, ref, collapsed));
			return;
		}
		const key = stateKeyOf(section.key);
		if (persist && key !== null) {
			api.update((b) => ops.setSectionState(b, view.id, key, { collapsed }));
			return;
		}
		const local = sessionKey(section);
		setSession((current) => ({ ...current, collapsed: { ...current.collapsed, [local]: collapsed } }));
	};

	/** The filter and sort builder (§4). A `session` view keeps the result here. */
	const editFilters = (): void => {
		openFilterSortModal(api.app, {
			board,
			...(filter && { filter }),
			...(sorts && { sorts }),
			onApply: ({ filter: next, sorts: nextSorts }) => {
				if (persist) {
					api.update((b) => ops.setViewSorts(ops.setViewFilter(b, view.id, next), view.id, nextSorts));
					return;
				}
				setSession((current) => ({
					...current,
					...(next ? { filter: next } : { filter: undefined }),
					...(nextSorts.length ? { sorts: nextSorts } : { sorts: undefined }),
				}));
			},
		});
	};

	// Rows as they are drawn: filtered, then sorted (§3). The drop protocol
	// addresses them by position in exactly this array, so the pending card is
	// added *here* rather than inside the section — a card the user just created
	// must be visible even when the section's own filter would hide it, and it
	// must still be addressable as a row.
	const drawn = sections.map((section) => {
		const rows = sortCards(board, filterCards(board, section.cards, filter, ctx), sorts, ctx);
		if (!pending || rows.some((ref) => sameRef(ref, pending))) return rows;
		return section.cards.some((ref) => sameRef(ref, pending)) ? [...rows, pending] : rows;
	});

	/**
	 * Create an empty card in a section, in the stack its composer names, and
	 * remember where it went so that tile opens the inline editor (§4.2). The op
	 * reports the position itself, since it may have created a divider above it.
	 */
	const addCard = (section: Section): void => {
		const stack = Math.min(composerStacks[sessionKey(section)] ?? 0, board.stacks.length - 1);
		if (!board.stacks[stack]) return;
		const key = section.key;
		let inserted: ops.ItemRef | null = null;
		api.update((b) => {
			const result = ops.addCardToSectionAt(b, stack, key, '', entryTop(b, stack, key));
			inserted = result.ref;
			return result.board;
		});
		pendingBoard.current = api.getBoard();
		setPending(inserted);
	};

	/** Only the sectionless group has an "entering card" end to choose (§6.7). */
	const entryTop = (b: Board, stack: number, key: Section['key']): boolean =>
		key.kind === 'none' &&
		(b.stacks[stack]?.completes
			? (b.config.addToTopCompleting ?? settings.addToTopCompleting)
			: (b.config.addToTopOther ?? settings.addToTopOther));

	/**
	 * A dropped row (§4.3). `fromList`/`toList` are section positions and the
	 * indexes are positions among the drawn rows, so both ends are resolved
	 * through `drawn` before an op is asked for anything.
	 *
	 * A drop between two rows of another stack cannot mean a position in this
	 * card's stack, so the target is the next drawn row **of the card's own
	 * stack**; when there is none, the card lands at the end of its group.
	 */
	const onDrop = (info: DropInfo): void => {
		const from = drawn[info.fromList]?.[info.fromIndex];
		const target = sections[info.toList];
		if (!from || !target) return;
		let before: ops.ItemRef | null = null;
		if (info.before !== null) {
			const rows = drawn[info.toList] ?? [];
			before = rows.slice(info.before).find((ref) => ref.stack === from.stack) ?? null;
		}
		api.update((b) => ops.moveCardToSection(b, from, from.stack, target.key, before));
	};

	/**
	 * "Move to section" in the card menu (§4.3) — the same move a drag makes,
	 * without one, which is the only way to make it on a phone. Built from the
	 * live board, since the menu opens long after this render.
	 *
	 * `useCallback` with no dependencies: the identity has to survive a re-render
	 * or every row's memo misses (m10-perf.md §2), and everything it reads it
	 * reads at click time.
	 */
	const menuExtra = useCallback((menu: Menu, ref: ops.ItemRef, event: MouseEvent): void => {
		const current = api.getBoard();
		if (!current) return;
		const here = sectionOf(current, ref);
		const targets = sectionMoveTargets(current, ref);
		if (!targets.some((section) => !sameKey(here, section.key))) return;
		const fill = (target: Menu): void => {
			for (const section of targets) {
				target.addItem((item) =>
					item
						.setTitle(sectionLabel(current, section))
						.setIcon(section.key.kind === 'named' ? 'heading' : 'minus')
						.setDisabled(sameKey(here, section.key))
						.onClick(() => {
							hideMenuTree(target, menu);
							api.update((b) =>
								ops.moveCardToSection(
									b,
									ref,
									ref.stack,
									section.key,
									null,
									cardEntryPos(b.stacks[ref.stack], b.config, settings) === 0,
								),
							);
						}),
				);
			}
		};
		// Keep both move parents together. With one stack there is no stack parent,
		// so this section action starts the move group itself.
		if (current.stacks.length <= 1) menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t('list.moveToSection')).setIcon('corner-up-right');
			const submenu = submenuOf(item);
			if (submenu) fill(submenu);
			// Without submenus the same children open as their own menu, at the
			// `⋯` the user actually pressed — the one position both platforms
			// agree on (kanban-view.md §5.3).
			else item.onClick(() => {
				const flat = new Menu();
				fill(flat);
				flat.showAtMouseEvent(event);
			});
		});
	}, []);

	/** Open the card-header stack picker from the live board. The stable callback
	 * preserves CardTile memoization across unrelated edits. */
	const openStackPicker = useCallback((event: MouseEvent, ref: ops.ItemRef): void => {
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
	}, []);

	// Sections reorder among themselves; only a named one is draggable, so the
	// grip is what Sortable takes hold of (§4.1).
	useSortable(
		rootRef,
		{ group: 'eb-list-sections', draggable: '.eb-section.is-movable', handle: '.eb-section-grip' },
		(info) => {
			const moved = sections[info.fromIndex];
			if (moved?.key.kind !== 'named') return;
			api.update((b) => ops.moveSection(b, moved.key.kind === 'named' ? moved.key.name : '', beforeName(info.before)));
		},
	);

	/**
	 * The section a move lands in front of, as `moveSection` names it: the first
	 * **named** section at or after the drop position, since those are the only
	 * ones the file order can be expressed against. Past the last one it is the
	 * end of the list, which is `null`.
	 */
	const beforeName = (position: number | null): string | null => {
		if (position === null) return null;
		for (const section of sections.slice(position)) {
			if (section.key.kind === 'named') return section.name;
		}
		return null;
	};

	const movable = sections.filter((section) => section.movable);

	const moveBy = (section: Section, direction: -1 | 1): void => {
		if (section.key.kind !== 'named') return;
		const name = section.name;
		const at = movable.indexOf(section);
		const target = at + direction;
		if (target < 0 || target > movable.length) return;
		// Down means "in front of the one after the neighbour", which past the end
		// is simply the end.
		const before = direction === -1 ? (movable[target]?.name ?? null) : (movable[target + 1]?.name ?? null);
		api.update((b) => ops.moveSection(b, name, before));
	};

	const conditions = countConditions(filter);
	const filtered = !isEmptyFilter(filter);
	const sortLabel = sorts?.length
		? `${fieldLabel(sorts[0]!.field, board.config)} ${sorts[0]!.dir === 'asc' ? '↑' : '↓'}${
				sorts.length > 1 ? ` +${String(sorts.length - 1)}` : ''
			}`
		: t('list.sort.document');

	return (
		<div class="eb-list" ref={rootRef} data-list={0}>
			{/* One filter and one sort for the whole list, where the section chips
			    used to be (filters-and-sorting.md §1). */}
			<div class="eb-list-toolbar">
				<button
					type="button"
					class={`eb-badge eb-list-filter${filtered ? ' is-active' : ''}`}
					disabled={locked}
					title={locked ? t('list.controlsFixed') : t('filter.title')}
					onClick={editFilters}
				>
					<Icon name="filter" class="eb-button-icon" />
					<span>{filtered ? t('filter.conditions', { count: conditions }) : t('filter.chip')}</span>
				</button>
				<button
					type="button"
					class={`eb-badge eb-list-sort${sorts?.length ? ' is-active' : ''}`}
					disabled={locked}
					title={locked ? t('list.controlsFixed') : t('filter.sortTab')}
					onClick={editFilters}
				>
					<Icon name="arrow-up-down" class="eb-button-icon" />
					<span>{sortLabel}</span>
				</button>
			</div>
			{board.stacks.length === 0 ? <div class="eb-list-empty">{t('list.emptyBoard')}</div> : null}
			{sections.map((section, index) => {
				const state = stateOf(section);
				const at = movable.indexOf(section);
				return (
					<SectionGroup
						key={sessionKey(section)}
						board={board}
						section={section}
						index={index}
						config={board.config}
						rows={drawn[index] ?? []}
						state={state}
						ordered={!sorts?.length}
						api={api}
						settings={settings}
						composerStack={composerStacks[sessionKey(section)] ?? 0}
						onComposerStack={(stack) =>
							setComposerStacks((current) => ({ ...current, [sessionKey(section)]: stack }))
						}
						onState={(patch) => patchState(section, patch)}
						onAddCard={() => addCard(section)}
						pending={pending}
						onDrop={onDrop}
						menuExtra={menuExtra}
						onStackPick={openStackPicker}
						display={view.display}
						{...(section.movable && { onMove: (direction: -1 | 1) => moveBy(section, direction) })}
						canMoveUp={at > 0}
						canMoveDown={at !== -1 && at < movable.length - 1}
					/>
				);
			})}
			<div class="eb-list-add-section">
				{addingSection ? (
					<InlineEditor
						placeholder={t('list.sectionNamePlaceholder')}
						class="eb-list-add-section-editor"
						onSubmit={(name) => {
							setAddingSection(false);
							api.update((b) => ops.addSection(b, name));
						}}
						onCancel={() => setAddingSection(false)}
					/>
				) : (
					<button
						type="button"
						class="eb-list-add-section-button"
						disabled={!board.stacks.length}
						onClick={() => setAddingSection(true)}
					>
						<Icon name="plus" class="eb-button-icon" />
						<span>{t('list.addSection')}</span>
					</button>
				)}
			</div>
		</div>
	);
}

function sameRef(a: ops.ItemRef, b: ops.ItemRef): boolean {
	return a.stack === b.stack && a.item === b.item;
}

/** The section's label as a menu shows it. */
function sectionLabel(board: Board, section: Section): string {
	if (section.key.kind === 'none') return t('list.noSection');
	if (section.key.kind === 'named') return section.name;
	const stack = board.stacks[section.key.ref.stack]?.name;
	return t('list.unnamedSection', { stack: stack || t('modal.archive.untitled') });
}

/** An anonymous section's collapse lives on its one divider (§1.4). */
function dividerCollapsed(board: Board, section: Section): boolean {
	const ref = section.dividers[0];
	if (!ref) return false;
	const entry = board.stacks[ref.stack]?.items[ref.item];
	return entry?.kind === 'divider' && entry.divider.collapsed;
}
