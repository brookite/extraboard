// When digests and reminders are shown. Spec: docs/specs/digest-and-reminders.md
// §1–§4, §9.
//
// One question per check — "has the time come, and was it not shown yet?" —
// asked of every board open in some tab, loaded or deferred. Nothing scans the
// vault: a board nobody has open is not this module's business (NOTICES.md,
// "Board startup cost is a standing constraint").

import { TFile, type WorkspaceLeaf } from 'obsidian';
import type ExtraboardPlugin from '../main';
import { nowStamp } from '../model/dateHighlights';
import { today as todayOf } from '../model/dates';
import { DIGEST_KINDS, digestDue, digestSections, periodKey, type DigestKind } from '../model/digest';
import { parseBoard } from '../model/parse';
import { reminderSections, type ReminderRun } from '../model/reminders';
import { placesOf } from '../model/sections';
import type { Board } from '../model/types';
import { resolveWeekStart } from '../i18n/dates';
import { openDigestModal, type CollapseStore } from '../ui/DigestModal';
import { openRemindersModal } from '../ui/RemindersModal';
import { VIEW_TYPE_BOARD } from '../util/constants';
import type { BoardApi } from '../view/api';
import { BoardView } from '../view/BoardView';
import { pruneReminded, type BoardState } from './state';

/** A board open in some tab, by the path of its file. */
interface OpenBoard {
	path: string;
	leaf: WorkspaceLeaf;
}

/** What a check found due on one board. */
interface Due {
	digests: DigestKind[];
	runs: ReminderRun[];
}

/** A deferred leaf's loader, present from Obsidian 1.7.2 (feature-detected). */
interface MaybeDeferredLeaf {
	loadIfDeferred?(): Promise<void>;
}

export class BoardScheduler {
	private running = false;
	private again = false;
	/** `launch` reminders already evaluated this session, as `path#id`. */
	private launchSeen = new Set<string>();
	/** Parsed text of boards in deferred tabs, so the tick does not re-parse. */
	private parsed = new Map<string, { mtime: number; board: Board }>();
	/** Modals waiting for the one on screen to close. */
	private queue: ((done: () => void) => void)[] = [];
	private showing = false;

	constructor(private readonly plugin: ExtraboardPlugin) {}

	/** Ask for a check; a check already running runs once more instead. */
	request(): void {
		if (this.running) {
			this.again = true;
			return;
		}
		void this.run();
	}

	/** Forget a path's cached parse (its file moved or went). */
	forget(path: string): void {
		this.parsed.delete(path);
	}

	/** Show one board's digest now, whatever was shown before (the commands, §8). */
	showDigest(view: BoardView, kind: DigestKind): void {
		const board = view.board;
		const def = board?.config.digest?.[kind];
		const path = view.file?.path;
		if (!board || !def || !path) return;
		this.enqueue((done) => this.openDigest(path, view.leaf, view.getApi(), kind, done));
	}

	private async run(): Promise<void> {
		this.running = true;
		try {
			do {
				this.again = false;
				await this.check();
			} while (this.again);
		} catch (err) {
			console.error('Extraboard: digest and reminder check failed', err);
		} finally {
			this.running = false;
		}
	}

