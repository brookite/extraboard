import { Menu } from 'obsidian';
import { useEffect, useState } from 'preact/hooks';
import { parseCardLink, unlinkedTitle } from '../../model/link';
import * as ops from '../../model/ops';
import type { BoardConfig, Card } from '../../model/types';
import { archiveOpts, cardEntryPos, type ExtraboardSettings } from '../../settings';
import { ChecklistModal } from '../../ui/ChecklistModal';
import { styleMenuItem, submenuOf } from '../../util/menu';
import type { BoardApi } from '../api';
import { CardEditor } from '../CardEditor';
import { hoverLinkText, openLinkText, resolveCardLink } from '../links';
import { memo } from '../memo';
import { isDragging } from '../useSortable';
import { IconButton } from './Icon';
import { MarkdownText, hasMarkdown } from './MarkdownText';
import { ChecklistProgress, progressStyleFor } from './Progress';
import { PropertyBadge } from './PropertyBadge';
import { safeColor } from './style';
import { Tag } from './Tag';
import { t } from '../../i18n';

/**
 * Every prop is identity-stable across an edit that did not touch this card,
 * which is what lets `memo` below turn a one-card edit into a one-card render
 * (m10-perf.md §2). Hence `card` and `config` rather than the board object,
 * which every edit replaces, and hence `groupColor` pre-resolved by the stack.
 */
interface Props {
	card: Card;
	stackIndex: number;
	index: number;
	config: BoardConfig;
	/** The color inherited from the card's divider group, already resolved
	 * (stack-completion-and-divider-colors.md §4.1). */
	groupColor: string | undefined;
	api: BoardApi;
	settings: ExtraboardSettings;
	/** Open this card for editing as soon as it mounts (a freshly created card). */
	forceEdit?: boolean;
	/** Called once `forceEdit` has been acted on, so the caller can clear it.
	 * Must be stable (`useCallback`) or it defeats the memo for every card. */
	onForceEditConsumed?: () => void;
}

/** The board's single `color` property paints the card instead of a badge. */
function cardColor(card: Card): string {
	const pv = card.properties.find((p) => p.type === 'color');
	return pv?.type === 'color' ? pv.value : '';
}

