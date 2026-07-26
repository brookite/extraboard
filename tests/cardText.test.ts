// The card text processor: every formatting case the multi-line inline editor
// can produce. Spec: card-content-and-checklists.md §3.2.

import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '../src/model/checklist';
import { describeDropped, processCardText } from '../src/model/cardText';
import * as ops from '../src/model/ops';
import { parseBody } from '../src/model/parse';
import { serializeBody } from '../src/model/serialize';
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
	return items.map((i) =>
		i.children.length ? [`${i.marker}:${i.text}`, shape(i.children)] : `${i.marker}:${i.text}`,
	);
}

const ref = { stack: 0, item: 0 };

describe('card text: paragraphs are kept', () => {
	it('folds a multi-line paragraph into one line', () => {
		const r = processCardText('First line\nsecond line\n\nthird line');
		expect(r.text).toBe('First line second line third line');
		expect(r.dropped).toEqual([]);
	});

	it('keeps inline markup, links, tags and property tokens', () => {
		const text = '**Bold** *em* `code` [[Note]] [alias](Note.md) #tag @{priority|2} $x^2$ ~~s~~';
		expect(processCardText(text).text).toBe(text);
	});

	it('keeps a leading #tag, which is not a heading', () => {
		expect(processCardText('#bug follow-up').text).toBe('#bug follow-up');
	});

	it('keeps a lone card checkbox marker, which is not a task list', () => {
		// `[ ] Title` (no bullet) is the card's own marker, handled downstream.
		const r = processCardText('[ ] Title');
		expect(r.text).toBe('[ ] Title');
		expect(r.checklist).toEqual([]);
	});
});

describe('card text: task lines become the checklist', () => {
	it('lifts them out at any indent, with any bullet', () => {
		const r = processCardText('Title\n- [ ] dash\n* [x] star\n+ [/] plus\n1. [ ] ordered');
		expect(r.text).toBe('Title');
		expect(shape(r.checklist)).toEqual([' :dash', 'x:star', '/:plus', ' :ordered']);
	});

	it('nests by relative indent when the user does indent', () => {
		const r = processCardText('Title\n- [ ] a\n\t- [ ] a1\n\t\t- [x] a2\n- [ ] b');
		expect(shape(r.checklist)).toEqual([[' :a', [[' :a1', ['x:a2']]]], ' :b']);
	});

	it('treats an unindented list as flat, tabs or not', () => {
		expect(shape(processCardText('- [ ] a\n- [ ] b').checklist)).toEqual([' :a', ' :b']);
		expect(shape(processCardText('\t- [ ] a\n\t- [ ] b').checklist)).toEqual([' :a', ' :b']);
	});

	it('collects task lines even when prose sits between them', () => {
		const r = processCardText('Title\n- [ ] a\nmore prose\n- [x] b');
		expect(r.text).toBe('Title more prose');
		expect(shape(r.checklist)).toEqual([' :a', 'x:b']);
	});

	it('keeps custom markers verbatim and accepts an empty item', () => {
		expect(shape(processCardText('- [-] paused\n- [ ]').checklist)).toEqual(['-:paused', ' :']);
	});

	it('does not mistake links for task markers', () => {
		const r = processCardText('- [[Note]]\n- [alias](Note.md)');
		expect(r.checklist).toEqual([]);
		expect(r.dropped).toEqual(['list']);
	});
});

