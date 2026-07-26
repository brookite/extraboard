// Native task-list cards (`- [ ] …`) and board-config rewriting — M5.
// Specs: markdown-format.md §4.0, kanban-view.md §5.1/§5.4.

import { describe, it, expect } from 'vitest';
import { parseBoard, parseBody, parseCardContent } from '../src/model/parse';
import { serializeBoard, serializeBody } from '../src/model/serialize';
import { validatePropertyDefs } from '../src/model/properties';
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

describe('task marker: parsing', () => {
	it('splits the marker from the inline content', () => {
		const card = parseCardContent('[ ] Fix login @{priority|2} #bug', config);
		expect(card.task).toBe(' ');
		expect(card.title).toBe('Fix login');
		expect(card.properties).toEqual([{ name: 'priority', type: 'integer', value: 2 }]);
		expect(card.tags).toEqual(['bug']);
	});

	it('keeps custom markers verbatim and reports done only for x/X', () => {
		expect(parseCardContent('[x] a', config).task).toBe('x');
		expect(parseCardContent('[/] a', config).task).toBe('/');
		expect(ops.isCardDone(parseCardContent('[x] a', config))).toBe(true);
		expect(ops.isCardDone(parseCardContent('[X] a', config))).toBe(true);
		expect(ops.isCardDone(parseCardContent('[/] a', config))).toBe(false);
		expect(ops.isCardDone(parseCardContent('a', config))).toBe(false);
	});

	it('accepts a marker with no text after it', () => {
		expect(parseCardContent('[ ]', config)).toMatchObject({ task: ' ', title: '' });
	});

	it('leaves wikilinks and inline links alone', () => {
		expect(parseCardContent('[[Some note]] follow-up', config).task).toBeUndefined();
		expect(parseCardContent('[a](https://example.com)', config).task).toBeUndefined();
		expect(parseCardContent('[ok] shipped', config).task).toBeUndefined();
	});
});

describe('task marker: serialization', () => {
	it('is a fixed point for task and plain cards', () => {
		const body = '## S\n- [ ] Todo card @{priority|1}\n- [x] Done card\n- [/] In progress\n- Plain card\n';
		expect(serializeBody(boardFromBody(body))).toBe(body);
	});

	it('emits a marker-only card without a trailing space', () => {
		const body = '## S\n- [ ]\n';
		expect(serializeBody(boardFromBody(body))).toBe(body);
	});
});

describe('task marker: operations', () => {
	const board = (): Board => boardFromBody('## S\n- [ ] One\n- [x] Two\n- [/] Three\n- Plain\n');

	it('toggles between done and not done', () => {
		const b = board();
		expect(cardAt(ops.toggleCardTask(b, { stack: 0, item: 0 }), 0, 0).task).toBe('x');
		expect(cardAt(ops.toggleCardTask(b, { stack: 0, item: 1 }), 0, 1).task).toBe(' ');
	});

	it('treats a custom marker as not done and only rewrites it on toggle', () => {
		const b = board();
		expect(cardAt(b, 0, 2).task).toBe('/');
		expect(cardAt(ops.toggleCardTask(b, { stack: 0, item: 2 }), 0, 2).task).toBe('x');
	});

	it('turns a plain card into a done task', () => {
		const next = ops.toggleCardTask(board(), { stack: 0, item: 3 });
		expect(cardAt(next, 0, 3).task).toBe('x');
		expect(serializeBody(next)).toContain('- [x] Plain');
	});

	it('removes the marker again with setCardTask(undefined)', () => {
		const next = ops.setCardTask(board(), { stack: 0, item: 1 }, undefined);
		expect(cardAt(next, 0, 1).task).toBeUndefined();
		expect(serializeBody(next)).toContain('- Two');
	});

	it('is a no-op when the marker does not change', () => {
		const b = board();
		expect(ops.setCardTask(b, { stack: 0, item: 1 }, 'x')).toBe(b);
	});

	it('keeps the marker when the card text is edited', () => {
		const next = ops.setCardText(board(), { stack: 0, item: 1 }, 'Renamed @{priority|3}');
		expect(cardAt(next, 0, 1).task).toBe('x');
		expect(serializeBody(next)).toContain('- [x] Renamed @{priority|3}');
	});

	it('lets the user type a marker into the card editor', () => {
		const next = ops.setCardText(board(), { stack: 0, item: 3 }, '[x] Plain');
		expect(cardAt(next, 0, 3).task).toBe('x');
	});
});

