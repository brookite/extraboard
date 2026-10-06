// The device-local `boardState` store (digest-and-reminders.md §9).

import { describe, expect, it } from 'vitest';
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
			if (value === null) data.delete(key);
			else data.set(key, value);
		},
	};
	return host;
}

describe('BoardStateStore', () => {
	it('reads what the device stored, ignoring junk', () => {
		const host = fakeHost({ 'a.md': { reminded: { r1: 5 } }, 'b.md': 'junk' });
		const store = BoardStateStore.open(host);
		expect(store.get('a.md')).toEqual({ reminded: { r1: 5 } });
		expect(store.get('b.md')).toEqual({});
		expect(host.writes).toBe(0);
	});

	it('persists sets, collapses, renames and deletes', () => {
		const host = fakeHost();
		const store = BoardStateStore.open(host);
		store.set('a.md', { reminded: { r1: 1 } });
		store.setCollapsed('a.md', 'digest:daily:done', false);
		expect(host.data.get(BOARD_STATE_KEY)).toEqual({
			'a.md': { reminded: { r1: 1 }, collapsed: { 'digest:daily:done': false } },
		});

		store.rename('a.md', 'b.md');
		expect(store.get('a.md')).toEqual({});
		expect(store.get('b.md').reminded).toEqual({ r1: 1 });

		const writes = host.writes;
		store.rename('x.md', 'y.md');
		store.delete('x.md');
		expect(host.writes).toBe(writes);

		store.delete('b.md');
		expect(host.data.get(BOARD_STATE_KEY)).toEqual({});
	});

	it('drops the entry when its state is emptied', () => {
		const host = fakeHost();
		const store = BoardStateStore.open(host);
		store.set('a.md', { reminded: { r1: 1 } });
		store.set('a.md', {});
		expect(host.data.get(BOARD_STATE_KEY)).toEqual({});
	});
});
