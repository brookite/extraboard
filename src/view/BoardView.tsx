// Custom file view for Extraboard boards. Extends TextFileView so Obsidian
// manages the underlying Markdown file (load/save, tab, rename, delete).
// Spec: docs/specs/kanban-view.md §1, §6.

import { HoverPopover, Notice, TextFileView, WorkspaceLeaf } from 'obsidian';
import { render } from 'preact';
import type ExtraboardPlugin from '../main';
import type { Board } from '../model/types';
import * as ops from '../model/ops';
import { parseBoard } from '../model/parse';
import { serializeBoard } from '../model/serialize';
import { ArchiveModal } from '../ui/ArchiveModal';
import { BoardSettingsModal } from '../ui/BoardSettingsModal';
import { pickColor } from '../ui/ColorPicker';
import { createCardNote, resolveNoteFolder } from '../util/cardNote';
import { ICONS, VIEW_TYPE_BOARD } from '../util/constants';
import { BoardApi, confirmDestructive, searchTag } from './api';
import { KanbanView, addStack } from './KanbanView';

export class BoardView extends TextFileView {
	plugin: ExtraboardPlugin;
	board: Board | null = null;
	/** Owner of the hover previews raised by card links (`HoverParent`). */
	hoverPopover: HoverPopover | null = null;
	private mountEl?: HTMLElement;
	private api: BoardApi;

	constructor(leaf: WorkspaceLeaf, plugin: ExtraboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.api = {
			app: this.app,
			hoverParent: this,
			component: this,
			sourcePath: () => this.file?.path ?? '',
			update: (mutate) => this.applyEdit(mutate),
			getBoard: () => this.board,
			confirm: (title, message, cta) => confirmDestructive(this.app, title, message, cta),
			searchTag: (tag) => searchTag(this.app, tag),
			pickColor: (options) => pickColor(this.app, options),
			createCardNote: (ref) => {
				void this.createCardNote(ref);
			},
		};
	}

	getViewType(): string {
		return VIEW_TYPE_BOARD;
	}

	getIcon(): string {
		return ICONS.board;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Extraboard';
	}

	override async onOpen(): Promise<void> {
		this.ensureMount();
		this.addAction(ICONS.add, 'Add stack', () => this.addStack());
		// The archive is reached often enough to deserve the header, not only the
		// file menu (user decision, 2026-07-26).
		this.addAction(ICONS.archive, 'Open archive', () => this.openArchive());
		this.addAction(ICONS.settings, 'Board settings', () => this.openBoardSettings());
		this.addAction(ICONS.markdown, 'Open as Markdown', () => this.openAsMarkdown());
	}

	override async onClose(): Promise<void> {
		if (this.mountEl) render(null, this.mountEl);
	}

	// --- TextFileView contract ---

	getViewData(): string {
		// `this.data` is kept in sync with the board on every edit.
		return this.data;
	}

	setViewData(data: string, clear: boolean): void {
		// Saving our own edits echoes back through the file watcher; re-parsing
		// then would throw away in-progress UI state for no reason.
		if (!clear && data === this.data && this.board) return;
		this.data = data;
		try {
			this.board = parseBoard(data);
		} catch (err) {
			this.board = null;
			console.error('Extraboard: failed to parse board', err);
		}
		this.renderBoard();
	}

	clear(): void {
		this.board = null;
		if (this.mountEl) render(null, this.mountEl);
	}

	/** Re-render with the current plugin settings (after the settings tab changes). */
	refresh(): void {
		this.renderBoard();
	}

	/**
	 * Append a stack from the view header, mirroring the "Add stack" column at
	 * the right end of the board — which is off-screen on a wide board, hence
	 * the scroll. It opens the same form as that column, so the completion flag
	 * is offered here too (stack-completion-and-divider-colors.md §3.3).
	 */
	addStack(): void {
		addStack(this.api, null, () => {
			const board = this.mountEl?.querySelector('.eb-board');
			if (board instanceof HTMLElement) board.scrollLeft = board.scrollWidth;
		});
	}

	/**
	 * Create the card's content note, rewrite its title into a link to it, and
	 * open it (card-content-and-checklists.md §2). The title is only rewritten
	 * once the file exists, so a failure changes nothing.
	 */
	private async createCardNote(ref: ops.ItemRef): Promise<void> {
		const board = this.board;
		const file = this.file;
		const entry = board?.stacks[ref.stack]?.items[ref.item];
		if (!board || !file || entry?.kind !== 'card') return;

		const folder = resolveNoteFolder(board.config.cardContentDir, this.plugin.settings.cardNoteFolder);
		const created = await createCardNote(this.app, entry.card.title, folder, file.path);
		if (!created) return;

		this.applyEdit((b) => ops.setCardTitle(b, ref, created.link));
		await this.leaf.openFile(created.file);
	}

	/** Edit this board's `extraboard` configuration (header action + command). */
	openBoardSettings(): void {
		const board = this.board;
		if (!board) return;
		new BoardSettingsModal(this.app, {
			config: board.config,
			board,
			onSave: (config) => {
				this.applyEdit((b) => ops.setBoardConfig(b, config));
			},
		}).open();
	}

	/** Remove every untitled card from the board (file-menu item added in main.ts). */
	deleteUntitledCards(): void {
		this.applyEdit((b) => ops.deleteUntitledCards(b));
	}

	/**
	 * Open the archive (archive.md §6). This is the one moment the section is
	 * parsed — nothing before it, on any path, has looked inside it.
	 */
	openArchive(): void {
		if (!this.board) return;
		new ArchiveModal(this.app, this.api, this.plugin.settings).open();
	}

	/**
	 * Archive every card whose own task marker is `x`/`X` (§5.2). Not confirmed:
	 * it is reversible, so the notice is the whole feedback.
	 */
	archiveCompletedCards(): void {
		const board = this.board;
		if (!board) return;
		const count = ops.countCompletedCards(board);
		if (count === 0) {
			new Notice('No completed cards to archive.');
			return;
		}
		this.applyEdit((b) => ops.archiveCompletedCards(b));
		new Notice(`Archived ${String(count)} card${count === 1 ? '' : 's'}.`);
	}

	// --- internals ---

	private ensureMount(): HTMLElement {
		if (!this.mountEl) {
			this.mountEl = this.contentEl.createDiv({ cls: 'eb-root' });
		}
		return this.mountEl;
	}

	/**
	 * Apply a pure op from `model/ops`, re-serialize and schedule a save. The op
	 * returning the same board means nothing changed, so the file is left alone.
	 */
	private applyEdit(mutate: (board: Board) => Board): void {
		if (!this.board) return;
		const next = mutate(this.board);
		if (next === this.board) return;
		this.board = next;
		this.data = serializeBoard(next);
		this.requestSave();
		this.renderBoard();
	}

	private renderBoard(): void {
		const el = this.ensureMount();
		if (!this.board) {
			render(<div class="eb-empty">Could not parse this board.</div>, el);
			return;
		}
		render(<KanbanView board={this.board} api={this.api} settings={this.plugin.settings} />, el);
	}

	private async openAsMarkdown(): Promise<void> {
		const file = this.file;
		if (!file) return;
		this.plugin.suppressAutoOpen(file.path);
		await this.leaf.setViewState({ type: 'markdown', state: { file: file.path } });
		// Changing the view type does not re-fire file-open, so add the switch
		// back to the board directly on the freshly created Markdown view.
		this.plugin.showBoardSwitch(this.leaf);
	}
}
