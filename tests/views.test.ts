// M8 part A: the board's view list. Spec: docs/specs/views.md.

import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import * as ops from '../src/model/ops';
import { activeViewOf, nextViewId, validateViews } from '../src/model/views';
import type { Board } from '../src/model/types';

const fm = (...lines: string[]): string =>
	['---', 'extraboard:', '  version: 1', ...lines.map((l) => `  ${l}`), '---', '', '## To do', '', '- A card', ''].join('\n');

const parse = (...lines: string[]): Board => parseBoard(fm(...lines));

const DATE_PROPS = ['properties:', '  - { name: due, type: datetime }', '  - { name: sprint, type: date-range }'];

describe('views: parsing', () => {
	it('reads a view list and its active view', () => {
		const board = parse(
			'activeView: v2',
			'views:',
			'  - { id: v1, name: Board, type: kanban }',
			'  - { id: v2, name: Due dates, type: calendar, dateProperty: due, mode: week }',
			...DATE_PROPS,
		);
		expect(board.config.views).toEqual([
			{ id: 'v1', name: 'Board', type: 'kanban' },
			{ id: 'v2', name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'week' },
		]);
		expect(activeViewOf(board.config).name).toBe('Due dates');
	});

	it('falls back to the first view when activeView is unknown or absent', () => {
		const views = ['views:', '  - { id: v1, name: Board, type: kanban }'];
		expect(activeViewOf(parse('activeView: nope', ...views).config).id).toBe('v1');
		expect(activeViewOf(parse(...views).config).id).toBe('v1');
	});

	it('drops a view that cannot be one, and a calendar with no date property', () => {
		const board = parse(
			'views:',
			'  - { id: v1, name: Board, type: kanban }',
			'  - { id: v2, name: Broken, type: nonsense }',
			'  - { id: v3, name: Dateless, type: calendar }',
			'  - not-a-mapping',
		);
		expect(board.config.views.map((v) => v.id)).toEqual(['v1']);
	});

	it('generates ids for a hand-written list and de-duplicates them', () => {
		const board = parse(
			'views:',
			'  - { name: One, type: kanban }',
			'  - { name: Two, type: calendar, dateProperty: due }',
			'  - { id: v1, name: Three, type: calendar, dateProperty: due }',
			...DATE_PROPS,
		);
		expect(board.config.views.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
	});

	it('defaults an empty name and an unknown mode', () => {
		const board = parse(
			'views:',
			'  - { id: v1, name: "  ", type: calendar, dateProperty: due, mode: decade }',
			...DATE_PROPS,
		);
		expect(board.config.views[0]).toEqual({
			id: 'v1',
			name: 'Calendar',
			type: 'calendar',
			dateProperty: 'due',
			mode: 'month',
		});
	});

	it('always leaves at least one view, even for an empty list', () => {
		const board = parse('views: []');
		expect(board.config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
	});
});

describe('views: the legacy `view` key (§1.1)', () => {
	it('upgrades `view: kanban` into a single Kanban view', () => {
		const board = parse('view: kanban');
		expect(board.config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
		expect(board.config.activeView).toBe('v1');
	});

	it('upgrades a usable `view: calendar` into a second, active view', () => {
		const board = parse(
			'view: calendar',
			'calendar: { dateProperty: due, mode: week }',
			...DATE_PROPS,
		);
		expect(board.config.views).toEqual([
			{ id: 'v1', name: 'Board', type: 'kanban' },
			{ id: 'v2', name: 'Calendar', type: 'calendar', dateProperty: 'due', mode: 'week' },
		]);
		expect(board.config.activeView).toBe('v2');
	});

	it('drops a legacy calendar whose property is missing or unusable', () => {
		const missing = parse('view: calendar', 'calendar: { dateProperty: nope }', ...DATE_PROPS);
		expect(missing.config.views).toHaveLength(1);
		const unusable = parse(
			'view: calendar',
			'calendar: { dateProperty: title }',
			'properties:',
			'  - { name: title, type: string }',
		);
		expect(unusable.config.views).toHaveLength(1);
	});

	it('prefers `views` over the legacy keys when both are present', () => {
		const board = parse(
			'view: calendar',
			'calendar: { dateProperty: due }',
			'views:',
			'  - { id: v9, name: Only, type: kanban }',
			...DATE_PROPS,
		);
		expect(board.config.views.map((v) => v.id)).toEqual(['v9']);
		expect(board.config.activeView).toBe('v9');
	});
});

describe('views: serialization', () => {
	it('leaves the legacy keys alone until the config node is rewritten', () => {
		// A body edit never touches frontmatter, so an untouched legacy board keeps
		// reading as one (views.md §1.1).
		const text = serializeBoard(ops.addStack(parse('view: kanban'), 'Later'));
		expect(text).toMatch(/^\s+view: kanban$/m);
		expect(text).not.toContain('views:');
	});

	it('writes the list and drops the legacy keys on the first config edit', () => {
		const board = parse('view: calendar', 'calendar: { dateProperty: due }', ...DATE_PROPS);
		const text = serializeBoard(ops.updateView(board, 'v2', { name: 'Deadlines' }));
		expect(text).toContain('views:');
		expect(text).toContain('name: Deadlines');
		expect(text).not.toMatch(/^\s+view: calendar$/m);
		expect(text).not.toMatch(/^\s+calendar:/m);
	});

	it('omits activeView while the first view is active, and writes it otherwise', () => {
		const board = parse('view: kanban');
		const one = ops.addView(board, { name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'month' }, false);
		expect(serializeBoard(one)).not.toContain('activeView');
		const switched = ops.setActiveView(one, one.config.views[1]!.id);
		expect(serializeBoard(switched)).toContain('activeView: v2');
	});

	it('is a fixed point once the upgrade has been written', () => {
		const upgraded = serializeBoard(
			ops.addView(parse('view: kanban'), { name: 'Second', type: 'kanban' }, false),
		);
		expect(serializeBoard(parseBoard(upgraded))).toBe(upgraded);
	});

	it('preserves foreign frontmatter through a view edit', () => {
		const text = [
			'---',
			'title: My board',
			'extraboard:',
			'  version: 1',
			'  view: kanban',
			'---',
			'',
			'## To do',
			'',
		].join('\n');
		const out = serializeBoard(ops.addView(parseBoard(text), { name: 'Second', type: 'kanban' }));
		expect(out).toContain('title: My board');
	});
});

describe('views: ops (§2.4)', () => {
	const twoViews = (): Board =>
		parse(
			'views:',
			'  - { id: v1, name: Board, type: kanban }',
			'  - { id: v2, name: Due dates, type: calendar, dateProperty: due, mode: month }',
			...DATE_PROPS,
		);

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
		const single = parse('view: kanban');
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
		const single = parse('view: kanban');
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
		const board = ops.addView(parse('view: kanban'), { name: 'Another', type: 'kanban' });
		expect(validateViews(board.config).join(' ')).toContain('at most one Kanban');
	});

	it('reports a calendar whose property is gone or is not a date', () => {
		const board = parse(
			'views:',
			'  - { id: v1, name: Due, type: calendar, dateProperty: due }',
			'properties:',
			'  - { name: title, type: string }',
		);
		expect(validateViews(board.config).join(' ')).toContain('does not declare');

		const retyped = parse(
			'views:',
			'  - { id: v1, name: Due, type: calendar, dateProperty: title }',
			'properties:',
			'  - { name: title, type: string }',
		);
		expect(validateViews(retyped.config).join(' ')).toContain('cannot drive a calendar');
	});

	it('accepts a healthy board', () => {
		const board = parse(
			'views:',
			'  - { id: v1, name: Board, type: kanban }',
			'  - { id: v2, name: Due, type: calendar, dateProperty: due }',
			...DATE_PROPS,
		);
		expect(validateViews(board.config)).toEqual([]);
	});
});
