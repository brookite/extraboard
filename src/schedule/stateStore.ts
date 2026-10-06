// Where the plugin's `boardState` lives: the vault's `localStorage`, never
// `data.json`. Spec: docs/specs/digest-and-reminders.md §9. No `obsidian`
// imports — the host is anything with `loadLocalStorage` / `saveLocalStorage`
// (`App`, from Obsidian 1.8.7), so the store is testable on its own.
//
// A reminder's `lastChecked` changes on every 60 s check; kept in a synced
// `data.json` it made every device rewrite that file once a minute.

import {
	deleteBoardState,
	readBoardStates,
	renameBoardState,
	type BoardState,
	type BoardStates,
} from './state';

export const BOARD_STATE_KEY = 'extraboard-board-state';

export interface LocalStorageHost {
	loadLocalStorage(key: string): unknown;
	saveLocalStorage(key: string, data: unknown): void;
}

export class BoardStateStore {
	private constructor(
		private readonly host: LocalStorageHost,
		private states: BoardStates,
	) {}

	/**
	 * The device's stored state. A device with none yet starts from `legacy` —
	 * the `boardState` an earlier version kept in `data.json` — once.
	 */
	static open(host: LocalStorageHost, legacy?: unknown): BoardStateStore {
		const stored = host.loadLocalStorage(BOARD_STATE_KEY);
		const store = new BoardStateStore(host, readBoardStates(stored ?? legacy));
		if (stored == null && Object.keys(store.states).length) store.persist();
		return store;
	}

	get(path: string): BoardState {
		return this.states[path] ?? {};
	}

	/** Replace a board's state; an empty one drops the entry. */
	set(path: string, state: BoardState): void {
		if (Object.keys(state).length) this.states = { ...this.states, [path]: state };
		else this.states = deleteBoardState(this.states, path);
		this.persist();
	}

	setCollapsed(path: string, key: string, collapsed: boolean): void {
		const state = this.get(path);
		this.set(path, { ...state, collapsed: { ...state.collapsed, [key]: collapsed } });
	}

	/** A board file moved: its state goes with it. */
	rename(from: string, to: string): void {
		const next = renameBoardState(this.states, from, to);
		if (next === this.states) return;
		this.states = next;
		this.persist();
	}

	/** A board file was deleted: its state goes too. */
	delete(path: string): void {
		const next = deleteBoardState(this.states, path);
		if (next === this.states) return;
		this.states = next;
		this.persist();
	}

	private persist(): void {
		this.host.saveLocalStorage(BOARD_STATE_KEY, this.states);
	}
}
