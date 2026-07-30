import { describe, it, expect } from 'vitest';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import * as ops from '../src/model/ops';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead();

const BOARD = [
	FM,
	'## To do',
	'',
	'- First card #work',
	'- Second card',
	'',
	'## Doing',
	'',
	'### Group',
	'',
	'- Grouped card',
	'',
	'## Done %%collapsed%%',
	'',
	'- Shipped',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);
const text = (b: Board): string => serializeBoard(b).slice(FM.length + 1);

describe('ops: fidelity', () => {
	it('parses the fixture back to itself', () => {
		expect(serializeBoard(board())).toBe(BOARD);
	});

	it('leaves the board untouched when an operation is a no-op', () => {
		const b = board();
		expect(ops.renameStack(b, 0, 'To do')).toBe(b);
		expect(ops.setStackCollapsed(b, 0, false)).toBe(b);
		expect(ops.moveStack(b, 0, 0)).toBe(b);
		expect(ops.moveItem(b, { stack: 0, item: 0 }, 0, 0)).toBe(b);
		expect(ops.deleteItem(b, { stack: 5, item: 0 })).toBe(b);
	});

	it('keeps untouched stacks identical by reference', () => {
		const b = board();
		const next = ops.addCard(b, 0, 'Third card');
		expect(next.stacks[1]).toBe(b.stacks[1]);
		expect(next.stacks[2]).toBe(b.stacks[2]);
	});
});

describe('ops: cards', () => {
	it('appends a card at the end of a stack', () => {
		const next = ops.addCard(board(), 0, 'Third card @{foo|bar} #new');
		expect(text(next)).toContain('- Second card\n- Third card @{foo|bar} #new\n\n## Doing');
		const card = next.stacks[0]!.items[2];
		expect(card?.kind === 'card' && card.card.tags).toEqual(['new']);
	});

	it('inserts a card at the top of a stack', () => {
		const next = ops.addCard(board(), 0, 'Zeroth', 0);
		expect(text(next)).toContain('## To do\n\n- Zeroth\n- First card');
	});

	it('rewrites a card from edited text and keeps its trailing lines', () => {
		const b = board();
		const next = ops.setCardText(b, { stack: 0, item: 0 }, 'Renamed @{status|Todo} #work');
		const item = next.stacks[0]!.items[0];
		expect(item?.kind === 'card' && item.card.title).toBe('Renamed');
		expect(text(next)).toContain('- Renamed @{status|Todo} #work\n- Second card');
	});

	it('duplicates a card below the original', () => {
		const next = ops.duplicateItem(board(), { stack: 0, item: 0 });
		expect(text(next)).toContain('- First card #work\n- First card #work\n- Second card');
	});

	it('deletes a card and keeps the blank line before the next stack', () => {
		const next = ops.deleteItem(board(), { stack: 0, item: 1 });
		expect(text(next)).toContain('## To do\n\n- First card #work\n\n## Doing');
	});

	it('leaves an emptied stack as a bare heading', () => {
		const next = ops.deleteItem(board(), { stack: 2, item: 0 });
		expect(text(next).endsWith('## Done %%collapsed%%\n')).toBe(true);
		expect(text(next)).not.toContain('Shipped');
	});

	it('treats a blank or whitespace-only title as untitled', () => {
		const card = (title: string) => ({
			title,
			properties: [],
			tags: [],
			checklist: [],
			trailing: [],
		});
		expect(ops.isCardUntitled(card(''))).toBe(true);
		expect(ops.isCardUntitled(card('   \t '))).toBe(true);
		expect(ops.isCardUntitled(card('First card'))).toBe(false);
	});

	it('deletes every untitled card across the board', () => {
		const b = ops.addCard(board(), 1, '   ', 0);
		const next = ops.deleteUntitledCards(b);
		const doing = next.stacks[1]!.items;
		expect(doing.some((item) => item.kind === 'card' && item.card.title === '')).toBe(false);
		expect(text(next)).toContain('## To do\n\n- First card #work\n- Second card');
	});

	it('is a no-op on a board with no untitled cards', () => {
		const b = board();
		expect(ops.deleteUntitledCards(b)).toBe(b);
	});
});

