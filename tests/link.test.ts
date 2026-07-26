// Card content links derived from the title — M6.
// Specs: markdown-format.md §4.4, card-content-and-checklists.md §1.

import { describe, it, expect } from 'vitest';
import { parseCardLink, unlinkedTitle } from '../src/model/link';
import { parseCardContent } from '../src/model/parse';
import { serializeBody } from '../src/model/serialize';
import { parseBody } from '../src/model/parse';
import * as ops from '../src/model/ops';
import type { Board, BoardConfig, Card } from '../src/model/types';

const config: BoardConfig = { version: 1, views: [{ id: 'v1', name: 'Board', type: 'kanban' }], activeView: 'v1', properties: [], tagColors: {} };

function boardFromBody(body: string): Board {
	const { preamble, stacks } = parseBody(body, config);
	return { config, frontmatterDoc: null, preamble, stacks, trailing: '' };
}

const cardAt = (board: Board, stack: number, item: number): Card => {
	const entry = board.stacks[stack]?.items[item];
	if (entry?.kind !== 'card') throw new Error('not a card');
	return entry.card;
};

describe('content link: recognized forms', () => {
	it('reads a plain wikilink', () => {
		expect(parseCardLink('[[Redesign onboarding]]')).toMatchObject({
			path: 'Redesign onboarding',
			subpath: '',
			display: 'Redesign onboarding',
			linktext: 'Redesign onboarding',
			wiki: true,
		});
	});

	it('uses the alias as display text and the basename otherwise', () => {
		expect(parseCardLink('[[Cards/Fix login|Fix login]]')?.display).toBe('Fix login');
		expect(parseCardLink('[[Cards/Fix login]]')?.display).toBe('Fix login');
		expect(parseCardLink('[[Cards/Fix login]]')?.path).toBe('Cards/Fix login');
	});

	it('keeps a heading or block fragment in the link', () => {
		expect(parseCardLink('[[Target#Heading]]')).toMatchObject({
			path: 'Target',
			subpath: '#Heading',
			linktext: 'Target#Heading',
		});
		expect(parseCardLink('[[Target#^block]]')?.subpath).toBe('#^block');
	});

	it('reads a Markdown link and decodes its target', () => {
		expect(parseCardLink('[Spec draft](Cards/Spec%20draft.md)')).toMatchObject({
			path: 'Cards/Spec draft.md',
			display: 'Spec draft',
			wiki: false,
		});
		expect(parseCardLink('[](Cards/Spec draft.md)')?.display).toBe('Spec draft');
	});

	it('ignores surrounding whitespace', () => {
		expect(parseCardLink('  [[Note]]  ')?.path).toBe('Note');
		expect(parseCardLink('  [[Note]]  ')?.whole).toBe(true);
	});
});

describe('content link: the first link in the title', () => {
	it('binds a link that sits inside other text', () => {
		expect(parseCardLink('Fix [[login]] bug')).toMatchObject({
			path: 'login',
			display: 'login',
			whole: false,
		});
	});

	it('takes the first of several links', () => {
		expect(parseCardLink('[[A]] [[B]]')?.path).toBe('A');
		expect(parseCardLink('see [A](a.md) and [[B]]')?.path).toBe('a.md');
	});

	it('skips embeds and external links and keeps looking', () => {
		expect(parseCardLink('![[Diagram]] [[Real]]')?.path).toBe('Real');
		expect(parseCardLink('[docs](https://example.com) [[Real]]')?.path).toBe('Real');
	});

	it('reads a wikilink before a Markdown link that starts at the same place', () => {
		expect(parseCardLink('[[Note]](x.md)')).toMatchObject({ path: 'Note', wiki: true });
	});

	it('reports where the link sits in the title', () => {
		const link = parseCardLink('Fix [[login]] bug');
		expect('Fix [[login]] bug'.slice(link?.start ?? 0, link?.end ?? 0)).toBe('[[login]]');
	});
});

describe('content link: what is not a linked card', () => {
	const cases = [
		'![[Target]]',
		'[docs](https://example.com)',
		'[mail](mailto:a@b.c)',
		'[[]]',
		'[[|alias]]',
		'plain title',
		'',
	];
	for (const title of cases) {
		it(`rejects ${JSON.stringify(title)}`, () => {
			expect(parseCardLink(title)).toBeNull();
		});
	}
});

describe('content link: cards on a board', () => {
	it('derives the link from a title carrying tokens and tags', () => {
		const card = parseCardContent('[ ] [[Redesign onboarding]] @{p|1} #ux', config);
		expect(card.title).toBe('[[Redesign onboarding]]');
		expect(parseCardLink(card.title)?.path).toBe('Redesign onboarding');
	});

	it('adds nothing to the file: a linked card round-trips unchanged', () => {
		const body = '## S\n- [ ] [[Cards/Fix login|Fix login]] #bug\n- [Spec draft](Cards/Spec%20draft.md)\n';
		expect(serializeBody(boardFromBody(body))).toBe(body);
	});

	it('unlinks to the display text and leaves an unlinked card alone', () => {
		const b = boardFromBody('## S\n- [[Cards/Fix login|Fix login]] #bug\n- Plain card\n');
		const next = ops.unlinkCardNote(b, { stack: 0, item: 0 });
		expect(cardAt(next, 0, 0).title).toBe('Fix login');
		expect(cardAt(next, 0, 0).tags).toEqual(['bug']);
		expect(ops.unlinkCardNote(b, { stack: 0, item: 1 })).toBe(b);
	});

	it('unlinks only the content link, keeping the rest of the title', () => {
		expect(unlinkedTitle('Fix [[login]] bug')).toBe('Fix login bug');
		expect(unlinkedTitle('[[A]] then [[B]]')).toBe('A then [[B]]');
	});

	it('falls back to the original title when there is no link', () => {
		expect(unlinkedTitle('plain title')).toBe('plain title');
		expect(unlinkedTitle('![[Embedded]]')).toBe('![[Embedded]]');
	});
});
