// MIGRATION from 0.7.0, to be deleted together with src/schedule/legacyBoardState.ts.

import { describe, expect, it } from 'vitest';
import { migrateLegacyBoardState } from '../src/schedule/legacyBoardState';
import { BOARD_STATE_KEY, BoardStateStore, type LocalStorageHost } from '../src/schedule/stateStore';

function fakeHost(initial?: unknown): LocalStorageHost & { data: Map<string, unknown>; writes: number } {
	const data = new Map<string, unknown>();
	if (initial !== undefined) data.set(BOARD_STATE_KEY, initial);
	const host = {
		data,
		writes: 0,
		loadLocalStorage: (key: string) => data.get(key) ?? null,
		saveLocalStorage: (key: string, value: unknown) => {
			host.writes++;
			data.set(key, value);
		},
	};
	return host;
}

describe('migrateLegacyBoardState', () => {
	it('adopts the data.json block on a device without local state, and strips it', () => {
		const host = fakeHost();
		const stored = { language: 'ru', boardState: { 'a.md': { digest: { daily: '2026-10-02' } } } };
		const { rest, found } = migrateLegacyBoardState(host, stored);
		expect(found).toBe(true);
		expect(rest).toEqual({ language: 'ru' });
		expect(host.data.get(BOARD_STATE_KEY)).toEqual({ 'a.md': { digest: { daily: '2026-10-02' } } });
		expect(BoardStateStore.open(host).get('a.md')).toEqual({ digest: { daily: '2026-10-02' } });
	});

	it('ignores the block once the device has its own state, but still strips it', () => {
		const host = fakeHost({ 'a.md': { digest: { daily: '2026-10-02' } } });
		const { rest, found } = migrateLegacyBoardState(host, {
			language: 'ru',
			boardState: { 'a.md': { digest: { daily: '2020-01-01' } } },
		});
		expect(found).toBe(true);
		expect(rest).toEqual({ language: 'ru' });
		expect(host.writes).toBe(0);
	});

	it('does nothing without the block, an empty one or no data.json', () => {
		const host = fakeHost();
		const plain: { language: string; boardState?: unknown } = { language: 'ru' };
		expect(migrateLegacyBoardState(host, plain)).toEqual({ rest: { language: 'ru' }, found: false });
		expect(migrateLegacyBoardState(host, null)).toEqual({ rest: {}, found: false });
		expect(migrateLegacyBoardState(host, { boardState: {} }).found).toBe(true);
		expect(host.writes).toBe(0);
	});
});
