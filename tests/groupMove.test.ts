// 0.6.0: a named divider dragged on the board carries its whole group.
// Spec: docs/specs/kanban-view.md §6.4a, docs/specs/list-view.md §1.5.

import { describe, it, expect } from 'vitest';
import * as ops from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import { stackRuns } from '../src/model/sections';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead();

// To do: 0 loose, 1 ### A, 2 a1, 3 ---, 4 a2, 5 ### B, 6 b1.
const BOARD = [
	FM,
	'## To do',
	'',
	'- loose',
	'',
	'### A %%color|red%% %%collapsed%%',
	'',
	'- [ ] a1',
	'\t- [ ] sub',
	'',
	'---',
	'',
	'- a2',
	'',
	'### B',
	'',
	'- b1',
	'',
	'## Done %%completes%%',
	'',
	'- d1',
	'',
	'### C',
	'',
	'- c1',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);

/** parse ∘ serialize is the identity on the result, and its text a fixed point. */
function intact(b: Board): Board {
	const text = serializeBoard(b);
	const reparsed = parseBoard(text);
	expect(reparsed).toEqual(b);
	expect(serializeBoard(reparsed)).toBe(text);
	return b;
}

const titlesOf = (b: Board, stack: number): string[] =>
	b.stacks[stack]!.items.map((entry) =>
		entry.kind === 'card' ? entry.card.title : `### ${entry.divider.name ?? '---'}`,
	);

describe('stackRuns', () => {
	it('cuts a stack into its head and one run per named divider', () => {
		expect(stackRuns(board().stacks[0]!)).toEqual([
			{ at: null, start: 0, end: 1 },
			{ at: 1, start: 2, end: 5 },
			{ at: 5, start: 6, end: 7 },
		]);
	});

	it('always has a head, empty or not, and nothing else without named dividers', () => {
		const b = parseBoard([FM, '## S', '', '### A', '', '- a', '', '## T', '', '- t', '', '---', '', '- u', ''].join('\n'));
		expect(stackRuns(b.stacks[0]!)).toEqual([
			{ at: null, start: 0, end: 0 },
			{ at: 0, start: 1, end: 2 },
		]);
		expect(stackRuns(b.stacks[1]!)).toEqual([{ at: null, start: 0, end: 3 }]);
	});
});

describe('moveGroup', () => {
	it('moves a group with its nested `---`, markers and all, within its stack', () => {
		const next = intact(ops.moveGroup(board(), { stack: 0, item: 1 }, 0, null));
		expect(titlesOf(next, 0)).toEqual(['loose', '### B', 'b1', '### A', 'a1', '### ---', 'a2']);
		const a = next.stacks[0]!.items[3];
		expect(a?.kind === 'divider' && a.divider).toMatchObject({ color: 'red', collapsed: true });
		// And back in front of B.
		const back = intact(ops.moveGroup(next, { stack: 0, item: 3 }, 0, 1));
		expect(serializeBoard(back)).toBe(BOARD);
	});

	it('moves a group to another stack, completing its cards there', () => {
		const next = intact(ops.moveGroup(board(), { stack: 0, item: 5 }, 1, 1));
		expect(titlesOf(next, 0)).toEqual(['loose', '### A', 'a1', '### ---', 'a2']);
		expect(titlesOf(next, 1)).toEqual(['d1', '### B', 'b1', '### C', 'c1']);
		const b1 = next.stacks[1]!.items[2];
		expect(b1?.kind === 'card' && b1.card.task).toBe('x');
		const a = intact(ops.moveGroup(board(), { stack: 0, item: 1 }, 1, null));
		const a1 = a.stacks[1]!.items[4];
		expect(a1?.kind === 'card' && a1.card.task).toBe('x');
		expect(a1?.kind === 'card' && a1.card.checklist[0]?.marker).toBe('x');
	});

	it('does not complete anything moving inside a completing stack', () => {
		const b = parseBoard(
			[FM, '## Done %%completes%%', '', '### X', '', '- [ ] x', '', '### Y', '', '- [ ] y', ''].join('\n'),
		);
		const next = intact(ops.moveGroup(b, { stack: 0, item: 0 }, 0, null));
		expect(titlesOf(next, 0)).toEqual(['### Y', 'y', '### X', 'x']);
		const x = next.stacks[0]!.items[3];
		expect(x?.kind === 'card' && x.card.task).toBe(' ');
	});

	it('snaps a drop inside a group or among loose cards to the next group boundary', () => {
		// In front of `loose` (the head) → before the first named divider: no move.
		const before = board();
		expect(ops.moveGroup(before, { stack: 0, item: 5 }, 0, 0)).not.toBe(before);
		expect(titlesOf(ops.moveGroup(before, { stack: 0, item: 5 }, 0, 0), 0)).toEqual([
			'loose',
			'### B',
			'b1',
			'### A',
			'a1',
			'### ---',
			'a2',
		]);
		// Into A's own nested `---` → past A's end, which is where it is.
		expect(ops.moveGroup(before, { stack: 0, item: 1 }, 0, 3)).toBe(before);
		// Among Done's loose cards → in front of C, never above d1.
		const into = intact(ops.moveGroup(before, { stack: 0, item: 5 }, 1, 0));
		expect(titlesOf(into, 1)).toEqual(['d1', '### B', 'b1', '### C', 'c1']);
	});

	it('is a no-op in front of itself, and refuses anything but a named divider', () => {
		const before = board();
		expect(ops.moveGroup(before, { stack: 0, item: 1 }, 0, 1)).toBe(before);
		expect(ops.moveGroup(before, { stack: 0, item: 5 }, 0, null)).toBe(before);
		expect(ops.moveGroup(before, { stack: 0, item: 3 }, 1, null)).toBe(before);
		expect(ops.moveGroup(before, { stack: 0, item: 0 }, 1, null)).toBe(before);
		expect(ops.moveGroup(before, { stack: 0, item: 1 }, 9, null)).toBe(before);
	});
});