describe('card text: block constructs are removed', () => {
	const cases: [string, string, string][] = [
		['plain bullet', 'Title\n- item\n* item\n+ item', 'list'],
		['ordered list', 'Title\n1. item\n2) item', 'list'],
		['blockquote', 'Title\n> quoted', 'quote'],
		['callout', 'Title\n> [!note] Heads up\n> body', 'quote'],
		['heading', 'Title\n# Heading\n###### Six', 'heading'],
		['thematic break', 'Title\n---\n***\n___', 'rule'],
		['table', 'Title\n| a | b |\n| - | - |', 'table'],
		['raw HTML', 'Title\n<div>x</div>', 'html'],
		['image', 'Title\n![alt](pic.png)', 'image'],
		['embed', 'Title\n![[pic.png]]', 'image'],
	];
	for (const [name, input, kind] of cases) {
		it(`removes a ${name}`, () => {
			const r = processCardText(input);
			expect(r.text).toBe('Title');
			expect(r.dropped).toEqual([kind]);
		});
	}

	it('removes a fenced code block with its contents', () => {
		const r = processCardText('Title\n```ts\nconst x = 1;\n# not a heading\n```\ntail');
		expect(r.text).toBe('Title tail');
		expect(r.dropped).toEqual(['code']);
	});

	it('removes a tilde fence and an unterminated one', () => {
		expect(processCardText('Title\n~~~\nx\n~~~\ntail').text).toBe('Title tail');
		expect(processCardText('Title\n```\nrest of the card').text).toBe('Title');
	});

	it('removes block math but keeps inline math', () => {
		expect(processCardText('Title\n$$\nE=mc^2\n$$\ntail').text).toBe('Title tail');
		expect(processCardText('Title\n$$E=mc^2$$\ntail').text).toBe('Title tail');
		expect(processCardText('Title with $E=mc^2$ inline').text).toBe('Title with $E=mc^2$ inline');
	});

	it('strips an image out of a line but keeps the rest of it', () => {
		const r = processCardText('Before ![[pic.png]] after');
		expect(r.text).toBe('Before after');
		expect(r.dropped).toEqual(['image']);
	});

	it('reports every kind it removed, once each, in first-seen order', () => {
		const r = processCardText('T\n> q\n- item\n# h\n- other');
		expect(r.dropped).toEqual(['quote', 'list', 'heading']);
		expect(describeDropped(r.dropped)).toBe(
			'A card holds one line of text: quotes, lists and headings were removed.',
		);
	});

	it('says nothing when nothing was removed', () => {
		expect(describeDropped([])).toBe('');
	});
});

describe('card text: processing is idempotent', () => {
	const inputs = [
		'Title\n- [ ] a\n> quote\n# heading',
		'**Bold** #tag @{priority|1}',
		'![[pic.png]]\n- item',
	];
	for (const input of inputs) {
		it(`re-processing ${JSON.stringify(input.slice(0, 20))} changes nothing`, () => {
			const once = processCardText(input);
			const twice = processCardText(once.text);
			expect(twice.text).toBe(once.text);
			expect(twice.checklist).toEqual([]);
			expect(twice.dropped).toEqual([]);
		});
	}
});

describe('card text: through the board', () => {
	const board = (): Board => boardFromBody('## S\n- Card @{priority|1} #bug\n\t- [x] existing\n');

	it('prepends a typed checklist before the existing one', () => {
		const next = ops.setCardText(board(), ref, 'Card\n- [ ] typed', { keepProperties: true });
		expect(shape(cardAt(next, 0, 0).checklist)).toEqual([' :typed', 'x:existing']);
	});

	it('leaves the existing checklist alone when none was typed', () => {
		const next = ops.setCardText(board(), ref, 'Renamed', { keepProperties: true });
		expect(shape(cardAt(next, 0, 0).checklist)).toEqual(['x:existing']);
	});

	it('produces one card and a valid file, whatever was typed', () => {
		const typed = 'Title #ux\n- [ ] one\n> quote\n# heading\n- plain\nmore text';
		const next = ops.setCardText(board(), ref, typed, { keepProperties: true });
		const out = serializeBody(next);
		expect(out).toBe('## S\n\n- Title more text @{priority|1} #ux\n\t- [ ] one\n\t- [x] existing\n');
		// And what comes back out is what went in.
		expect(serializeBody(boardFromBody(out))).toBe(out);
	});

	it('applies to the add-card composer too', () => {
		const next = ops.addCard(boardFromBody('## S\n'), 0, 'New\n- [ ] step\n> quote');
		const card = cardAt(next, 0, 0);
		expect(card.title).toBe('New');
		expect(shape(card.checklist)).toEqual([' :step']);
	});
});
