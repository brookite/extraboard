// Nested task lists under cards — M6.
// Specs: markdown-format.md §4.5, card-content-and-checklists.md §4.

import { describe, it, expect } from 'vitest';
import * as cl from '../src/model/checklist';
import type { ChecklistItem } from '../src/model/checklist';
import { parseBody } from '../src/model/parse';
import { serializeBody } from '../src/model/serialize';
import * as ops from '../src/model/ops';
import type { Board, BoardConfig, Card } from '../src/model/types';

const config: BoardConfig = {
	version: 1,
	views: [{ id: 'v1', name: 'Board', type: 'kanban' }],
	activeView: 'v1',
	properties: [{ name: 'priority', type: 'integer' }],
	tagColors: {},
};

function boardFromBody(body: string): Board {
	const { preamble, stacks } = parseBody(body, config);
	return { config, frontmatterDoc: null, preamble, stacks, trailing: '' };
}

const cardAt = (board: Board, stack: number, item: number): Card => {
	const entry = board.stacks[stack]?.items[item];
	if (entry?.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

/** Compact `marker:text` tree, so assertions stay readable. */
function shape(items: ChecklistItem[]): unknown {
	return items.map((i) => (i.children.length ? [`${i.marker}:${i.text}`, shape(i.children)] : `${i.marker}:${i.text}`));
}

describe('checklist: parsing', () => {
	it('nests by indent and keeps markers verbatim', () => {
		const board = boardFromBody(
			['## S', '- [ ] Card', '\t- [x] One', '\t\t- [X] Deep', '\t- [/] Two', '- Next card', ''].join('\n'),
		);
		expect(shape(cardAt(board, 0, 0).checklist)).toEqual([['x:One', ['X:Deep']], '/:Two']);
		expect(cardAt(board, 0, 1).checklist).toEqual([]);
	});

	it('counts a tab as four columns, so mixed indents nest', () => {
		const board = boardFromBody(['## S', '- Card', '  - [ ] Two spaces', '\t- [ ] One tab', ''].join('\n'));
		expect(shape(cardAt(board, 0, 0).checklist)).toEqual([[' :Two spaces', [' :One tab']]]);
	});

	it('treats an over-indented item as one level deeper, never as a gap', () => {
		const board = boardFromBody(['## S', '- Card', '\t- [ ] A', '\t\t\t\t- [ ] B', ''].join('\n'));
		expect(shape(cardAt(board, 0, 0).checklist)).toEqual([[' :A', [' :B']]]);
	});

	it('takes only the leading contiguous block; the rest stays verbatim', () => {
		const board = boardFromBody(
			['## S', '- Card', '\t- [ ] In', '\tplain prose', '\t- [ ] Out', ''].join('\n'),
		);
		const card = cardAt(board, 0, 0);
		expect(shape(card.checklist)).toEqual([' :In']);
		expect(card.trailing).toEqual(['\tplain prose', '\t- [ ] Out', '']);
	});

	it('ignores a plain nested bullet and an unindented task line', () => {
		const board = boardFromBody(['## S', '- Card', '\t- plain', ''].join('\n'));
		expect(cardAt(board, 0, 0).checklist).toEqual([]);
		expect(cardAt(board, 0, 0).trailing).toEqual(['\t- plain', '']);
	});

	it('accepts an item with no text', () => {
		const board = boardFromBody(['## S', '- Card', '\t- [ ]', ''].join('\n'));
		expect(shape(cardAt(board, 0, 0).checklist)).toEqual([' :']);
	});
});

describe('checklist: serialization', () => {
	it('is a fixed point for canonical (one tab per level) output', () => {
		const body = ['## S', '- [ ] Card @{priority|1}', '\t- [x] One', '\t\t- [ ] Deep', '\t- [/] Two', ''].join('\n');
		expect(serializeBody(boardFromBody(body))).toBe(body);
	});

	it('re-indents a hand-authored file once, converging after one save', () => {
		const body = ['## S', '- Card', '  - [ ] A', '      - [ ] B', ''].join('\n');
		const once = serializeBody(boardFromBody(body));
		expect(once).toBe(['## S', '- Card', '\t- [ ] A', '\t\t- [ ] B', ''].join('\n'));
		expect(serializeBody(boardFromBody(once))).toBe(once);
	});

	it('emits the checklist before the card‘s verbatim lines', () => {
		const body = ['## S', '- Card', '\t- [ ] A', '\tnote below', ''].join('\n');
		expect(serializeBody(boardFromBody(body))).toBe(body);
	});
});

describe('checklist: progress', () => {
	const items = cl.splitChecklist(['\t- [x] a', '\t\t- [X] b', '\t\t- [ ] c', '\t- [/] d']).checklist;

	it('counts every item at every level, x/X only', () => {
		expect(cl.progress(items)).toEqual({ done: 2, total: 4 });
	});

	it('reports nothing for a card with no checklist', () => {
		const board = boardFromBody('## S\n- Card\n');
		expect(ops.checklistProgress(cardAt(board, 0, 0))).toEqual({ done: 0, total: 0 });
	});
});

describe('checklist: tree helpers', () => {
	const tree = (): ChecklistItem[] =>
		cl.splitChecklist(['\t- [ ] a', '\t\t- [ ] a1', '\t- [ ] b', '\t- [ ] c']).checklist;

	it('toggles one row without cascading', () => {
		const next = cl.toggle(tree(), [0]);
		expect(shape(next)).toEqual([['x:a', [' :a1']], ' :b', ' :c']);
	});

	it('inserts a sibling below and reports its path', () => {
		const r = cl.insertAfter(tree(), [1], { marker: ' ', text: 'new', children: [] });
		expect(shape(r.items)).toEqual([[' :a', [' :a1']], ' :b', ' :new', ' :c']);
		expect(r.path).toEqual([2]);
	});

	it('promotes children instead of deleting a subtree', () => {
		expect(shape(cl.removeAt(tree(), [0]))).toEqual([' :a1', ' :b', ' :c']);
	});

	it('indents under the preceding sibling and refuses at the top', () => {
		const r = cl.indent(tree(), [1]);
		expect(shape(r.items)).toEqual([[' :a', [' :a1', ' :b']], ' :c']);
		expect(r.path).toEqual([0, 1]);
		expect(cl.indent(tree(), [0]).items).toEqual(tree());
	});

	it('outdents to the parent‘s next sibling and refuses at the root', () => {
		const r = cl.outdent(tree(), [0, 0]);
		expect(shape(r.items)).toEqual([' :a', ' :a1', ' :b', ' :c']);
		expect(r.path).toEqual([1]);
		expect(cl.outdent(tree(), [0]).items).toEqual(tree());
	});

	it('moves a row with its subtree', () => {
		const r = cl.move(tree(), [0], 1);
		expect(shape(r.items)).toEqual([' :b', [' :a', [' :a1']], ' :c']);
		expect(r.path).toEqual([1]);
		expect(cl.move(tree(), [0], -1).items).toEqual(tree());
		expect(cl.move(tree(), [2], 1).items).toEqual(tree());
	});

	it('leaves the tree alone for a stale path', () => {
		const t = tree();
		expect(cl.toggle(t, [9])).toBe(t);
		expect(cl.removeAt(t, [0, 5])).toBe(t);
		expect(cl.updateItem(t, [], { text: 'x' })).toBe(t);
	});

	// `moveTo` is what the modal's drag & drop applies: the row takes the slot
	// it was dropped into and brings its subtree with it.
	it('moves a row into the slot it was dropped on', () => {
		// Drop `c` in front of `a`.
		const r = cl.moveTo(tree(), [2], [0]);
		expect(shape(r.items)).toEqual([' :c', [' :a', [' :a1']], ' :b']);
		expect(r.path).toEqual([0]);
	});

	it('carries the subtree along and adopts the target level', () => {
		// Drop `a` (with `a1`) in front of `c`, which is a root row.
		expect(shape(cl.moveTo(tree(), [0], [2]).items)).toEqual([
			' :b',
			[' :a', [' :a1']],
			' :c',
		]);
		// Drop `c` in front of `a1`, which is a child of `a`.
		expect(shape(cl.moveTo(tree(), [2], [0, 0]).items)).toEqual([
			[' :a', [' :c', ' :a1']],
			' :b',
		]);
	});

	it('appends at the root when dropped past the last row', () => {
		const r = cl.moveTo(tree(), [0], null);
		expect(shape(r.items)).toEqual([' :b', ' :c', [' :a', [' :a1']]]);
		expect(r.path).toEqual([2]);
	});

	it('changes nothing when a row lands back on its own slot', () => {
		const t = tree();
		expect(cl.moveTo(t, [1], [2])).toMatchObject({ items: t, path: [1] });
		expect(cl.moveTo(t, [1], [1])).toMatchObject({ items: t });
	});

	it('refuses to drop a row inside its own subtree, or a stale path', () => {
		const t = tree();
		expect(cl.moveTo(t, [0], [0, 0]).items).toBe(t);
		expect(cl.moveTo(t, [9], [0]).items).toBe(t);
	});

	it('flattens depth-first with addressable paths', () => {
		expect(cl.flatten(tree()).map((r) => r.path)).toEqual([[0], [0, 0], [1], [2]]);
	});
});

describe('checklist: board ops', () => {
	const board = (): Board => boardFromBody('## S\n- Card\n\t- [ ] a\n\t- [x] b\n');

	it('applies a tree transform through the board', () => {
		const next = ops.updateChecklist(board(), { stack: 0, item: 0 }, (items) => cl.toggle(items, [0]));
		expect(shape(cardAt(next, 0, 0).checklist)).toEqual(['x:a', 'x:b']);
	});

	it('is a no-op when the transform changes nothing', () => {
		const b = board();
		expect(ops.updateChecklist(b, { stack: 0, item: 0 }, (items) => cl.toggle(items, [7]))).toBe(b);
	});

	it('carries the checklist through a text edit and a duplicate', () => {
		const edited = ops.setCardText(board(), { stack: 0, item: 0 }, 'Renamed');
		expect(shape(cardAt(edited, 0, 0).checklist)).toEqual([' :a', 'x:b']);

		const dup = ops.duplicateItem(board(), { stack: 0, item: 0 });
		const copy = cardAt(dup, 0, 1);
		expect(shape(copy.checklist)).toEqual([' :a', 'x:b']);
		// A deep copy: editing the duplicate must not touch the original.
		expect(copy.checklist[0]).not.toBe(cardAt(dup, 0, 0).checklist[0]);
	});
});