function CardTileInner({
	card,
	stackIndex,
	index,
	config,
	groupColor,
	api,
	settings,
	forceEdit,
	onForceEditConsumed,
}: Props) {
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!forceEdit) return;
		setEditing(true);
		onForceEditConsumed?.();
	}, [forceEdit]);

	const ref = { stack: stackIndex, item: index };

	if (editing) {
		return (
			<div class="eb-item eb-card is-editing" data-index={index}>
				<CardEditor
					config={config}
					card={card}
					target={ref}
					api={api}
					settings={settings}
					onClose={() => setEditing(false)}
				/>
			</div>
		);
	}

	const rawColor = cardColor(card);
	// A card in a colored divider's group inherits that color, in the same place
	// the card's own would paint; its own always wins
	// (stack-completion-and-divider-colors.md §4.1).
	const color = safeColor(rawColor) ?? safeColor(groupColor);
	// The content note is derived from the title, never stored (§4.4): it is the
	// first link in it. Only a title that is *nothing but* that link renders as
	// one anchor; a title that merely contains it is rendered as Markdown, links
	// and all (§1.1).
	const link = parseCardLink(card.title);
	const linkOnly = link !== null && link.whole;
	const resolved = linkOnly && resolveCardLink(api.app, link, api.sourcePath()) !== null;
	const progress = ops.checklistProgress(card);

	const chooseColor = async (): Promise<void> => {
		const next = await api.pickColor({
			title: t('card.cardColor'),
			value: rawColor,
			clearLabel: t('colorPicker.noColor'),
		});
		if (next === null) return;
		api.update((b) => ops.setCardColor(b, ref, next));
	};

	const openChecklist = (): void => {
		new ChecklistModal(api.app, {
			// The card as it reads, with its content link flattened to its text.
			title: unlinkedTitle(card.title),
			// Read through the live board every time: the modal outlives the render
			// that opened it, and every edit replaces the board object.
			items: () => {
				const current = api.getBoard()?.stacks[stackIndex]?.items[index];
				return current?.kind === 'card' ? current.card.checklist : [];
			},
			apply: (mutate) => api.update((b) => ops.updateChecklist(b, ref, mutate)),
		}).open();
	};

	const openMenu = (event: MouseEvent): void => {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t('card.editCard'))
				.setIcon('pencil')
				.onClick(() => setEditing(true)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('card.duplicateCard'))
				.setIcon('copy')
				.onClick(() => api.update((b) => ops.duplicateItem(b, ref))),
		);
		menu.addItem((item) =>
			item
				.setTitle(card.task === undefined ? t('card.addCheckbox') : t('card.removeCheckbox'))
				.setIcon(card.task === undefined ? 'square-check' : 'square')
				.onClick(() =>
					api.update((b) => ops.setCardTask(b, ref, card.task === undefined ? ' ' : undefined)),
				),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('card.cardColor'))
				.setIcon('palette')
				.onClick(() => {
					void chooseColor();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('modal.checklist.title'))
				.setIcon('list-checks')
				.onClick(openChecklist),
		);

		// Only the note actions that apply to this card (§2).
		menu.addSeparator();
		if (link) {
			menu.addItem((item) =>
				item
					.setTitle(t('card.openNote'))
					.setIcon('file-text')
					.onClick(() => {
						void api.app.workspace.openLinkText(link.linktext, api.sourcePath(), false);
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle(t('card.unlinkNote'))
					.setIcon('unlink')
					.onClick(() => api.update((b) => ops.unlinkCardNote(b, ref))),
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle(t('card.createNote'))
					.setIcon('file-plus')
					.onClick(() => api.createCardNote(ref)),
			);
		}

		// The move section (kanban-view.md §5.3). Read through the live board
		// rather than a captured one: the menu is built at click time, and this
		// card is not handed the board (see `Props`).
		const stacks = api.getBoard()?.stacks ?? [];
		const completing = stacks.findIndex((stack) => stack.completes);
		if (completing !== -1 || stacks.length > 1) menu.addSeparator();

		// "Complete card" is the shortcut for the move a board with a completing
		// stack makes over and over: the card lands wherever that stack takes
		// entering cards (§6.7) and `moveItem` marks it done on the way in (§3.2).
		// Green, because it is the
		// menu's one affirmative action among neutral and destructive ones — and
		// the mirror of "Archive card"'s red at the other end.
		if (completing !== -1 && completing !== stackIndex) {
			menu.addItem((item) => {
				item
					.setTitle(t('card.completeCard'))
					.setIcon('circle-check-big')
					.onClick(() =>
						api.update((b) =>
							ops.moveItem(b, ref, completing, cardEntryPos(b.stacks[completing], b.config, settings)),
						),
					);
				styleMenuItem(item, 'eb-menu-success');
			});
		}

		// "Move to" as a submenu, one child per stack. The flat list it replaces
		// grew with the board and pushed "Archive card" off the bottom of a phone
		// screen; the parent item is one row whatever the board looks like. Where
		// submenus are unavailable the same children open as their own menu, so
		// the action is never simply missing (§5.3).
		if (stacks.length > 1) {
			const fill = (target: Menu): void => {
				stacks.forEach((stack, i) => {
					target.addItem((item) =>
						item
							.setTitle(stack.name || t('modal.archive.untitled'))
							.setIcon('square-kanban')
							.setDisabled(i === stackIndex)
							.onClick(() => api.update((b) => ops.moveItem(b, ref, i, null))),
					);
				});
			};
			menu.addItem((item) => {
				item.setTitle(t('card.moveToStack')).setIcon('corner-up-right');
				const submenu = submenuOf(item);
				if (submenu) fill(submenu);
				else {
					item.onClick(() => {
						const flat = new Menu();
						fill(flat);
						// The `⋯` click: the only position both platforms agree on here.
						flat.showAtMouseEvent(event);
					});
				}
			});
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('kanban.archiveCard'))
				.setIcon('archive')
				// Warning styling: it is the item that takes the card off the board,
				// so it has to read as one at a glance (kanban-view.md §5.3).
				.setWarning(true)
				.onClick(() => api.update((b) => ops.archiveCard(b, ref, archiveOpts(settings)))),
		);
		// Archiving is the non-destructive default, so deleting is opt-in
		// (settings.md, archive.md §1).
		if (settings.allowDeleteWithoutArchive) {
			menu.addItem((item) =>
				item
					.setTitle(t('modal.archive.deleteCard'))
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => api.update((b) => ops.deleteItem(b, ref))),
			);
		}
		menu.showAtMouseEvent(event);
	};

	// The color property is chrome, not a badge (kanban-view.md §3).
	const badges = card.properties.filter((pv) => pv.type !== 'color');
	const done = ops.isCardDone(card);
	const hasCheckbox = card.task !== undefined || config.showCardCheckbox === true;
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
						aria-label={done ? t('modal.checklist.markNotDone') : t('modal.checklist.markDone')}
						onClick={(e) => {
							e.stopPropagation();
							api.update((b) => ops.toggleCardTask(b, ref));
						}}
					/>
				) : null}
				<div class="eb-card-title">
					{linkOnly && link ? (
						// A title that is nothing but the link shows its display text
						// (alias, else the target's basename), which is narrower than what
						// the Markdown renderer would print, so it keeps its own anchor.
						<a
							class={`internal-link${resolved ? '' : ' is-unresolved'}`}
							href={link.linktext}
							data-href={link.linktext}
							rel="noopener"
							onClick={(e) => {
								e.stopPropagation();
								e.preventDefault();
								openLinkText(api.app, link.linktext, api.sourcePath(), e);
							}}
							onAuxClick={(e) => {
								if (e.button !== 1) return;
								e.stopPropagation();
								e.preventDefault();
								openLinkText(api.app, link.linktext, api.sourcePath(), e);
							}}
							onMouseOver={(e) =>
								hoverLinkText(api.app, link.linktext, api.sourcePath(), e, api.hoverParent)
							}
						>
							{link.display}
						</a>
					) : !ops.isCardUntitled(card) ? (
						// Any other title is one line of inline Markdown (§2).
						hasMarkdown(card.title) ? (
							<MarkdownText markdown={card.title} api={api} />
						) : (
							card.title
						)
					) : (
						<span class="eb-placeholder">{t('modal.archive.untitled')}</span>
					)}
				</div>
				<IconButton
					icon="more-horizontal"
					label={t('card.options')}
					class="eb-hover-only eb-card-menu"
					onClick={openMenu}
				/>
			</div>
			{badges.length > 0 ? (
				<div class="eb-card-props">
					{badges.map((pv, i) => (
						<PropertyBadge
							key={i}
							pv={pv}
							config={config}
							progress={progressStyleFor(config, settings)}
							settings={settings}
							card={card}
						/>
					))}
				</div>
			) : null}
			{card.tags.length > 0 || progress.total > 0 ? (
				<div class="eb-card-foot">
					<div class="eb-card-tags">
						{card.tags.map((t) => (
							<Tag key={t} tag={t} config={config} api={api} />
						))}
					</div>
					<ChecklistProgress
						done={progress.done}
						total={progress.total}
						style={progressStyleFor(config, settings)}
						onOpen={openChecklist}
					/>
				</div>
			) : null}
		</div>
	);
}

/**
 * The memoized tile is what the board renders. With `ops`' identity
 * preservation behind it, an edit to one card re-renders that card alone
 * instead of every card on the board (m10-perf.md §2).
 */
export const CardTile = memo(CardTileInner);
