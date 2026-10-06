// MIGRATION from 0.7.0, to be deleted: up to that version `boardState` was a key
// of `data.json`; it now lives in `localStorage` (stateStore.ts). Remove this
// file, its test (tests/legacyBoardState.test.ts) and the one call in
// `main.ts:loadSettings` once no 0.7.0 install is expected to update any more
// (docs/NOTICES.md, "Device-local state").

import { readBoardStates } from './state';
import { BOARD_STATE_KEY, type LocalStorageHost } from './stateStore';

/**
 * Takes `boardState` out of the loaded `data.json` content. A device with no
 * local state yet adopts that block (once); `found` says the key was there, so
 * the caller saves `data.json` without it.
 */
export function migrateLegacyBoardState<T extends { boardState?: unknown }>(
	host: LocalStorageHost,
	stored: T | null,
): { rest: Omit<T, 'boardState'>; found: boolean } {
	const { boardState, ...rest } = stored ?? ({} as T);
	if (boardState !== undefined && host.loadLocalStorage(BOARD_STATE_KEY) == null) {
		const states = readBoardStates(boardState);
		if (Object.keys(states).length) host.saveLocalStorage(BOARD_STATE_KEY, states);
	}
	return { rest, found: boardState !== undefined };
}