describe('ops: moving items', () => {
	it('moves a card to another stack before a given item', () => {
		const next = ops.moveItem(board(), { stack: 0, item: 0 }, 1, 1);
		expect(text(next)).toContain('## To do\n\n- Second card\n\n## Doing\n\n### Group\n\n- First card #work\n- Grouped card');
	});

	it('moves a card to the end of a collapsed stack without expanding it', () => {
		const next = ops.moveItem(board(), { stack: 0, item: 1 }, 2, null);
		expect(text(next)).toContain('## Done %%collapsed%%\n\n- Shipped\n- Second card\n');
		expect(next.stacks[2]?.collapsed).toBe(true);
	});

	it('reorders within a stack using pre-move indexes', () => {
		// Drag "First card" below "Second card": the item after the drop point is
		// still addressed by its pre-move index.
		const next = ops.moveItem(board(), { stack: 0, item: 0 }, 0, null);
		expect(text(next)).toContain('- Second card\n- First card #work');
	});

	it('moves a divider along with nothing else', () => {
		const next = ops.moveItem(board(), { stack: 1, item: 0 }, 1, null);
		expect(text(next)).toContain('## Doing\n\n- Grouped card\n\n### Group\n\n');
	});
});

describe('ops: stacks and dividers', () => {
	it('adds a stack at the end with a blank line separator', () => {
		const next = ops.addStack(board(), 'New');
		expect(text(next).endsWith('- Shipped\n\n## New\n')).toBe(true);
	});

	it('adds a stack in the middle', () => {
		const next = ops.addStack(board(), 'New', 1);
		expect(text(next)).toContain('- Second card\n\n## New\n\n## Doing');
	});

	it('renames, collapses and deletes stacks', () => {
		let b = ops.renameStack(board(), 0, 'Backlog');
		b = ops.setStackCollapsed(b, 0, true);
		expect(text(b)).toContain('## Backlog %%collapsed%%');
		b = ops.setStackCollapsed(b, 2, false);
		expect(text(b)).toContain('## Done\n');
		b = ops.deleteStack(b, 0, {});
		expect(text(b).startsWith('## Doing')).toBe(true);
	});

	it('moves a stack before another', () => {
		const next = ops.moveStack(board(), 2, 0);
		expect(text(next).startsWith('## Done %%collapsed%%\n\n- Shipped\n\n## To do')).toBe(true);
	});

	it('adds named and plain dividers', () => {
		let b = ops.addDivider(board(), 0, 'Later');
		b = ops.addDivider(b, 0, undefined);
		expect(text(b)).toContain('- Second card\n\n### Later\n\n---\n\n## Doing');
	});

	it('renames a divider and toggles its collapse', () => {
		let b = ops.renameDivider(board(), { stack: 1, item: 0 }, 'Renamed');
		b = ops.setDividerCollapsed(b, { stack: 1, item: 0 }, true);
		expect(text(b)).toContain('### Renamed %%collapsed%%');
	});

	it('drops a divider name to make it plain', () => {
		const next = ops.renameDivider(board(), { stack: 1, item: 0 }, undefined);
		expect(text(next)).toContain('## Doing\n\n---\n\n- Grouped card');
	});
});

describe('ops: queries', () => {
	it('counts cards, ignoring dividers', () => {
		const b = board();
		expect(ops.cardCount(b.stacks[0]!)).toBe(2);
		expect(ops.cardCount(b.stacks[1]!)).toBe(1);
	});

	it('reports items hidden by a collapsed divider', () => {
		const b = ops.setDividerCollapsed(board(), { stack: 1, item: 0 }, true);
		expect([...ops.hiddenItems(b.stacks[1]!)]).toEqual([1]);
		expect([...ops.hiddenItems(b.stacks[0]!)]).toEqual([]);
	});
});

describe('ops: layout normalization', () => {
	it('is idempotent — re-applying an edit does not reflow the file', () => {
		const once = ops.addCard(board(), 0, 'X');
		const twice = ops.deleteItem(once, { stack: 0, item: 2 });
		expect(serializeBoard(twice)).toBe(BOARD);
	});

	it('normalizes a stack that was written without blank lines', () => {
		const dense = [FM, '## A', '- one', '- two', '## B', '- three', ''].join('\n');
		const next = ops.addCard(parseBoard(dense), 0, 'four');
		// Only the edited stack is reflowed; the untouched one keeps its shape.
		expect(text(next)).toBe('## A\n\n- one\n- two\n- four\n\n## B\n- three\n');
	});
});
