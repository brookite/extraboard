// M8 part A: the board's view list. Spec: docs/specs/views.md.

import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import * as ops from '../src/model/ops';
import { activeViewOf, nextViewId, validateViews } from '../src/model/views';
import type { Board } from '../src/model/types';

/** A board file whose settings block carries `settings`. */
const boardText = (settings: Record<string, unknown>, frontmatter = 'extraboard: true\n'): string =>
	`---\n${frontmatter}---\n` +
	'```extraboard-settings\n' +
	JSON.stringify({ version: 1, ...settings }, null, 2) +
	'\n```\n\n## To do\n\n- A card\n';

const parse = (settings: Record<string, unknown>): Board => parseBoard(boardText(settings));

const DATE_PROPS = {
	properties: [
		{ name: 'due', type: 'datetime' },
		{ name: 'sprint', type: 'date-range' },
	],
};

describe('views: parsing', () => {
	it('reads a view list and its active view', () => {
		const board = parse({
			activeView: 'v2',
			views: [
				{ id: 'v1', name: 'Board', type: 'kanban' },
				{ id: 'v2', name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'week' },
			],
			...DATE_PROPS,
		});
		expect(board.config.views).toEqual([
			{ id: 'v1', name: 'Board', type: 'kanban' },
			{ id: 'v2', name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'week' },
		]);
		expect(activeViewOf(board.config).name).toBe('Due dates');
	});

	it('falls back to the first view when activeView is unknown or absent', () => {
		const views = [{ id: 'v1', name: 'Board', type: 'kanban' }];
		expect(activeViewOf(parse({ activeView: 'nope', views }).config).id).toBe('v1');
		expect(activeViewOf(parse({ views }).config).id).toBe('v1');
	});

	it('drops a view that cannot be one, and a calendar with no date property', () => {
		const board = parse({
			views: [
				{ id: 'v1', name: 'Board', type: 'kanban' },
				{ id: 'v2', name: 'Broken', type: 'nonsense' },
				{ id: 'v3', name: 'Dateless', type: 'calendar' },
				'not-a-mapping',
			],
		});
		expect(board.config.views.map((v) => v.id)).toEqual(['v1']);
	});

	it('generates ids for a hand-written list and de-duplicates them', () => {
		const board = parse({
			views: [
				{ name: 'One', type: 'kanban' },
				{ name: 'Two', type: 'calendar', dateProperty: 'due' },
				{ id: 'v1', name: 'Three', type: 'calendar', dateProperty: 'due' },
			],
			...DATE_PROPS,
		});
		expect(board.config.views.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
	});

	it('defaults an empty name and an unknown mode', () => {
		const board = parse({
			views: [{ id: 'v1', name: '  ', type: 'calendar', dateProperty: 'due', mode: 'decade' }],
			...DATE_PROPS,
		});
		expect(board.config.views[0]).toEqual({
			id: 'v1',
			name: 'Calendar',
			type: 'calendar',
			dateProperty: 'due',
			mode: 'month',
		});
	});

	it('always leaves at least one view, even for an empty list', () => {
		expect(parse({ views: [] }).config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
	});

	it('defaults the whole list when the settings block is missing or unreadable', () => {
		const noBlock = parseBoard('---\nextraboard: true\n---\n\n## To do\n');
		expect(noBlock.config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
		const broken = parseBoard('---\nextraboard: true\n---\n```extraboard-settings\n{ nope\n```\n\n## To do\n');
		expect(broken.config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
		// An unreadable block is replaced, not duplicated, on the next save.
		expect(broken.preamble).not.toContain('nope');
	});
});

describe('views: serialization', () => {
	it('writes the list into the settings block', () => {
		const board = parse({
			views: [{ id: 'v2', name: 'Deadlines', type: 'calendar', dateProperty: 'due', mode: 'month' }],
			...DATE_PROPS,
		});
		const text = serializeBoard(ops.updateView(board, 'v2', { name: 'Due soon' }));
		expect(text).toContain('```extraboard-settings');
		expect(text).toContain('"name": "Due soon"');
	});

	it('omits activeView while the first view is active, and writes it otherwise', () => {
		const board = parse({ ...DATE_PROPS });
		const one = ops.addView(board, { name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'month' }, false);
		expect(serializeBoard(one)).not.toContain('activeView');
		const switched = ops.setActiveView(one, one.config.views[1]!.id);
		expect(serializeBoard(switched)).toContain('"activeView": "v2"');
	});

	it('is a fixed point', () => {
		const once = serializeBoard(ops.addView(parse({}), { name: 'Second', type: 'kanban' }, false));
		expect(serializeBoard(parseBoard(once))).toBe(once);
	});

	it('preserves foreign frontmatter through a view edit', () => {
		const text = boardText({}, 'title: My board\nextraboard: true\n');
		const out = serializeBoard(ops.addView(parseBoard(text), { name: 'Second', type: 'kanban' }));
		expect(out).toContain('title: My board');
	});

	it('adds the marker to a board file that lost it', () => {
		const out = serializeBoard(ops.addStack(parseBoard(boardText({}, 'title: My board\n')), 'Later'));
		expect(out).toContain('extraboard: true');
		expect(out).toContain('title: My board');
	});
});

describe('views: ops (§2.4)', () => {
	const twoViews = (): Board =>
		parse({
			views: [
				{ id: 'v1', name: 'Board', type: 'kanban' },
				{ id: 'v2', name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'month' },
			],
			...DATE_PROPS,
		});

	it('setActiveView ignores the current view and unknown ids', () => {
		const board = twoViews();
		expect(ops.setActiveView(board, 'v1')).toBe(board);
		expect(ops.setActiveView(board, 'nope')).toBe(board);
		expect(ops.setActiveView(board, 'v2').config.activeView).toBe('v2');
	});

	it('nextView wraps, and does nothing with a single view', () => {
		const board = twoViews();
		const second = ops.nextView(board);
		expect(second.config.activeView).toBe('v2');
		expect(ops.nextView(second).config.activeView).toBe('v1');
		const single = parse({});
		expect(ops.nextView(single)).toBe(single);
	});

	it('addView assigns the lowest free id and can activate the new view', () => {
		const board = ops.addView(twoViews(), { name: 'Sprint', type: 'calendar', dateProperty: 'sprint', mode: 'week' });
		expect(board.config.views[2]?.id).toBe('v3');
		expect(board.config.activeView).toBe('v3');
		expect(nextViewId(board.config.views)).toBe('v4');
	});

	it('updateView patches name, mode and date property', () => {
		const board = ops.updateView(twoViews(), 'v2', { name: 'Deadlines', mode: 'week', dateProperty: 'sprint' });
		expect(board.config.views[1]).toEqual({
			id: 'v2',
			name: 'Deadlines',
			type: 'calendar',
			dateProperty: 'sprint',
			mode: 'week',
		});
	});

	it('updateView is a no-op for an unknown id or an unchanged patch', () => {
		const board = twoViews();
		expect(ops.updateView(board, 'nope', { name: 'x' })).toBe(board);
		expect(ops.updateView(board, 'v2', { name: 'Due dates', mode: 'month' })).toBe(board);
	});

	it('deleteView refuses the last view and re-homes the active one', () => {
		const single = parse({});
		expect(ops.deleteView(single, 'v1')).toBe(single);
		const board = ops.setActiveView(twoViews(), 'v2');
		const left = ops.deleteView(board, 'v2');
		expect(left.config.views.map((v) => v.id)).toEqual(['v1']);
		expect(left.config.activeView).toBe('v1');
	});

	it('moveView reorders and leaves an unchanged order alone', () => {
		const board = twoViews();
		expect(ops.moveView(board, 'v2', 0).config.views.map((v) => v.id)).toEqual(['v2', 'v1']);
		expect(ops.moveView(board, 'v1', 2).config.views.map((v) => v.id)).toEqual(['v2', 'v1']);
		expect(ops.moveView(board, 'v2', null)).toBe(board);
		expect(ops.moveView(board, 'nope', 0)).toBe(board);
	});
});

describe('views: validation (§2.2)', () => {
	it('reports a second Kanban view', () => {
		const board = ops.addView(parse({}), { name: 'Another', type: 'kanban' });
		expect(validateViews(board.config)).toContainEqual({ kind: 'tooManyKanban' });
	});

	it('reports a calendar whose property is gone or is not a date', () => {
		const titleOnly = { properties: [{ name: 'title', type: 'string' }] };
		const board = parse({
			views: [{ id: 'v1', name: 'Due', type: 'calendar', dateProperty: 'due' }],
			...titleOnly,
		});
		expect(validateViews(board.config)).toContainEqual({
			kind: 'missingDateProperty',
			name: 'Due',
			property: 'due',
		});

		const retyped = parse({
			views: [{ id: 'v1', name: 'Due', type: 'calendar', dateProperty: 'title' }],
			...titleOnly,
		});
		expect(validateViews(retyped.config)).toContainEqual({
			kind: 'wrongDatePropertyType',
			name: 'Due',
			property: 'title',
			type: 'string',
		});
	});

	it('accepts a healthy board', () => {
		const board = parse({
			views: [
				{ id: 'v1', name: 'Board', type: 'kanban' },
				{ id: 'v2', name: 'Due', type: 'calendar', dateProperty: 'due' },
			],
			...DATE_PROPS,
		});
		expect(validateViews(board.config)).toEqual([]);
	});
});

// --- list views (M13) -------------------------------------------------------
// Spec: docs/specs/list-view.md §5.

describe('views: list views', () => {
	const LIST = {
		id: 'v1',
		name: 'All tasks',
		type: 'list',
		controls: 'fixed',
		sort: { property: 'due', dir: 'desc' },
		tags: ['bug'],
		sections: {
			'': { collapsed: true },
			Backlog: { sort: { property: 'due', dir: 'asc' }, tags: ['ops'] },
		},
	};

	it('reads every list key back', () => {
		const view = parse({ views: [LIST], ...DATE_PROPS }).config.views[0]!;
		expect(view).toEqual({
			id: 'v1',
			name: 'All tasks',
			type: 'list',
			controls: 'fixed',
			sort: { property: 'due', dir: 'desc' },
			tags: ['bug'],
			sections: {
				'': { collapsed: true },
				Backlog: { sort: { property: 'due', dir: 'asc' }, tags: ['ops'] },
			},
		});
	});

	it('round-trips a full list view unchanged', () => {
		const text = boardText({ views: [LIST], ...DATE_PROPS });
		expect(serializeBoard(parseBoard(text))).toBe(text);
	});

	it('defaults the controls mode and omits it when it is the default', () => {
		const board = parse({ views: [{ id: 'v1', name: 'L', type: 'list', controls: 'nonsense' }] });
		const view = board.config.views[0]!;
		expect(view.type === 'list' && view.controls).toBe('dynamic');
		expect(serializeBoard(board)).not.toContain('controls');
	});

	it('drops display state it cannot read, and keeps the view', () => {
		const view = parse({
			views: [
				{
					id: 'v1',
					name: 'L',
					type: 'list',
					sort: { dir: 'asc' },
					tags: ['#bug', '  ', 7, 'bug'],
					sections: { Backlog: 'nope', Other: {} },
				},
			],
		}).config.views[0]!;
		expect(view.type).toBe('list');
		expect(view.type === 'list' && 'sort' in view).toBe(false);
		expect(view.type === 'list' && view.tags).toEqual(['bug']);
		expect(view.type === 'list' && view.sections).toBeUndefined();
	});

	it('names a list view by default and allows several per board', () => {
		const board = parse({
			views: [
				{ id: 'v1', type: 'list' },
				{ id: 'v2', type: 'list' },
				{ id: 'v3', name: 'Board', type: 'kanban' },
			],
		});
		expect(board.config.views.map((v) => v.name)).toEqual(['List', 'List', 'Board']);
		expect(validateViews(board.config)).toEqual([]);
	});

	it('reports a sort property the board no longer declares as a date', () => {
		const board = parse({
			views: [
				{
					id: 'v1',
					name: 'L',
					type: 'list',
					sort: { property: 'gone', dir: 'asc' },
					sections: { A: { sort: { property: 'due', dir: 'asc' } } },
				},
			],
			...DATE_PROPS,
		});
		expect(validateViews(board.config)).toEqual([
			{ kind: 'missingSortProperty', name: 'L', property: 'gone' },
		]);
	});
});
