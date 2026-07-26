import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	TFolder,
	ViewState,
	WorkspaceLeaf,
	normalizePath,
} from 'obsidian';
import { DEFAULT_SETTINGS, ExtraboardSettings } from './settings';
import { BoardSettingsModal } from './ui/BoardSettingsModal';
import { cloneDefs } from './ui/PropertyDefsEditor';
import { ExtraboardSettingTab } from './ui/SettingsTab';
import { BoardView } from './view/BoardView';
import { ICONS, VIEW_TYPE_BOARD } from './util/constants';
import { NEW_BOARD_BASENAME, newBoardConfig, newBoardText } from './util/newBoard';
import { parseFrontmatter } from './model/frontmatter';
import type { BoardConfig } from './model/types';

export default class ExtraboardPlugin extends Plugin {
	settings!: ExtraboardSettings;
	/** Files the user just switched to Markdown; skip one auto-open for them. */
	private suppressed = new Set<string>();
	/** "Open as board" buttons added to Markdown views, keyed by view instance. */
	private boardActions = new WeakMap<MarkdownView, HTMLElement>();

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_BOARD,
			(leaf: WorkspaceLeaf) => new BoardView(leaf, this),
		);

		this.addSettingTab(new ExtraboardSettingTab(this.app, this));

		// Intercept every leaf.setViewState so a board file about to open as
		// Markdown is redirected to the board view *before* the Markdown view is
		// built. This catches all open paths uniformly (file explorer, links,
		// quick switcher, workspace restore) with no race and no flicker — unlike
		// converting after file-open, which Obsidian was reverting mid-open.
		this.patchLeafSetViewState();

		this.addRibbonIcon(ICONS.board, 'Create new board', () => {
			this.createNewBoard();
		});

		this.addCommand({
			id: 'create-board',
			name: 'Create new board',
			callback: () => {
				this.createNewBoard();
			},
		});

		this.addCommand({
			id: 'open-as-board',
			name: 'Open current file as board',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return false;
				if (!checking) void this.openAsBoard(view.leaf, view.file);
				return true;
			},
		});

		this.addCommand({
			id: 'board-settings',
			name: 'Board settings',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(BoardView);
				if (!view?.board) return false;
				if (!checking) view.openBoardSettings();
				return true;
			},
		});

		this.addCommand({
			id: 'manage-views',
			name: 'Manage views',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(BoardView);
				if (!view?.board) return false;
				if (!checking) view.manageViews();
				return true;
			},
		});

		this.addCommand({
			id: 'next-view',
			name: 'Switch to next view',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(BoardView);
				if (!view?.board || view.board.config.views.length < 2) return false;
				if (!checking) view.nextView();
				return true;
			},
		});

		this.addCommand({
			id: 'open-archive',
			name: 'Open archive',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(BoardView);
				if (!view?.board) return false;
				if (!checking) view.openArchive();
				return true;
			},
		});

		this.addCommand({
			id: 'archive-completed-cards',
			name: 'Archive completed cards',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(BoardView);
				if (!view?.board) return false;
				if (!checking) view.archiveCompletedCards();
				return true;
			},
		});

		// Fallback + housekeeping. The setViewState patch handles the common case;
		// this catches a board opened before its frontmatter was indexed (cold
		// cache, so the patch could not detect it) and removes a stale switch
		// button when a Markdown view is reused for a plain note.
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) void this.handleFileOpen(file);
			}),
		);

		// Add board-wide actions to the view's own "more options" menu instead of a
		// dedicated header icon (archive.md §7).
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
				const view = leaf?.view;
				if (!(view instanceof BoardView) || !view.board || view.file !== file) return;
				menu.addItem((item) =>
					item
						.setTitle('Manage views…')
						.setIcon(ICONS.views)
						.onClick(() => view.manageViews()),
				);
				menu.addItem((item) =>
					item
						.setTitle('Open archive')
						.setIcon('archive')
						.onClick(() => view.openArchive()),
				);
				menu.addItem((item) =>
					item
						.setTitle('Archive completed cards')
						.setIcon('check-check')
						.onClick(() => view.archiveCompletedCards()),
				);
				menu.addItem((item) =>
					item
						.setTitle('Delete untitled cards')
						.setIcon('eraser')
						.onClick(() => view.deleteUntitledCards()),
				);
			}),
		);

		// On startup the workspace may restore board files before the metadata
		// cache is warm, so the patch cannot detect them; reconcile once ready.
		this.app.workspace.onLayoutReady(() => {
			void this.convertOpenBoards();
		});
	}

	onunload() {}

	/**
	 * Suppress the next auto-open for a path (used when switching to Markdown).
	 * Self-expiring so a suppression that is never consumed (e.g. because
	 * changing the view type did not re-fire file-open) cannot leak and block a
	 * legitimate future auto-open of the same file.
	 */
	suppressAutoOpen(path: string): void {
		this.suppressed.add(path);
		window.setTimeout(() => this.suppressed.delete(path), 1000);
	}

	/** Re-render every open board, e.g. after a display setting changed. */
	refreshBoards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			const view = leaf.view;
			if (view instanceof BoardView) view.refresh();
		}
	}

	/** Add the "Open as board" switch to a leaf that now shows a board as Markdown. */
	showBoardSwitch(leaf: WorkspaceLeaf): void {
		const view = leaf.view;
		if (view instanceof MarkdownView) this.addBoardAction(view);
	}

	/**
	 * Wrap WorkspaceLeaf.prototype.setViewState so a Markdown open of a board
	 * file is rewritten to the board view type before the view is created.
	 * Restored on unload via this.register().
	 */
	private patchLeafSetViewState(): void {
		const proto = WorkspaceLeaf.prototype;
		// eslint-disable-next-line @typescript-eslint/unbound-method -- kept to re-invoke via .call and to restore on unload
		const original = proto.setViewState;
		const shouldRedirect = (path: unknown): path is string =>
			typeof path === 'string' &&
			!this.suppressed.has(path) &&
			this.isBoardPath(path);
		proto.setViewState = function (
			this: WorkspaceLeaf,
			state: ViewState,
			eState?: unknown,
		): Promise<void> {
			if (state.type === 'markdown' && shouldRedirect(state.state?.file)) {
				state = { ...state, type: VIEW_TYPE_BOARD };
			}
			return original.call(this, state, eState);
		};
		this.register(() => {
			proto.setViewState = original;
		});
	}

	/** True iff frontmatter carries the top-level `extraboard` key. */
	private hasBoardKey(fm: unknown): boolean {
		return (
			typeof fm === 'object' &&
			fm !== null &&
			Object.prototype.hasOwnProperty.call(fm, 'extraboard')
		);
	}

	/** Synchronous board check from the metadata cache (path already indexed). */
	private isBoardPath(path: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== 'md') return false;
		return this.hasBoardKey(this.app.metadataCache.getFileCache(file)?.frontmatter);
	}

	/**
	 * Reliable board detection. Prefers the metadata cache but falls back to
	 * reading the file, so detection works even before Obsidian has indexed a
	 * just-opened file.
	 */
	private async isBoard(file: TFile): Promise<boolean> {
		if (file.extension !== 'md') return false;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache) return this.hasBoardKey(cache.frontmatter);
		try {
			const content = await this.app.vault.cachedRead(file);
			return parseFrontmatter(content).isBoard;
		} catch {
			return false;
		}
	}

	private convertLeafToBoard(leaf: WorkspaceLeaf, file: TFile): void {
		void leaf
			.setViewState({
				type: VIEW_TYPE_BOARD,
				state: { file: file.path },
				active: true,
			})
			.catch((err) => console.error('Extraboard: failed to open board view', err));
	}

	private async openAsBoard(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
		if (await this.isBoard(file)) {
			this.convertLeafToBoard(leaf, file);
		} else {
			new Notice('Not a board: add an "extraboard" key to the note frontmatter.');
		}
	}

	private async handleFileOpen(file: TFile): Promise<void> {
		const board = await this.isBoard(file);
		// When suppressed the user deliberately chose Markdown; openAsMarkdown has
		// already added the "Open as board" switch, so leave the leaf alone.
		const wantMarkdown = this.suppressed.has(file.path);
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== file.path) continue;
			if (!board) {
				// A plain note reusing this view: drop any stale switch button.
				this.removeBoardAction(view);
			} else if (!wantMarkdown) {
				// The patch missed this board (cold cache); convert it now.
				this.convertLeafToBoard(leaf, file);
			}
		}
	}

	/** Convert any already-open Markdown leaves that hold board files. */
	private async convertOpenBoards(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			if (await this.isBoard(view.file)) {
				this.convertLeafToBoard(leaf, view.file);
			}
		}
	}

	/** Add an "Open as board" action to a Markdown view (idempotent). */
	private addBoardAction(view: MarkdownView): void {
		if (this.boardActions.has(view)) return;
		const el = view.addAction(ICONS.board, 'Open as board', () => {
			const file = view.file;
			if (file) void this.openAsBoard(view.leaf, file);
		});
		this.boardActions.set(view, el);
	}

	private removeBoardAction(view: MarkdownView): void {
		const el = this.boardActions.get(view);
		if (el) {
			el.remove();
			this.boardActions.delete(view);
		}
	}

	/**
	 * Creating a board starts from `defaultProperties` and lets the user adjust
	 * the configuration *before* the file is written (settings.md); dismissing
	 * the dialog creates nothing.
	 */
	private createNewBoard(): void {
		new BoardSettingsModal(this.app, {
			config: newBoardConfig(cloneDefs(this.settings.defaultProperties)),
			title: 'New board',
			cta: 'Create',
			onSave: (config) => {
				void this.writeNewBoard(config);
			},
		}).open();
	}

	private async writeNewBoard(config: BoardConfig): Promise<void> {
		const active = this.app.workspace.getActiveFile();
		const parent = this.app.fileManager.getNewFileParent(active?.path ?? '');
		const path = this.uniqueBoardPath(parent);
		let file: TFile;
		try {
			file = await this.app.vault.create(path, newBoardText(config));
		} catch (err) {
			console.error('Extraboard: failed to create board', err);
			new Notice('Extraboard: could not create the board file.');
			return;
		}
		this.convertLeafToBoard(this.app.workspace.getLeaf('tab'), file);
	}

	private uniqueBoardPath(parent: TFolder): string {
		const dir = parent.isRoot() ? '' : parent.path;
		const make = (name: string) =>
			normalizePath(dir ? `${dir}/${name}` : name);
		let name = `${NEW_BOARD_BASENAME}.md`;
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(make(name))) {
			name = `${NEW_BOARD_BASENAME} ${i++}.md`;
		}
		return make(name);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ExtraboardSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
