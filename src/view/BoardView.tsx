// Custom file view for Extraboard boards. Extends TextFileView so Obsidian
// manages the underlying Markdown file (load/save, tab, rename, delete).
// Spec: docs/specs/kanban-view.md §1. Read-only in M3.

import { TextFileView, WorkspaceLeaf } from 'obsidian';
import { render } from 'preact';
import type ExtraboardPlugin from '../main';
import type { Board } from '../model/types';
import { parseBoard } from '../model/parse';
import { ICONS, VIEW_TYPE_BOARD } from '../util/constants';
import { KanbanView } from './KanbanView';

export class BoardView extends TextFileView {
	plugin: ExtraboardPlugin;
	board: Board | null = null;
	private mountEl?: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: ExtraboardPlugin) {
		super(leaf);
		this.plugin = plugin;
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
		this.addAction(ICONS.markdown, 'Open as Markdown', () => this.openAsMarkdown());
	}

	override async onClose(): Promise<void> {
		if (this.mountEl) render(null, this.mountEl);
	}

	// --- TextFileView contract ---

	getViewData(): string {
		// Read-only in M3: never mutate; hand back the original text.
		return this.data;
	}

	setViewData(data: string, _clear: boolean): void {
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

	// --- internals ---

	private ensureMount(): HTMLElement {
		if (!this.mountEl) {
			this.mountEl = this.contentEl.createDiv({ cls: 'eb-root' });
		}
		return this.mountEl;
	}

	private renderBoard(): void {
		const el = this.ensureMount();
		if (!this.board) {
			render(<div class="eb-empty">Could not parse this board.</div>, el);
			return;
		}
		render(<KanbanView board={this.board} />, el);
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
