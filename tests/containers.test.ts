// M12: stack completion & divider colors.
// Spec: docs/specs/stack-completion-and-divider-colors.md.

import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import * as ops from '../src/model/ops';
import type { Board, Card } from '../src/model/types';

const FM = ['---', 'extraboard:', '  version: 1', '  view: kanban', '  properties: []', '---'].join('\n');

const BOARD = [
	FM,
	'## To do',
	'',
	'### Design %%color|#c9a227%%',
	'',
	'- [ ] Draft the flow',
	'\t- [ ] Screens',
	'\t\t- [/] Copy',
	'',
	'### Backend',
	'',
	'- Plain card',
	'',
	'## Done %%completes%%',
	'',
	'- [x] Shipped',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);
const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);
const cardAt = (b: Board, stack: number, item: number): Card => {
	const entry = b.stacks[stack]?.items[item];
	if (entry?.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

describe('markers: format', () => {
	it('parses the fixture back to itself', () => {
		expect(serializeBoard(board())).toBe(BOARD);
	});

	it('reads the completion flag and the divider color', () => {
		const b = board();
		expect(b.stacks[0]!.completes).toBe(false);
		expect(b.stacks[1]!.completes).toBe(true);
		const entry = b.stacks[0]!.items[0];
		expect(entry?.kind === 'divider' && entry.divider.color).toBe('#c9a227');
	});

	it('accepts markers in any order and writes them canonically', () => {
		const text = [FM, '## Done %%collapsed%% %%completes%%', '', '- Card', ''].join('\n');
		const b = parseBoard(text);
		expect(b.stacks[0]!.name).toBe('Done');
		expect(b.stacks[0]!.completes).toBe(true);
		expect(b.stacks[0]!.collapsed).toBe(true);
		// Canonical: the name, then `%%completes%%`, then the collapse state last.
		expect(body(b)).toContain('## Done %%completes%% %%collapsed%%');
	});

	it('escapes a color that contains a percent sign', () => {
		const text = [FM, '## S', '', '### Group %%color|hsl(30 100\\% 50\\%)%% %%collapsed%%', ''].join('\n');
		const b = parseBoard(text);
		const entry = b.stacks[0]!.items[0];
		expect(entry?.kind === 'divider' && entry.divider.color).toBe('hsl(30 100% 50%)');
		expect(serializeBoard(b)).toBe(text);
	});

	it('leaves a marker on the wrong heading as ordinary text', () => {
		const text = [FM, '## To do %%color|#fff%%', '', '### Group %%completes%%', ''].join('\n');
		const b = parseBoard(text);
		expect(b.stacks[0]!.name).toBe('To do %%color|#fff%%');
		expect(b.stacks[0]!.completes).toBe(false);
		const entry = b.stacks[0]!.items[0];
		expect(entry?.kind === 'divider' && entry.divider.name).toBe('Group %%completes%%');
		expect(serializeBoard(b)).toBe(text);
	});

	it('keeps the unnamed divider grammar untouched', () => {
		const text = [FM, '## S', '', '--- %%collapsed%%', '', '- Card', ''].join('\n');
		expect(serializeBoard(parseBoard(text))).toBe(text);
	});

	it('is idempotent and a fixed point with both markers present', () => {
		const once = serializeBoard(board());
		expect(serializeBoard(parseBoard(once))).toBe(once);
	});
});

describe('completion stacks', () => {
	it('completes a card dragged into the stack, checklist and all', () => {
		// "Draft the flow" (To do, under Design) into the completing stack.
		const next = ops.moveItem(board(), { stack: 0, item: 1 }, 1, null);
		const card = cardAt(next, 1, 1);
		expect(card.task).toBe('x');
		expect(body(next)).toContain(
			['- [x] Draft the flow', '\t- [x] Screens', '\t\t- [x] Copy'].join('\n'),
		);
	});

	it('gives a plain card a marker when it enters', () => {
		const next = ops.moveItem(board(), { stack: 0, item: 3 }, 1, null);
		expect(cardAt(next, 1, 1).task).toBe('x');
	});

	it('completes a card created in the stack', () => {
		const next = ops.addCard(board(), 1, 'Fresh');
		expect(cardAt(next, 1, 1).task).toBe('x');
	});

	it('completes a card restored into the stack', () => {
		const archived = ops.archiveCard(board(), { stack: 0, item: 3 });
		// The origin stack is "To do", so restore it into the completing one by
		// deleting the origin first: restore then falls back to the first stack.
		const done = ops.deleteStack(archived, 0);
		const next = ops.restoreCard(done, 0);
		expect(cardAt(next, 0, 1).task).toBe('x');
	});

	it('does not complete a card moved within the stack', () => {
		// Cards that were already in the stack when the flag was set: reordering
		// them is not entering anything, so neither marker changes.
		const b = parseBoard(
			[FM, '## Done %%completes%%', '', '- [x] First', '- [/] Second', ''].join('\n'),
		);
		const next = ops.moveItem(b, { stack: 0, item: 1 }, 0, 0);
		expect(cardAt(next, 0, 0).task).toBe('/');
	});

	it('does not complete a card leaving the stack', () => {
		const next = ops.moveItem(board(), { stack: 1, item: 0 }, 0, null);
		expect(cardAt(next, 0, 4).task).toBe('x');
		const back = ops.moveItem(next, { stack: 0, item: 4 }, 1, null);
		expect(cardAt(back, 1, 0).task).toBe('x');
	});

	it('rewrites nothing when the flag is turned on', () => {
		const b = board();
		const next = ops.setStackCompletes(b, 0, true);
		expect(next.stacks[0]!.completes).toBe(true);
		expect(body(next)).toContain('## To do %%completes%%');
		expect(body(next)).toContain('- [ ] Draft the flow');
		expect(body(next)).toContain('- Plain card');
	});

	it('is a no-op when the flag already has that value', () => {
		const b = board();
		expect(ops.setStackCompletes(b, 1, true)).toBe(b);
		expect(ops.setStackCompletes(b, 9, true)).toBe(b);
	});

	it('leaves an already completed card alone', () => {
		const card = cardAt(board(), 1, 0);
		expect(ops.completeCard(card)).toBe(card);
	});

	it('keeps an X marker rather than rewriting it to x', () => {
		const b = parseBoard([FM, '## S', '', '- [X] Done already', ''].join('\n'));
		expect(ops.completeCard(cardAt(b, 0, 0)).task).toBe('X');
	});

	it('carries the flag on a stack created with it', () => {
		const next = ops.addStack(board(), 'Shipped', null, true);
		expect(body(next)).toContain('## Shipped %%completes%%');
	});
});

describe('divider colors', () => {
	it('applies to the cards of the divider group only', () => {
		const stack = board().stacks[0]!;
		expect(ops.groupColor(stack, 1)).toBe('#c9a227');
		// After the second (uncolored) divider the band ends.
		expect(ops.groupColor(stack, 3)).toBeUndefined();
	});

	it('inherits nothing before the first divider', () => {
		const b = ops.addCard(board(), 0, 'Loose', 0);
		expect(ops.groupColor(b.stacks[0]!, 0)).toBeUndefined();
	});

	it('sets and clears a color without touching any card', () => {
		const ref = { stack: 0, item: 2 };
		const colored = ops.setDividerColor(board(), ref, '#08b94e');
		expect(body(colored)).toContain('### Backend %%color|#08b94e%%');
		expect(body(colored)).toContain('- Plain card');

		const cleared = ops.setDividerColor(colored, ref, '');
		expect(body(cleared)).toContain('### Backend\n');
		expect(cleared.stacks[0]!.items[2]).toEqual(board().stacks[0]!.items[2]);
	});

	it('ignores an unnamed divider and a value that changes nothing', () => {
		const b = parseBoard([FM, '## S', '', '---', '', '- Card', ''].join('\n'));
		expect(ops.setDividerColor(b, { stack: 0, item: 0 }, '#fff')).toBe(b);
		const colored = board();
		expect(ops.setDividerColor(colored, { stack: 0, item: 0 }, '#c9a227')).toBe(colored);
	});

	it('drops the color when the divider loses its name', () => {
		const next = ops.renameDivider(board(), { stack: 0, item: 0 }, undefined);
		const entry = next.stacks[0]!.items[0];
		expect(entry?.kind === 'divider' && entry.divider.color).toBeUndefined();
		expect(body(next)).toContain('---\n');
	});
});