describe('board configuration rewriting', () => {
	const input =
		'---\n' +
		'aliases:\n' +
		'  - Project Board\n' +
		'extraboard:\n' +
		'  version: 1\n' +
		'  view: kanban\n' +
		'---\n' +
		'## Backlog\n' +
		'- Item one\n';

	it('writes new config into the extraboard node and keeps foreign keys', () => {
		const board = parseBoard(input);
		const next = ops.setBoardConfig(board, {
			...board.config,
			showCardCheckbox: true,
			properties: [{ name: 'status', type: 'string-list', strict: true, options: [{ value: 'Todo', bg: '#333' }] }],
			tagColors: { urgent: { bg: '#c00' } },
		});
		const text = serializeBoard(next);

		expect(text).toContain('aliases:');
		expect(text).toContain('showCardCheckbox: true');
		expect(text).toContain('name: status');
		expect(text).toContain('urgent:');

		const reparsed = parseBoard(text);
		expect(reparsed.config.showCardCheckbox).toBe(true);
		expect(reparsed.config.properties).toEqual(next.config.properties);
		expect(reparsed.config.tagColors).toEqual({ urgent: { bg: '#c00' } });
		expect(serializeBoard(parseBoard(text))).toBe(text);
	});

	it('does not mutate the board it was given', () => {
		const board = parseBoard(input);
		const before = serializeBoard(board);
		ops.setBoardConfig(board, { ...board.config, showCardCheckbox: true });
		expect(serializeBoard(board)).toBe(before);
	});
});

describe('card color', () => {
	const colored: BoardConfig = {
		...config,
		properties: [...config.properties, { name: 'accent', type: 'color' }],
	};
	const withDef = (body: string): Board => {
		const { preamble, stacks } = parseBody(body, colored);
		return { config: colored, frontmatterDoc: null, preamble, stacks, trailing: '' };
	};
	const ref = { stack: 0, item: 0 };

	it('writes the color into the board color property', () => {
		const next = ops.setCardColor(withDef('## A\n\n- Card\n'), ref, '#7852ee');
		expect(cardAt(next, 0, 0).properties).toEqual([
			{ name: 'accent', type: 'color', value: '#7852ee' },
		]);
		expect(serializeBody(next)).toContain('- Card @{accent|#7852ee}');
	});

	it('replaces an existing color instead of adding a second one', () => {
		const board = withDef('## A\n\n- Card @{accent|#111111} @{priority|2}\n');
		const next = ops.setCardColor(board, ref, 'rebeccapurple');
		// Tokens are emitted in the board's property order (priority, accent).
		expect(serializeBody(next)).toContain('- Card @{priority|2} @{accent|rebeccapurple}');
		expect(ops.setCardColor(next, ref, 'rebeccapurple')).toBe(next);
	});

	it('clears the color with an empty value', () => {
		const board = withDef('## A\n\n- Card @{accent|#111111}\n');
		expect(serializeBody(ops.setCardColor(board, ref, ''))).toContain('- Card\n');
		// Nothing to clear is a no-op, on a colorless card and a colorless board.
		const plain = withDef('## A\n\n- Card\n');
		expect(ops.setCardColor(plain, ref, '')).toBe(plain);
		const noDef = boardFromBody('## A\n\n- Card\n');
		expect(ops.setCardColor(noDef, ref, '')).toBe(noDef);
	});

	it('adds a color property to a board that declares none', () => {
		const board = parseBoard('---\nextraboard:\n  version: 1\n---\n## A\n\n- Card\n');
		const next = ops.setCardColor(board, ref, '#08b94e');
		expect(next.config.properties).toEqual([{ name: 'color', type: 'color' }]);

		const text = serializeBoard(next);
		expect(text).toContain('- Card @{color|#08b94e}');
		expect(parseBoard(text).config.properties).toEqual([{ name: 'color', type: 'color' }]);
		expect(cardAt(parseBoard(text), 0, 0).properties).toEqual([
			{ name: 'color', type: 'color', value: '#08b94e' },
		]);
	});

	it('replaces an untyped token of the same name instead of duplicating it', () => {
		const board = parseBoard('---\nextraboard:\n  version: 1\n---\n## A\n\n- Card @{color|red}\n');
		const next = ops.setCardColor(board, ref, 'blue');
		expect(cardAt(next, 0, 0).properties).toHaveLength(1);
		expect(serializeBody(next)).toContain('- Card @{color|blue}');
	});
});

describe('property definition validation', () => {
	it('allows several checkbox properties but only one color', () => {
		expect(
			validatePropertyDefs([
				{ name: 'flagged', type: 'checkbox' },
				{ name: 'blocked', type: 'checkbox' },
			]),
		).toEqual([]);
		expect(
			validatePropertyDefs([
				{ name: 'accent', type: 'color' },
				{ name: 'other', type: 'color' },
			]),
		).toEqual(['At most one color property is allowed per board.']);
	});

	it('reports duplicate and empty names', () => {
		const diags = validatePropertyDefs([
			{ name: 'due', type: 'datetime' },
			{ name: 'due', type: 'integer' },
			{ name: ' ', type: 'string' },
		]);
		expect(diags).toHaveLength(2);
	});
});