	/** Every board open in a tab, once per file; a loaded view wins over a deferred one. */
	private openBoards(): OpenBoard[] {
		const byPath = new Map<string, OpenBoard>();
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			const view = leaf.view;
			const path =
				view instanceof BoardView ? view.file?.path : leaf.getViewState().state?.file;
			if (typeof path !== 'string' || !path) continue;
			const known = byPath.get(path);
			if (!known || (view instanceof BoardView && !(known.leaf.view instanceof BoardView))) {
				byPath.set(path, { path, leaf });
			}
		}
		return [...byPath.values()];
	}

	/** The board as its view holds it, or read from disk for a deferred tab. */
	private async boardOf(open: OpenBoard): Promise<Board | null> {
		const view = open.leaf.view;
		if (view instanceof BoardView && view.file?.path === open.path) return view.board;
		const file = this.plugin.app.vault.getAbstractFileByPath(open.path);
		if (!(file instanceof TFile)) return null;
		const cached = this.parsed.get(open.path);
		if (cached && cached.mtime === file.stat.mtime) return cached.board;
		try {
			const board = parseBoard(await this.plugin.app.vault.cachedRead(file));
			this.parsed.set(open.path, { mtime: file.stat.mtime, board });
			return board;
		} catch {
			return null;
		}
	}

	/**
	 * The editing surface of the board's own view, loading a deferred tab first.
	 * Only called once something is due: a background tab stays unbuilt
	 * otherwise (§1).
	 */
	private async apiOf(open: OpenBoard): Promise<BoardApi | null> {
		let view = open.leaf.view;
		if (!(view instanceof BoardView)) {
			// Not on the minimum app version, so only ever reached through this
			// structural view of the leaf; an older app has no deferred tabs.
			const deferred = open.leaf as unknown as MaybeDeferredLeaf;
			if (typeof deferred.loadIfDeferred !== 'function') return null;
			await deferred.loadIfDeferred();
			view = open.leaf.view;
		}
		if (!(view instanceof BoardView) || !view.board || view.file?.path !== open.path) return null;
		return view.getApi();
	}

	private weekStartOf(def: { weekStart?: number }): number {
		return def.weekStart ?? resolveWeekStart(this.plugin.settings.weekStart);
	}

	private async check(): Promise<void> {
		const clock = new Date();
		const now = nowStamp(clock);
		const ms = clock.getTime();
		const store = this.plugin.boardStates;

		for (const open of this.openBoards()) {
			const board = await this.boardOf(open);
			const config = board?.config;
			if (!board || !config || (!config.digest && !config.reminders?.length)) continue;

			const before = store.get(open.path);
			const next: BoardState = {
				...before,
				...(before.digest && { digest: { ...before.digest } }),
			};
			const due: Due = { digests: [], runs: [] };
			const ctx = { config, today: todayOf(clock), where: placesOf(board) };

			for (const kind of DIGEST_KINDS) {
				const def = config.digest?.[kind];
				if (!def) continue;
				const weekStart = this.weekStartOf(def);
				if (!digestDue(kind, def, now, weekStart, before.digest?.[kind])) continue;
				next.digest = { ...next.digest, [kind]: periodKey(kind, now.date, weekStart) };
				const sections = digestSections(board, kind, def, { ...ctx, weekStart });
				// An empty digest is not shown, but its period still counts as done (§3.3).
				if (sections.current.length || sections.previous.done.length) due.digests.push(kind);
			}

			const reminded: Record<string, number> = { ...before.reminded };
			const launched: string[] = [];
			for (const def of config.reminders ?? []) {
				if (def.repeat === 'launch') {
					const key = `${open.path}#${def.id}`;
					if (this.launchSeen.has(key)) continue;
					launched.push(key);
					due.runs.push({ def, since: -Infinity, until: ms });
					continue;
				}
				const since = reminded[def.id];
				reminded[def.id] = ms;
				// A reminder seen for the first time starts now (§4.3).
				if (since !== undefined) due.runs.push({ def, since, until: ms });
			}
			const ids = (config.reminders ?? []).map((r) => r.id);
			const pruned = pruneReminded(reminded, ids);
			if (pruned) next.reminded = pruned;
			else delete next.reminded;
			due.runs = due.runs.filter((run) => reminderSections(board, [run], ctx).length > 0);

			if (due.digests.length || due.runs.length) {
				const api = await this.apiOf(open);
				// No view to edit through: leave everything unrecorded and try again
				// at the next check.
				if (!api) continue;
				for (const kind of due.digests) {
					this.enqueue((done) => this.openDigest(open.path, open.leaf, api, kind, done));
				}
				if (due.runs.length) {
					const runs = due.runs;
					this.enqueue((done) => this.openReminders(open.path, open.leaf, api, runs, done));
				}
			}
			for (const key of launched) this.launchSeen.add(key);

			if (JSON.stringify(next) !== JSON.stringify(before)) store.set(open.path, next);
		}
	}

	// --- modals -----------------------------------------------------------------

	private enqueue(show: (done: () => void) => void): void {
		this.queue.push(show);
		this.next();
	}

	private next(): void {
		if (this.showing) return;
		const show = this.queue.shift();
		if (!show) return;
		this.showing = true;
		show(() => {
			this.showing = false;
			this.next();
		});
	}

	private collapseFor(path: string): CollapseStore {
		return {
			get: (key) => this.plugin.boardStates.get(path).collapsed?.[key],
			set: (key, collapsed) => this.plugin.boardStates.setCollapsed(path, key, collapsed),
		};
	}

	/** "Open board", offered when the board is not the tab in front. */
	private openBoardFor(leaf: WorkspaceLeaf): (() => void) | undefined {
		const workspace = this.plugin.app.workspace;
		if (workspace.getActiveViewOfType(BoardView)?.leaf === leaf) return undefined;
		return () => {
			workspace.setActiveLeaf(leaf, { focus: true });
		};
	}

	private boardName(path: string): string {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file.basename : path;
	}

	private openDigest(path: string, leaf: WorkspaceLeaf, api: BoardApi, kind: DigestKind, done: () => void): void {
		const def = api.getBoard()?.config.digest?.[kind];
		if (!def) {
			done();
			return;
		}
		openDigestModal(this.plugin.app, {
			api,
			settings: this.plugin.settings,
			kind,
			def,
			weekStart: this.weekStartOf(def),
			boardName: this.boardName(path),
			collapse: this.collapseFor(path),
			openBoard: this.openBoardFor(leaf),
			onClose: done,
		});
	}

	private openReminders(
		path: string,
		leaf: WorkspaceLeaf,
		api: BoardApi,
		runs: ReminderRun[],
		done: () => void,
	): void {
		openRemindersModal(this.plugin.app, {
			api,
			settings: this.plugin.settings,
			runs,
			boardName: this.boardName(path),
			collapse: this.collapseFor(path),
			openBoard: this.openBoardFor(leaf),
			onClose: done,
		});
	}
}
