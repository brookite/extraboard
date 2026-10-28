// 0.8.0: the quick-add dialog's model. Spec: docs/specs/quick-add-card.md.

import { describe, it, expect } from 'vitest';
import * as ops from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import {
	addQuickCard,
	draftCard,
	draftOf,
	finalCard,
	initialDestination,
	isEmptyCard,
	namedSectionsOf,
	withStack,
} from '../src/model/quickAdd';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const BOARD = [
	boardHead({ properties: [{ name: 'due', type: 'datetime' }] }),
	'## To do',
	'',
	'- Loose',
	'',
	'### Backlog',
	'',
	'- B1',
	'- B2',
	'',
	'### Review',
	'',
	'- R1',
	'',
	'## Done %%completes%%',
	'',
	'- D1',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);

/** Titles of one stack's items, dividers as `### name`. */
const titles = (b: Board, stack: number): string[] =>
	(b.stacks[stack]?.items ?? []).map((entry) =>
		entry.kind === 'card' ? entry.card.title : `### ${entry.divider.name ?? '---'}`,
	);

/** The serialized board parses back to the same text — the file never breaks. */
const intact = (b: Board): void => {
	const text = serializeBoard(b);
	expect(serializeBoard(parseBoard(text))).toBe(text);
};

describe('quick add', () => {
	it('keeps the draft in a scratch stack the board never sees', () => {
		const original = board();
		const draft = draftOf(original);
		expect(draft.board.stacks).toHaveLength(original.stacks.length + 1);
		expect(original.stacks).toHaveLength(2);
		expect(draftCard(draft)?.title).toBe('');
	});

	it('builds the card from the text and keeps the draft properties', () => {
		let draft = draftOf(board());
		draft = {
			...draft,
			board: ops.setCardProperty(draft.board, draft.ref, { name: 'due', type: 'datetime', raw: '2026-11-01' }),
		};
		const card = finalCard(draft, '[[Note]] call **Bob** #work', false);
		expect(card?.title).toBe('[[Note]] call **Bob**');
		expect(card?.tags).toEqual(['work']);
		expect(card?.properties.map((pv) => pv.name)).toEqual(['due']);
	});

	it('treats a card with nothing in it as empty', () => {
		const draft = draftOf(board());
		expect(isEmptyCard(finalCard(draft, '   ', false)!)).toBe(true);
		expect(isEmptyCard(finalCard(draft, '#tag', false)!)).toBe(false);
	});

	it('lists a stack’s named sections once, in order', () => {
		expect(namedSectionsOf(board(), 0)).toEqual(['Backlog', 'Review']);
		expect(namedSectionsOf(board(), 1)).toEqual([]);
	});

	it('restores a remembered destination by name, else the first stack', () => {
		const b = board();
		expect(initialDestination(b, { stack: 'To do', section: 'Review' })).toEqual({ stack: 0, section: 'Review' });
		expect(initialDestination(b, { stack: 'Done', section: 'Review' })).toEqual({ stack: 1, section: null });
		expect(initialDestination(b, { stack: 'Gone', section: null })).toEqual({ stack: 0, section: null });
		expect(initialDestination(b, undefined)).toEqual({ stack: 0, section: null });
	});

	it('drops the section when the new stack has no divider of that name', () => {
		const b = board();
		expect(withStack(b, { stack: 0, section: 'Backlog' }, 1)).toEqual({ stack: 1, section: null });
	});

	it('adds into a named section at its top or end', () => {
		const card = finalCard(draftOf(board()), 'New', false)!;
		const top = addQuickCard(board(), { stack: 0, section: 'Backlog' }, card, true);
		expect(titles(top, 0)).toEqual(['Loose', '### Backlog', 'New', 'B1', 'B2', '### Review', 'R1']);
		const end = addQuickCard(board(), { stack: 0, section: 'Backlog' }, card, false);
		expect(titles(end, 0)).toEqual(['Loose', '### Backlog', 'B1', 'B2', 'New', '### Review', 'R1']);
		intact(top);
		intact(end);
	});

	it('adds with no section at the stack’s top or the end of its loose cards', () => {
		const card = finalCard(draftOf(board()), 'New', false)!;
		expect(titles(addQuickCard(board(), { stack: 0, section: null }, card, true), 0)[0]).toBe('New');
		expect(titles(addQuickCard(board(), { stack: 0, section: null }, card, false), 0).slice(0, 2)).toEqual([
			'Loose',
			'New',
		]);
	});

	it('completes a card added into a completing stack', () => {
		const card = finalCard(draftOf(board()), 'New', false)!;
		const next = addQuickCard(board(), { stack: 1, section: null }, card, false);
		const entry = next.stacks[1]!.items[1]!;
		expect(entry.kind === 'card' && entry.card.task).toBe('x');
		intact(next);
	});
});
