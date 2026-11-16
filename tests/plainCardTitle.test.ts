import { describe, expect, it } from 'vitest';
import { plainCardTitle } from '../src/model/plainCardTitle';

describe('plain card titles', () => {
	it.each([
		['[[Folder/Note|Label]]', 'Label'],
		['[[Folder/Note.md#Heading]]', 'Note'],
		['Read [[One|first]] and [[Folder/Two]]', 'Read first and Two'],
		['[Alias](Folder/Note.md) and [website](https://example.com)', 'Alias and website'],
		['[An [inner] label](https://example.com/path_(one))', 'An [inner] label'],
		['[[Note|**Bold**]] and [*italic*](note.md "title")', 'Bold and italic'],
		['**Bold** *italic* __strong__ _em_ ~~old~~ ==mark==', 'Bold italic strong em old mark'],
		['***nested*** and **a**', 'nested and a'],
		['some_identifier and 2 * 3 = 6', 'some_identifier and 2 * 3 = 6'],
		['(*first*) _second_ and word_inside_word', '(first) second and word_inside_word'],
		['`**literal** [[Note]]` and **bold**', '**literal** [[Note]] and bold'],
		['``a `tick` here``', 'a `tick` here'],
		['\\*literal\\* and \\[brackets\\]', '*literal* and [brackets]'],
		['<b>Text</b> &amp; &#x41; &#1040;', 'Text & A А'],
		['<https://example.com> and <mailto:a@example.com>', 'https://example.com and a@example.com'],
		['Title %%hidden%% <!--comment--> after', 'Title after'],
		['![[Folder/Image|Picture]] and ![Alt](image.png)', 'Picture and Alt'],
		[' \n [[Note|Name]]   **title** \t', 'Name title'],
		['%%hidden%%', ''],
		['<b></b>', ''],
		['unmatched ** and [[ brackets', 'unmatched ** and [[ brackets'],
	])('converts %s to readable text', (title, expected) => {
		expect(plainCardTitle(title)).toBe(expected);
	});
});
