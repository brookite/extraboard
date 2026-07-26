import { Menu } from 'obsidian';
import { useEffect, useState } from 'preact/hooks';
import { parseCardLink, unlinkedTitle } from '../../model/link';
import * as ops from '../../model/ops';
import type { Board, Card } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { ChecklistModal } from '../../ui/ChecklistModal';
import type { BoardApi } from '../api';
import { CardEditor } from '../CardEditor';
import { hoverLinkText, openLinkText, resolveCardLink } from '../links';
import { isDragging } from '../useSortable';
import { IconButton } from './Icon';
import { MarkdownText, hasMarkdown } from './MarkdownText';
import { ChecklistProgress, progressStyleFor } from './Progress';
import { PropertyBadge } from './PropertyBadge';
import { safeColor } from './style';
import { Tag } from './Tag';

interface Props {
	board: Board;
	stackIndex: number;
	index: number;
	api: BoardApi;
	settings: ExtraboardSettings;
	/** Open this card for editing as soon as it mounts (a freshly created card). */
	forceEdit?: boolean;
	/** Called once `forceEdit` has been acted on, so the caller can clear it. */
	onForceEditConsumed?: () => void;
}

/** The board's single `color` property paints the card instead of a badge. */
function cardColor(card: Card): string {
	const pv = card.properties.find((p) => p.type === 'color');
	return pv?.type === 'color' ? pv.value : '';
}

export function CardTile({
	board,
	stackIndex,
	index,
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

	const entry = board.stacks[stackIndex]?.items[index];
	if (entry?.kind !== 'card') return null;

	const card = entry.card;
	const ref = { stack: stackIndex, item: index };

	if (editing) {
		return (
			<div class="eb-item eb-card is-editing" data-index={index}>
				<CardEditor
					board={board}
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
	const color = safeColor(rawColor);
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
			title: 'Card color',
			value: rawColor,
			clearLabel: 'No color',
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
		menu.addItem((item) =>
			item
				.setTitle('Checklist')
				.setIcon('list-checks')
				.onClick(openChecklist),
		);

		// Only the note actions that apply to this card (§2).
		menu.addSeparator();
		if (link) {
			menu.addItem((item) =>
				item
					.setTitle('Open note')
					.setIcon('file-text')
					.onClick(() => {
						void api.app.workspace.openLinkText(link.linktext, api.sourcePath(), false);
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle('Unlink note')
					.setIcon('unlink')
					.onClick(() => api.update((b) => ops.unlinkCardNote(b, ref))),
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle('Create note')
					.setIcon('file-plus')
					.onClick(() => api.createCardNote(ref)),
			);
		}

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
				.setTitle('Archive card')
				.setIcon('archive')
				// Warning styling: it is the item that takes the card off the board,
				// so it has to read as one at a glance (kanban-view.md §5.3).
				.setWarning(true)
				.onClick(() => api.update((b) => ops.archiveCard(b, ref))),
		);
		// Archiving is the non-destructive default, so deleting is opt-in
		// (settings.md, archive.md §1).
		if (settings.allowDeleteWithoutArchive) {
			menu.addItem((item) =>
				item
					.setTitle('Delete card')
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
						<span class="eb-placeholder">Untitled</span>
					)}
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
						<PropertyBadge
							key={i}
							pv={pv}
							config={board.config}
							progress={progressStyleFor(board, settings)}
						/>
					))}
				</div>
			) : null}
			{card.tags.length > 0 || progress.total > 0 ? (
				<div class="eb-card-foot">
					<div class="eb-card-tags">
						{card.tags.map((t) => (
							<Tag key={t} tag={t} config={board.config} api={api} />
						))}
					</div>
					<ChecklistProgress
						done={progress.done}
						total={progress.total}
						style={progressStyleFor(board, settings)}
						onOpen={openChecklist}
					/>
				</div>
			) : null}
		</div>
	);
}
