// The archive: the only place archived cards are seen, restored or destroyed.
// Spec: docs/specs/archive.md §6.
//
// A row is a card, **read-only**: no inline editor, no checkbox toggle, no
// checklist modal, no card menu, no drag. The archive is storage, not a second
// board, so the only things a row can do are restore itself and be destroyed.
//
// The list is re-derived from the board's raw archive body after every change
// (§4), so nothing here can go stale against the file.

import { App, Modal } from 'obsidian';
import { render } from 'preact';
import * as ops from '../model/ops';
import type { ArchivedCard, Board } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from '../view/api';
import { IconButton } from '../view/components/Icon';
import { MarkdownText, hasMarkdown } from '../view/components/MarkdownText';
import { ChecklistProgress, progressStyleFor } from '../view/components/Progress';
import { PropertyBadge } from '../view/components/PropertyBadge';
import { styleFor } from '../view/components/style';
import { t } from '../i18n';

interface RowProps {
	entry: ArchivedCard;
	board: Board;
	api: BoardApi;
	settings: ExtraboardSettings;
	onRestore: () => void;
	onDelete: () => void;
	/** A link in the title opens its note, which means leaving the modal. */
	onOpenLink: () => void;
}

function ArchiveRow({ entry, board, api, settings, onRestore, onDelete, onOpenLink }: RowProps) {
	const card = entry.card;
	const progress = ops.checklistProgress(card);
	const badges = card.properties.filter((pv) => pv.type !== 'color');
	const done = ops.isCardDone(card);

	return (
		<div class={`eb-archive-row${done ? ' is-done' : ''}`}>
			<div class="eb-card-head">
				<input
					type="checkbox"
					class="eb-card-check task-list-item-checkbox"
					checked={done}
					disabled
					aria-label={done ? t('modal.archive.done') : t('modal.archive.notDone')}
				/>
				<div
					class="eb-card-title"
					// Capture, because the renderer's own handler stops the click: the
					// note cannot be read behind the modal, so opening one closes it.
					onClickCapture={(e) => {
						if (e.target instanceof Element && e.target.closest('a')) onOpenLink();
					}}
				>
					{card.title.trim() === '' ? (
						<span class="eb-placeholder">{t('modal.archive.untitled')}</span>
					) : hasMarkdown(card.title) ? (
						<MarkdownText markdown={card.title} api={api} />
					) : (
						card.title
					)}
				</div>
				<IconButton icon="archive-restore" label={t('modal.archive.restoreCard')} onClick={onRestore} />
				<IconButton icon="trash-2" label={t('modal.archive.deleteCard')} onClick={onDelete} />
			</div>
			<div class="eb-card-props">
				{/* The origin comes first: it is what Restore will use (§5.3). */}
				<span class="eb-badge eb-archive-from">{entry.from ?? t('modal.archive.unknownOrigin')}</span>
				{badges.map((pv, i) => (
					<PropertyBadge
						key={i}
						pv={pv}
						config={board.config}
						progress={progressStyleFor(board.config, settings)}
						settings={settings}
						card={card}
					/>
				))}
			</div>
			{card.tags.length > 0 || progress.total > 0 ? (
				<div class="eb-card-foot">
					<div class="eb-card-tags">
						{card.tags.map((t) => {
							const color = board.config.tagColors[t];
							// Inert: searching the vault would mean closing the modal for a
							// result the board itself gives more directly (§6).
							return (
								<span class="eb-tag is-static" key={t} style={styleFor(color?.bg, color?.fg)}>
									#{t}
								</span>
							);
						})}
					</div>
					<ChecklistProgress
						done={progress.done}
						total={progress.total}
						style={progressStyleFor(board.config, settings)}
					/>
				</div>
			) : null}
		</div>
	);
}

export class ArchiveModal extends Modal {
	constructor(
		app: App,
		private readonly api: BoardApi,
		private readonly settings: ExtraboardSettings,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('eb-archive-modal');
		this.render();
	}

	override onClose(): void {
		render(null, this.contentEl);
		this.contentEl.empty();
	}

	/** Re-read the board and rebuild the list; the modal itself stays open. */
	private render(): void {
		const board = this.api.getBoard();
		const cards = board ? ops.archivedCards(board) : [];
		this.titleEl.setText(
			cards.length ? t('modal.archive.titleWithCount', { count: cards.length }) : t('modal.archive.title'),
		);

		if (!board || !cards.length) {
			render(<div class="eb-archive-empty">{t('modal.archive.empty')}</div>, this.contentEl);
			return;
		}

		render(
			<>
				<div class="eb-archive-list">
					{cards.map((entry, index) => (
						<ArchiveRow
							key={index}
							entry={entry}
							board={board}
							api={this.api}
							settings={this.settings}
							onRestore={() => {
								this.api.update((b) => ops.restoreCard(b, index));
								this.render();
							}}
							onDelete={() => {
								void this.confirmDelete(entry, index);
							}}
							onOpenLink={() => this.close()}
						/>
					))}
				</div>
				<div class="modal-button-container">
					<button
						type="button"
						class="mod-warning"
						onClick={() => {
							void this.confirmClear(cards.length);
						}}
					>
						{t('modal.archive.clearArchive')}
					</button>
					<button type="button" onClick={() => this.close()}>
						{t('modal.archive.close')}
					</button>
				</div>
			</>,
			this.contentEl,
		);
	}

	/** Destroying an archived card is irreversible, so both ways of it confirm. */
	private async confirmDelete(entry: ArchivedCard, index: number): Promise<void> {
		const title = entry.card.title.trim();
		const ok = await this.api.confirm(
			t('modal.archive.deleteConfirmTitle'),
			title
				? t('modal.archive.deleteConfirmMessage', { title })
				: t('modal.archive.deleteConfirmMessageUntitled'),
			t('modal.archive.delete'),
		);
		if (!ok) return;
		this.api.update((b) => ops.deleteArchived(b, index));
		this.render();
	}

	private async confirmClear(count: number): Promise<void> {
		const ok = await this.api.confirm(
			t('modal.archive.clearArchive'),
			count === 1
				? t('modal.archive.clearConfirmMessageOne')
				: t('modal.archive.clearConfirmMessageMany', { count }),
			t('modal.archive.clearArchive'),
		);
		if (!ok) return;
		this.api.update((b) => ops.clearArchive(b));
		this.render();
	}
}
