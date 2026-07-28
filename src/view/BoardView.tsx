// Custom file view for Extraboard boards. Extends TextFileView so Obsidian
// manages the underlying Markdown file (load/save, tab, rename, delete).
// Spec: docs/specs/kanban-view.md §1, §6.

import { HoverPopover, Menu, Notice, Platform, TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';
import { render } from 'preact';
import type ExtraboardPlugin from '../main';
import type { Board } from '../model/types';
import { highlightsFor } from '../model/dateHighlights';
import { archiveOpts, type ExtraboardSettings } from '../settings';
import * as ops from '../model/ops';
import { parseBoard } from '../model/parse';
import { serializeBoard } from '../model/serialize';
import { activeViewOf } from '../model/views';
import { ArchiveModal } from '../ui/ArchiveModal';
import { BoardSettingsModal } from '../ui/BoardSettingsModal';
import { pickColor } from '../ui/ColorPicker';
import { openViewsModal } from '../ui/ViewsModal';
import { createCardNote, resolveNoteFolder } from '../util/cardNote';
import { ICONS, VIEW_TYPE_BOARD, viewIcon } from '../util/constants';
import { BoardApi, confirmDestructive, searchTag } from './api';
import { CalendarView } from './CalendarView';
import { KanbanView, addStack } from './KanbanView';
import { NowContext, currentNow } from './now';
import { ReloadContext } from './reload';
import { t } from '../i18n';

export class BoardView extends TextFileView {
	plugin: ExtraboardPlugin;
	board: Board | null = null;
	/** Owner of the hover previews raised by card links (`HoverParent`). */
	hoverPopover: HoverPopover | null = null;
	private mountEl?: HTMLElement;
	private api: BoardApi;
	/** The view-switch header action, re-iconed whenever the active view changes. */
	private viewSwitchEl?: HTMLElement;
	/** The view cycler beside it; hidden while the board has a single view. */
	private viewCycleEl?: HTMLElement;
	/** The in-board "now showing <view>" indicator, and the timer that fades it. */
	private indicatorEl?: HTMLElement;
	private indicatorTimer?: number;
	/** Board-change subscribers outside the board's own tree (`BoardApi.onChange`). */
	private listeners = new Set<() => void>();
	/**
	 * The settings as the rendered tree last saw them. Its **identity** is how a
	 * display-setting change reaches memoized components: `refresh()` replaces the
	 * snapshot, every `memo` misses and the board redraws in full, while the
	 * minute tick leaves it alone and redraws only the date badges
	 * (m10-perf.md §2, §5). Never written to.
	 */
	private settingsSnapshot: ExtraboardSettings;
	/**
	 * Advanced only by a re-parse in `setViewData` — an *external* change to the
	 * file. Open inline editors close on it, because their position-keyed state
	 * would otherwise point at whatever landed at their index (`view/reload.ts`).
	 */
	private reloadToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: ExtraboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.settingsSnapshot = { ...plugin.settings };
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
			manageViews: () => this.manageViews(),
			onChange: (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
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
		// Six actions do not fit a phone's header, so on mobile only the view swap
		// stays and the other five live in the ⋯ menu — which `fillMenu` builds,
		// from the same list the file menu gets. No action is lost, only moved
		// (mobile.md §4).
		const full = !Platform.isMobile;

		// The switch wears the active view's own icon and opens the view menu
		// (views.md §3.1); it is created first so it sits leftmost in the header.
		if (full) {
			this.viewSwitchEl = this.addAction(ICONS.board, t('action.views'), (event) => {
				this.openViewMenu(event);
			});
		}
		// One tap to the next view, beside the menu that picks one by name. It is
		// hidden while the board has a single view — there would be nothing to
		// cycle — and `renderBoard` is what reveals it (views.md §3.3). This is the
		// action that stays on a phone: switching views is the most frequent thing
		// a board is asked for.
		this.viewCycleEl = this.addAction(ICONS.switchView, t('action.switchBoardView'), () => {
			this.nextView();
		});
		if (!full) return;

		this.addAction(ICONS.add, t('action.addStack'), () => this.addStack());
		// The archive is reached often enough to deserve the header, not only the
		// file menu (user decision, 2026-07-26).
		this.addAction(ICONS.archive, t('menu.file.openArchive'), () => this.openArchive());
		this.addAction(ICONS.settings, t('command.boardSettings'), () => this.openBoardSettings());
		this.addAction(ICONS.markdown, t('action.openAsMarkdown'), () => {
			void this.openAsMarkdown();
		});
	}

	override async onClose(): Promise<void> {
		this.clearViewIndicator();
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
		this.reloadToken++;
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

	/**
	 * Re-render with the current plugin settings (after the settings tab or the
	 * theme changed). A fresh snapshot is what makes this a *full* redraw rather
	 * than the memoized near-no-op `tick()` is.
	 */
	refresh(): void {
		this.settingsSnapshot = { ...this.plugin.settings };
		this.renderBoard();
	}

	/**
	 * The minute tick (i18n-and-dates.md §2.5): re-render so the `NowContext`
	 * value can advance. Everything memoized stays skipped, so this costs the
	 * date badges and nothing else.
	 */
	tick(): void {
		this.renderBoard();
	}

	/**
	 * Whether a tick can change a pixel on this board. Relative formats and date
	 * highlights are the two things that move on their own; a calendar also marks
	 * today, which turns over at midnight. Nothing else is time-dependent, so
	 * nothing else is worth a re-render (m10-perf.md §5).
	 */
	isTimeDependent(): boolean {
		const board = this.board;
		if (!board) return false;
		const settings = this.plugin.settings;
		if (settings.dateFormat === 'relative' || settings.timeFormat === 'relative') return true;
		if (highlightsFor(board.config, settings.dateHighlights).length > 0) return true;
		return activeViewOf(board.config).type === 'calendar';
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

	/**
	 * The view menu: one item per view with the active one checked, then the way
	 * into the manage-views modal (views.md §3.1).
	 */
	private openViewMenu(event: MouseEvent): void {
		if (!this.board) return;
		const menu = new Menu();
		this.addViewItems(menu);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('menu.file.manageViews'))
				.setIcon(ICONS.views)
				.onClick(() => this.manageViews()),
		);
		menu.showAtMouseEvent(event);
	}

	/** One item per view, the active one checked. Flat, so it reads the same on a phone. */
	private addViewItems(menu: Menu): void {
		const board = this.board;
		if (!board) return;
		for (const view of board.config.views) {
			menu.addItem((item) =>
				item
					.setTitle(view.name)
					.setIcon(viewIcon(view.type))
					.setChecked(view.id === board.config.activeView)
					.onClick(() => {
						this.applyEdit((b) => ops.setActiveView(b, view.id));
					}),
			);
		}
	}

	/**
	 * Every board-wide action, in one place. Obsidian's own `onPaneMenu` raises
	 * the `file-menu` event for the ⋯ button too, so the single handler in
	 * `main.ts` feeds both menus from here — which is what makes the five actions
	 * the mobile header gives up reachable (mobile.md §4).
	 */
	fillMenu(menu: Menu): void {
		if (!this.board) return;
		this.addViewItems(menu);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('menu.file.manageViews'))
				.setIcon(ICONS.views)
				.onClick(() => this.manageViews()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('action.addStack'))
				.setIcon(ICONS.add)
				.onClick(() => this.addStack()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('menu.file.openArchive'))
				.setIcon('archive')
				.onClick(() => this.openArchive()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('menu.file.archiveCompletedCards'))
				.setIcon('check-check')
				.onClick(() => this.archiveCompletedCards()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('menu.file.deleteUntitledCards'))
				.setIcon('eraser')
				.onClick(() => this.deleteUntitledCards()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('command.boardSettings'))
				.setIcon(ICONS.settings)
				.onClick(() => this.openBoardSettings()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t('action.openAsMarkdown'))
				.setIcon(ICONS.markdown)
				.onClick(() => {
					void this.openAsMarkdown();
				}),
		);
	}

	/** Open the manage-views modal (menu item, file menu and command). */
	manageViews(): void {
		if (!this.board) return;
		openViewsModal(this.app, {
			api: this.api,
			openBoardSettings: () => this.openBoardSettings(),
		});
	}

	/**
	 * Activate the next view (the `next-view` command). The indicator is the whole
	 * feedback a palette user gets that the switch happened.
	 */
	nextView(): void {
		const board = this.board;
		if (!board || board.config.views.length < 2) return;
		this.applyEdit((b) => ops.nextView(b));
		if (this.board) this.showViewIndicator(activeViewOf(this.board.config).name);
	}

	/**
	 * Name the view that just became active, inside the board itself. A `Notice`
	 * covers the whole top button bar on a phone, so this replaces it on both
	 * platforms — one behaviour to reason about (mobile.md §4). It lives beside
	 * the Preact mount rather than inside it, so a re-render cannot drop it
	 * mid-fade.
	 */
	private showViewIndicator(name: string): void {
		if (!this.indicatorEl) {
			this.indicatorEl = this.contentEl.createDiv({ cls: 'eb-view-indicator' });
		}
		const el = this.indicatorEl;
		el.setText(name);
		window.clearTimeout(this.indicatorTimer);
		// Restart the fade even when the same element is reused: dropping the class
		// and forcing a reflow is what makes a second switch animate again.
		el.removeClass('is-visible');
		void el.offsetWidth;
		el.addClass('is-visible');
		this.indicatorTimer = window.setTimeout(() => {
			el.removeClass('is-visible');
			this.indicatorTimer = undefined;
		}, 1200);
	}

	private clearViewIndicator(): void {
		window.clearTimeout(this.indicatorTimer);
		this.indicatorTimer = undefined;
		this.indicatorEl?.remove();
		this.indicatorEl = undefined;
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
		new ArchiveModal(this.app, this.api, this.plugin.settings, () =>
			void this.plugin.saveSettings(),
		).open();
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
			new Notice(t('notice.noCompletedCards'));
			return;
		}
		this.applyEdit((b) => ops.archiveCompletedCards(b, archiveOpts(this.plugin.settings)));
		new Notice(
			count === 1
				? t('notice.archivedOne')
				: t('notice.archivedMany', { count }),
		);
	}

	// --- internals ---

	private ensureMount(): HTMLElement {
		if (!this.mountEl) {
			// The indicator is positioned against this, so the container it sits in
			// has to be the positioned one.
			this.contentEl.addClass('eb-content');
			this.mountEl = this.contentEl.createDiv({ cls: 'eb-root' });
			this.collapseRightSidebar();
		}
		return this.mountEl;
	}

	/**
	 * Backlinks and outline say nothing useful about a board and cost width plus
	 * an edge swipe that competes with the stack row, so the right split folds
	 * when a board opens on mobile (mobile.md §4). Once per leaf and mobile only:
	 * the user may open it again and the plugin does not fight that.
	 */
	private collapseRightSidebar(): void {
		if (!Platform.isMobile) return;
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.rightSplit?.collapse();
		});
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

	/**
	 * Mount **one** view — whichever is active (views.md §3.4). An inactive view
	 * costs nothing but its lines in the settings block.
	 */
	private renderBoard(): void {
		const el = this.ensureMount();
		if (!this.board) {
			render(<div class="eb-empty">{t('board.parseError')}</div>, el);
			return;
		}
		const views = this.board.config.views;
		const view = activeViewOf(this.board.config);
		if (this.viewSwitchEl) {
			setIcon(this.viewSwitchEl, viewIcon(view.type));
			this.viewSwitchEl.setAttribute('aria-label', t('action.viewAria', { name: view.name }));
		}
		if (this.viewCycleEl) {
			// Creating or deleting a view is what makes the cycler appear or go, and
			// its tooltip names where it goes — a blind cycler is worth little.
			this.viewCycleEl.toggle(views.length > 1);
			const at = views.findIndex((v) => v.id === view.id);
			const next = views[(at + 1) % views.length];
			if (next) {
				this.viewCycleEl.setAttribute('aria-label', t('action.switchToAria', { name: next.name }));
			}
		}
		// One provider around whichever view is mounted: the clock is read by the
		// date badges and the calendar's "today", both of them under a `memo`
		// that would otherwise freeze them (m10-perf.md §2.3).
		const settings = this.settingsSnapshot;
		render(
			<NowContext.Provider value={currentNow()}>
				<ReloadContext.Provider value={this.reloadToken}>
					{view.type === 'calendar' ? (
						<CalendarView board={this.board} view={view} api={this.api} settings={settings} />
					) : (
						<KanbanView board={this.board} api={this.api} settings={settings} />
					)}
				</ReloadContext.Provider>
			</NowContext.Provider>,
			el,
		);
		// Anything living outside this tree (the day modal) re-reads the board here.
		for (const listener of this.listeners) listener();
	}

	async openAsMarkdown(): Promise<void> {
		const file = this.file;
		if (!file) return;
		this.plugin.suppressAutoOpen(file.path);
		await this.leaf.setViewState({ type: 'markdown', state: { file: file.path } });
		// Changing the view type does not re-fire file-open, so add the switch
		// back to the board directly on the freshly created Markdown view.
		this.plugin.showBoardSwitch(this.leaf);
	}
}
