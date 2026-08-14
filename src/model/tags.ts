// Tags as *text*: a card's tags live in its own line, so the quick-add button
// under the inline editor edits the field's text rather than the board
// (card-content-and-checklists.md §3.1). An op could not be used here — the
// field owns its text until it closes, and would overwrite anything the board
// changed underneath it.
//
// Pure; no `obsidian` imports.

import { extractTags, isTagName } from './parse';
import type { Board } from './types';

export { isTagName };

/** The tags a piece of card text carries, deduped and in order of appearance. */
export function tagsInText(text: string): string[] {
	return extractTags(text).tags;
}

export function hasTag(text: string, tag: string): boolean {
	return tagsInText(text).includes(tag);
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Append `#tag` at the end of the text; a tag already there is left alone. */
export function addTag(text: string, tag: string): string {
	if (hasTag(text, tag)) return text;
	const base = text.replace(/\s+$/, '');
	return base ? `${base} #${tag}` : `#${tag}`;
}

/**
 * Drop every occurrence of `#tag` together with the whitespace in front of it.
 * The lookahead is what keeps a nested tag out: removing `#work` must not touch
 * `#work/urgent`, which is a different tag.
 */
export function removeTag(text: string, tag: string): string {
	const re = new RegExp(`(^|\\s)#${escapeRe(tag)}(?![\\p{L}\\p{N}/_-])`, 'gu');
	return text
		.replace(re, '')
		.replace(/[^\S\r\n]{2,}/g, ' ')
		.trim();
}

export function toggleTag(text: string, tag: string): string {
	return hasTag(text, tag) ? removeTag(text, tag) : addTag(text, tag);
}

/**
 * Every tag this board already knows: the ones its cards carry plus the ones
 * its settings give a color to (a color is a declaration of intent, even when
 * no card wears the tag yet). Sorted, because the list is a menu.
 */
export function boardTags(board: Board): string[] {
	const seen = new Set<string>();
	for (const stack of board.stacks) {
		for (const item of stack.items) {
			if (item.kind !== 'card') continue;
			for (const tag of item.card.tags) seen.add(tag);
		}
	}
	for (const tag of Object.keys(board.config.tagColors)) seen.add(tag);
	return [...seen].sort((a, b) => a.localeCompare(b));
}
