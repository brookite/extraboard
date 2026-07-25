// Custom file view for Extraboard boards. Extends TextFileView so Obsidian
// manages the underlying Markdown file (load/save, tab, rename, delete).
// Spec: docs/specs/kanban-view.md §1, §6.

import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { render } from 'preact';
import type ExtraboardPlugin from '../main';
import type { Board } from '../model/types';
import * as ops from '../model/ops';
import { parseBoard } from '../model/parse';
import { serializeBoard } from '../model/serialize';
import { BoardSettingsModal } from '../ui/BoardSettingsModal';
import { ICONS, VIEW_TYPE_BOARD } from '../util/constants';
import { BoardApi, confirmDestructive, searchTag } from './api';
import { KanbanView } from './KanbanView';

export class BoardView extends TextFileView {
	plugin: ExtraboardPlugin;
	board: Board | null = null;
	private mountEl?: HTMLElement;
	private api: BoardApi;

	constructor(leaf: WorkspaceLeaf, plugin: ExtraboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.api = {
			update: (mutate) => this.applyEdit(mutate),
			confirm: (title, message, cta) => confirmDestructive(this.app, title, message, cta),
			searchTag: (tag) => searchTag(this.app, tag),
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
