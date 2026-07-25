// Editing a card's properties from the badges, and the file name a content
// note gets — M6. Spec: card-content-and-checklists.md §2, §3.

import { describe, it, expect } from 'vitest';
import { noteFileName } from '../src/model/link';
import * as ops from '../src/model/ops';
import { parseBody } from '../src/model/parse';
import { serializeBody } from '../src/model/serialize';
import type { Board, BoardConfig, Card } from '../src/model/types';

const config: BoardConfig = {
	version: 1,
	view: 'kanban',
	properties: [
		{ name: 'status', type: 'string-list', strict: true, options: [{ value: 'Todo' }, { value: 'Doing' }] },
		{ name: 'priority', type: 'integer' },
	],
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

const ref = { stack: 0, item: 0 };

describe('note file names', () => {
	it('replaces the characters a file name may not carry', () => {
		expect(noteFileName('Fix a/b: "why?" #now')).toBe('Fix a-b- -why-- -now');
		expect(noteFileName('[[Linked]]')).toBe('--Linked--');
	});

	it('collapses whitespace, drops leading dots and caps the length', () => {
		expect(noteFileName('  spaced   out  ')).toBe('spaced out');
		expect(noteFileName('...hidden')).toBe('hidden');
		expect(noteFileName('x'.repeat(200))).toHaveLength(100);
	});

	it('never returns an empty name', () => {
		expect(noteFileName('   ')).toBe('Untitled card');
		expect(noteFileName('///')).toBe('Untitled card');
	});
});

describe('card text editing with hidden property tokens', () => {
	const board = (): Board => boardFromBody('## S\n- [ ] Card @{status|Doing} @{priority|2} #bug\n');

	it('carries properties over when the field held title and tags only', () => {
		const next = ops.setCardText(board(), ref, 'Renamed #ux', { keepProperties: true });
		const card = cardAt(next, 0, 0);
		expect(card.title).toBe('Renamed');
		expect(card.tags).toEqual(['ux']);
		expect(card.task).toBe(' ');
		expect(card.properties).toEqual([
			{ name: 'status', type: 'string-list', value: ['Doing'] },
			{ name: 'priority', type: 'integer', value: 2 },
		]);
	});

	it('still honours a token the user typed anyway, overriding by name', () => {
		const next = ops.setCardText(board(), ref, 'Renamed @{priority|9}', { keepProperties: true });
		expect(cardAt(next, 0, 0).properties).toEqual([
			{ name: 'status', type: 'string-list', value: ['Doing'] },
			{ name: 'priority', type: 'integer', value: 9 },
		]);
	});

	it('lets the text own everything when the tokens were shown', () => {
		const next = ops.setCardText(board(), ref, 'Renamed @{priority|9}');
		expect(cardAt(next, 0, 0).properties).toEqual([{ name: 'priority', type: 'integer', value: 9 }]);
	});

	// The field accepts Shift+Enter, but a card is one list item: prose folds
	// into that line and task lines are lifted into the checklist, so a
	// re-serialized card can never split into several cards (cardText.ts).
	it('folds a multi-line field back into one card', () => {
		const typed = 'Title line\nsecond line\n- [ ] step one\n\n- [x] step two';
		const next = ops.setCardText(board(), ref, typed, { keepProperties: true });
		const card = cardAt(next, 0, 0);
		expect(card.title).toBe('Title line second line');
		expect(card.checklist.map((i) => i.text)).toEqual(['step one', 'step two']);

		const stack = next.stacks[0];
		expect(stack?.items).toHaveLength(1);
		expect(serializeBody(next).split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
	});
});

describe('property values from the badge editors', () => {
	const board = (): Board => boardFromBody('## S\n- Card @{priority|2}\n');

	it('replaces a value by name and appends a new one', () => {
		const b1 = ops.setCardProperty(board(), ref, { name: 'priority', type: 'integer', value: 5 });
		expect(cardAt(b1, 0, 0).properties).toEqual([{ name: 'priority', type: 'integer', value: 5 }]);

		const b2 = ops.setCardProperty(b1, ref, { name: 'status', type: 'string-list', value: ['Todo'] });
		expect(cardAt(b2, 0, 0).properties).toHaveLength(2);
	});

	it('removes a value, and is a no-op when there is nothing to remove', () => {
		const b = board();
		expect(cardAt(ops.removeCardProperty(b, ref, 'priority'), 0, 0).properties).toEqual([]);
		expect(ops.removeCardProperty(b, ref, 'status')).toBe(b);
	});

	it('leaves the title, tags and checklist alone', () => {
		const b = boardFromBody('## S\n- Card #bug\n\t- [ ] step\n');
		const next = ops.setCardProperty(b, ref, { name: 'priority', type: 'integer', value: 1 });
		const card = cardAt(next, 0, 0);
		expect(card.title).toBe('Card');
		expect(card.tags).toEqual(['bug']);
		expect(card.checklist).toHaveLength(1);
	});
});
