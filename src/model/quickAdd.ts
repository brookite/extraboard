// The quick-add dialog's model: a draft card held outside the board, where it
// can go, and how it gets there. Spec: docs/specs/quick-add-card.md.
//
// The draft lives on a **scratch board** — the real board plus one extra stack
// holding only the draft card — so the card editor's own badge row, tag picker
// and value editors edit it through ordinary ops, and still see the board's
// configuration and tags. Nothing of that scratch stack ever reaches the file.

import * as ops from './ops';
import { emptyStack } from './ops';
import { sectionName, type SectionKey } from './sections';
import type { Board, Card } from './types';

/** Where a quick-added card goes: a stack, and a named section in it or none. */
export interface QuickDestination {
	stack: number;
	/** A named divider of that stack, or `null` for no section. */
	section: string | null;
}

/** A destination by name, so it survives edits that shift stack indexes. */
export interface RememberedDestination {
	stack: string;
	section: string | null;
}

/** The scratch board and where its draft card sits. */
export interface Draft {
	board: Board;
	ref: ops.ItemRef;
}

/** `board` with an empty draft card in a scratch stack after its last one. */
export function draftOf(board: Board): Draft {
	const stack = emptyStack('');
	stack.items = [{ kind: 'card', card: ops.newCard('', board) }];
	return {
		board: { ...board, stacks: [...board.stacks, stack] },
		ref: { stack: board.stacks.length, item: 0 },
	};
}

/** The draft card as it stands on its scratch board. */
export function draftCard(draft: Draft): Card | null {
	const entry = draft.board.stacks[draft.ref.stack]?.items[draft.ref.item];
	return entry?.kind === 'card' ? entry.card : null;
}

/**
 * The card the dialog adds: the field's text processed exactly as the inline
 * editor processes it (`setCardText`), with the draft's property values kept
 * unless the field shows the raw tokens and so owns them (§4).
 */
export function finalCard(draft: Draft, text: string, showRaw: boolean): Card | null {
	const board = ops.setCardText(draft.board, draft.ref, text, { keepProperties: !showRaw });
	return draftCard({ board, ref: draft.ref });
}

/** A card with nothing in it is not worth adding (§3). */
export function isEmptyCard(card: Card): boolean {
	return !card.title.trim() && !card.tags.length && !card.properties.length && !card.checklist.length;
}

/** The named dividers of one stack, each name once, in board order (§3). */
export function namedSectionsOf(board: Board, stack: number): string[] {
	const names: string[] = [];
	for (const entry of board.stacks[stack]?.items ?? []) {
		if (entry.kind !== 'divider') continue;
		const name = sectionName(entry.divider.name);
		if (name && !names.includes(name)) names.push(name);
	}
	return names;
}

/**
 * The destination to preselect: the remembered one, matched by name, when the
 * board still has it; else the first stack with no section (§3).
 */
export function initialDestination(
	board: Board,
	remembered: RememberedDestination | undefined,
): QuickDestination {
	const found = remembered ? board.stacks.findIndex((s) => s.name === remembered.stack) : -1;
	const stack = found === -1 ? 0 : found;
	const section =
		found !== -1 && remembered?.section && namedSectionsOf(board, stack).includes(remembered.section)
			? remembered.section
			: null;
	return { stack, section };
}

/** A new stack keeps the section only when it has a divider of that name (§3). */
export function withStack(board: Board, dest: QuickDestination, stack: number): QuickDestination {
	const section = dest.section && namedSectionsOf(board, stack).includes(dest.section) ? dest.section : null;
	return { stack, section };
}

export function rememberOf(board: Board, dest: QuickDestination): RememberedDestination | null {
	const stack = board.stacks[dest.stack];
	return stack ? { stack: stack.name, section: dest.section } : null;
}

/**
 * Insert `card` at `dest`, at the top or end of the stack or of the named
 * group as `atTop` says — the board's card-entry rule, decided by the caller
 * (§4). The same board back means nothing was inserted.
 */
export function addQuickCard(board: Board, dest: QuickDestination, card: Card, atTop: boolean): Board {
	const key: SectionKey = dest.section ? { kind: 'named', name: dest.section } : { kind: 'none' };
	return ops.addCardToSectionAt(board, dest.stack, key, card, atTop).board;
}
