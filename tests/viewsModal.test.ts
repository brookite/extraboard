import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { Board, ViewDef } from '../src/model/types';
import type { FilterNode } from '../src/model/filter';
import type { SortRule } from '../src/model/sort';
import type { BoardApi } from '../src/view/api';
import type { FilterSortModalOptions } from '../src/ui/FilterSortModal';
import { parseBoard } from '../src/model/parse';
import { boardHead } from './boardFile';
import { openViewsModal } from '../src/ui/ViewsModal';

const mocks = vi.hoisted(() => ({
	modals: [] as unknown[],
	openFilters: vi.fn<(app: App, options: FilterSortModalOptions) => void>(),
}));
vi.mock('obsidian', () => ({
	Modal: class {
		constructor(public app: App) { mocks.modals.push(this); }
		open() {}
		close() {}
	},
}));
vi.mock('../src/ui/FilterSortModal', () => ({ openFilterSortModal: mocks.openFilters }));

// Drive the real form callbacks without requiring Obsidian's DOM/Setting UI.
interface Fields {
	type: 'list';
	filter?: FilterNode;
	sorts?: SortRule[];
}
interface Form {
	fields: Fields;
	options: { openFilters(fields: Fields): void };
	finish(fields: Fields | null): void;
}
interface Manager {
	createView(): void;
	editView(view: ViewDef): void;
	render: () => void;
}

const filter: FilterNode = { kind: 'condition', field: { kind: 'builtin', id: 'title' }, op: 'contains', value: 'work' };
const sorts: SortRule[] = [{ field: { kind: 'builtin', id: 'title' }, dir: 'asc' }];

function setup() {
	let board = parseBoard(`${boardHead()}\n## Tasks\n\n- A card\n`);
	const update = vi.fn((mutate: (current: Board) => Board) => { board = mutate(board); });
	const api = { getBoard: () => board, update } as unknown as BoardApi;
	openViewsModal({} as App, { api, openBoardSettings: vi.fn() });
	const manager = mocks.modals[0] as Manager;
	manager.render = vi.fn();
	return { manager, update, board: () => board };
}

function form(): Form { return mocks.modals.at(-1) as Form; }
function filters(): FilterSortModalOptions {
	const call = mocks.openFilters.mock.lastCall;
	if (!call) throw new Error('Filter dialog did not open');
	return call[1];
}

beforeEach(() => {
	mocks.modals.length = 0;
	mocks.openFilters.mockClear();
});

describe('view creation filters', () => {
	it('opens filters before a view exists and saves them with the new list', async () => {
		const ctx = setup();
		ctx.manager.createView();
		const draft = form();
		draft.fields.type = 'list';
		draft.options.openFilters(draft.fields);
		filters().onApply({ filter, sorts });
		expect(ctx.update).not.toHaveBeenCalled();
		draft.options.openFilters(draft.fields);
		expect(filters().filter).toEqual(filter);
		expect(filters().sorts).toEqual(sorts);
		draft.finish(draft.fields);
		await Promise.resolve();
		expect(ctx.board().config.views.at(-1)).toMatchObject({ type: 'list', filter, sorts });
	});

	it('discards draft filters when creation is cancelled', async () => {
		const ctx = setup();
		ctx.manager.createView();
		const draft = form();
		draft.fields.type = 'list';
		draft.options.openFilters(draft.fields);
		filters().onApply({ filter, sorts });
		draft.finish(null);
		await Promise.resolve();
		expect(ctx.update).not.toHaveBeenCalled();
		expect(ctx.board().config.views).toHaveLength(1);
	});

	it('allows clearing a previously configured draft filter and sorts', async () => {
		const ctx = setup();
		ctx.manager.createView();
		const draft = form();
		draft.fields.type = 'list';
		draft.options.openFilters(draft.fields);
		filters().onApply({ filter, sorts });
		draft.options.openFilters(draft.fields);
		filters().onApply({ filter: null, sorts: [] });
		draft.finish(draft.fields);
		await Promise.resolve();
		const view = ctx.board().config.views.at(-1);
		expect(view?.type).toBe('list');
		expect(view).not.toHaveProperty('filter');
		expect(view).not.toHaveProperty('sorts');
	});
});
