import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	TFolder,
	WorkspaceLeaf,
	normalizePath,
} from 'obsidian';
import { DEFAULT_SETTINGS, ExtraboardSettings } from './settings';
import { BoardView } from './view/BoardView';
import { ICONS, VIEW_TYPE_BOARD } from './util/constants';
import { NEW_BOARD_BASENAME, NEW_BOARD_TEMPLATE } from './util/newBoard';
import { parseFrontmatter } from './model/frontmatter';

export default class ExtraboardPlugin extends Plugin {
	settings!: ExtraboardSettings;
	/** Files the user just switched to Markdown; skip one auto-open for them. */
	private suppressed = new Set<string>();

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_BOARD,
			(leaf: WorkspaceLeaf) => new BoardView(leaf, this),
		);

		this.addRibbonIcon(ICONS.board, 'Create new board', () => {
			void this.createNewBoard();
		});

		this.addCommand({
			id: 'create-board',
			name: 'Create new board',
			callback: () => {
				void this.createNewBoard();
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

		// Auto-open board files that land in a Markdown leaf.
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				void this.handleFileOpen(file);
			}),
		);
	}

	onunload() {}

	/** Suppress the next auto-open for a path (used when switching to Markdown). */
	suppressAutoOpen(path: string): void {
		this.suppressed.add(path);
	}

	/**
	 * Reliable board detection. Prefers the metadata cache but falls back to
	 * reading the file, so detection works even before Obsidian has indexed a
	 * just-opened file.
	 */
	private async isBoard(file: TFile): Promise<boolean> {
		if (file.extension !== 'md') return false;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache) {
			return (
				cache.frontmatter !== undefined &&
				Object.prototype.hasOwnProperty.call(cache.frontmatter, 'extraboard')
			);
		}
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

	private async handleFileOpen(file: TFile | null): Promise<void> {
		if (!file) return;
		if (this.suppressed.has(file.path)) {
			this.suppressed.delete(file.path);
			return;
		}
		if (!(await this.isBoard(file))) return;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				this.convertLeafToBoard(leaf, file);
			}
		}
	}

	private async createNewBoard(): Promise<void> {
		const active = this.app.workspace.getActiveFile();
		const parent = this.app.fileManager.getNewFileParent(active?.path ?? '');
		const path = this.uniqueBoardPath(parent);
		let file: TFile;
		try {
			file = await this.app.vault.create(path, NEW_BOARD_TEMPLATE);
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
