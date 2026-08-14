// Tag editing as text, behind the quick-add button under the inline editor.
// Spec: card-content-and-checklists.md §3.1.

import { describe, it, expect } from 'vitest';
import {
	addTag,
	boardTags,
	hasTag,
	isTagName,
	removeTag,
	tagsInText,
	toggleTag,
} from '../src/model/tags';
import { parseBody } from '../src/model/parse';
import type { Board, BoardConfig } from '../src/model/types';

const config: BoardConfig = {
	version: 1,
	views: [{ id: 'v1', name: 'Board', type: 'kanban' }],
	activeView: 'v1',
	properties: [],
	tagColors: { released: { bg: '#fff' } },
};

function boardFromBody(body: string): Board {
	const { preamble, stacks } = parseBody(body, config);
	return { config, frontmatter: null, preamble, stacks, trailing: '' };
}

describe('tagsInText', () => {
	it('reads the tags a card line carries', () => {
		expect(tagsInText('Ship it #work #work/urgent')).toEqual(['work', 'work/urgent']);
	});

	it('agrees with the parser about what is not a tag', () => {
		expect(tagsInText('Fix #2026 and a#b')).toEqual([]);
	});
});

describe('addTag', () => {
	it('appends the tag at the end', () => {
		expect(addTag('Ship it', 'work')).toBe('Ship it #work');
	});

	it('does not add a tag twice', () => {
		expect(addTag('Ship it #work', 'work')).toBe('Ship it #work');
	});

	it('is the whole text when there was none', () => {
		expect(addTag('   ', 'work')).toBe('#work');
	});
});

describe('removeTag', () => {
	it('takes the tag and its leading space', () => {
		expect(removeTag('Ship it #work now', 'work')).toBe('Ship it now');
	});

	it('leaves a nested tag alone', () => {
		expect(removeTag('Ship it #work/urgent', 'work')).toBe('Ship it #work/urgent');
		expect(removeTag('Ship it #work #work/urgent', 'work')).toBe('Ship it #work/urgent');
	});

	it('removes every occurrence', () => {
		expect(removeTag('#work Ship it #work', 'work')).toBe('Ship it');
	});

	it('keeps line breaks the field may hold', () => {
		expect(removeTag('Ship it\n#work\nsoon', 'work')).toBe('Ship it\nsoon');
	});
});

describe('toggleTag', () => {
	it('adds what is missing and removes what is there', () => {
		expect(toggleTag('Ship it', 'work')).toBe('Ship it #work');
		expect(toggleTag('Ship it #work', 'work')).toBe('Ship it');
		expect(hasTag(toggleTag('Ship it', 'work'), 'work')).toBe(true);
	});
});

describe('isTagName', () => {
	it('accepts what the parser would read back as a tag', () => {
		expect(isTagName('work')).toBe(true);
		expect(isTagName('work/urgent')).toBe(true);
		expect(isTagName('важно')).toBe(true);
		expect(isTagName('_v2-final')).toBe(true);
	});

	it('rejects what it would not', () => {
		expect(isTagName('')).toBe(false);
		expect(isTagName('2026')).toBe(false);
		expect(isTagName('-lead')).toBe(false);
		expect(isTagName('two words')).toBe(false);
		expect(isTagName('#work')).toBe(false);
	});

	it('agrees with the parser on everything it accepts', () => {
		for (const name of ['work', 'work/urgent', 'важно', '_v2-final']) {
			expect(tagsInText(`Card #${name}`)).toEqual([name]);
		}
	});
});

describe('boardTags', () => {
	it('offers the cards’ tags and the colored ones, sorted and deduped', () => {
		const board = boardFromBody('## Todo\n\n- One #beta #alpha\n- Two #alpha\n');
		expect(boardTags(board)).toEqual(['alpha', 'beta', 'released']);
	});
});
