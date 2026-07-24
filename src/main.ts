import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ExtraboardSettings } from './settings';
import { BoardView } from './view/BoardView';
import { ICONS, VIEW_TYPE_BOARD } from './util/constants';

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

		this.addRibbonIcon(ICONS.board, 'Open as board', () => {
			this.openActiveAsBoard();
		});

		this.addCommand({
			id: 'open-as-board',
			name: 'Open current file as board',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file ?? null;
				const ok = view !== null && file !== null && this.isBoardFile(file);
				if (ok && !checking) this.openActiveAsBoard();
				return ok;
			},
		});

		// Auto-open board files that land in a Markdown leaf.
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => this.handleFileOpen(file)),
		);
	}

	onunload() {}

	/** A file is a board iff its cached frontmatter has a top-level `extraboard`. */
	isBoardFile(file: TFile): boolean {
		if (file.extension !== 'md') return false;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return fm !== undefined && Object.prototype.hasOwnProperty.call(fm, 'extraboard');
	}

	/** Suppress the next auto-open for a path (used when switching to Markdown). */
	suppressAutoOpen(path: string): void {
		this.suppressed.add(path);
	}

	private openActiveAsBoard(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? this.app.workspace.getActiveFile();
		const leaf = view?.leaf ?? this.app.workspace.getMostRecentLeaf();
		if (!file || !leaf) return;
		if (!this.isBoardFile(file)) return;
		void leaf.setViewState({ type: VIEW_TYPE_BOARD, state: { file: file.path } });
	}

	private handleFileOpen(file: TFile | null): void {
		if (!file) return;
		if (this.suppressed.has(file.path)) {
			this.suppressed.delete(file.path);
			return;
		}
		if (!this.isBoardFile(file)) return;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) {
				void leaf.setViewState({ type: VIEW_TYPE_BOARD, state: { file: file.path } });
			}
		}
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
