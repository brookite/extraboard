// M13: the list view's edits — section moves, cards inside sections, and cards
// with no section. Spec: docs/specs/list-view.md §4.
//
// Every test that changes the board runs it through `intact()`: re-serializing
// and re-parsing must reproduce the very same tree, and serializing again must
// reproduce the very same text. That is the user's own acceptance criterion for
// this milestone — the file must not break — stated once and applied everywhere.

import { describe, it, expect } from 'vitest';
import * as ops from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import { sectionOf, sectionOrder, sectionsOf } from '../src/model/sections';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead();

const BOARD = [
	FM,
	'## To do',
	'',
	'- Loose A',
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
	'## Doing',
	'',
	'- Loose B',
	'',
	'### Review',
	'',
	'- R2',
	'',
	'---',
	'',
	'- Anon card',
	'',
	'## Done %%completes%%',
	'',
	'### Backlog',
	'',
	'- B3',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);
const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);

/** The file survives the edit: parse ∘ serialize is the identity on the tree. */
function intact(b: Board): Board {
	const text = serializeBoard(b);
	const reparsed = parseBoard(text);
	expect(reparsed).toEqual(b);
	expect(serializeBoard(reparsed)).toBe(text);
	return b;
}

const named = (name: string) => ({ kind: 'named' as const, name });
const NONE = { kind: 'none' as const };

const titlesOf = (b: Board, stack: number): string[] =>
	b.stacks[stack]!.items.map((entry) =>
		entry.kind === 'card' ? entry.card.title : `### ${entry.divider.name ?? '---'}`,
	);

describe('sections: moving a section', () => {
	it('moves the divider and its whole group in every stack that holds it', () => {
		const next = intact(ops.moveSection(board(), 'Review', 'Backlog'));
		expect(titlesOf(next, 0)).toEqual(['Loose A', '### Review', 'R1', '### Backlog', 'B1', 'B2']);
		expect(sectionOrder(next)).toEqual(['Review', 'Backlog']);
	});

	it('moves a section to the end of every stack that holds it', () => {
		const next = intact(ops.moveSection(board(), 'Backlog', null));
		expect(titlesOf(next, 0)).toEqual(['Loose A', '### Review', 'R1', '### Backlog', 'B1', 'B2']);
		// The anonymous group is the last thing in "Doing", so Backlog would land
		// after it — but "Doing" holds no Backlog, so it is not touched at all.
		expect(titlesOf(next, 1)).toEqual(['Loose B', '### Review', 'R2', '### ---', 'Anon card']);
		expect(titlesOf(next, 2)).toEqual(['### Backlog', 'B3']);
	});

	it('leaves a stack alone when it has nothing to move the section in front of', () => {
		const before = board();
		const next = intact(ops.moveSection(before, 'Backlog', 'Review'));
		// "Done" holds Backlog but no Review: its layout says nothing about the
		// order of the two, so it keeps it.
		expect(titlesOf(next, 2)).toEqual(['### Backlog', 'B3']);
		expect(next.stacks[2]).toBe(before.stacks[2]);
	});

	it('is a no-op when every stack already has the section where it is asked for', () => {
		const before = board();
		// Backlog already precedes Review in the only stack holding both.
		expect(ops.moveSection(before, 'Backlog', 'Review')).toBe(before);
		// Review last, though, is not where "Doing" has it: the anonymous group
		// sits below it there, so that stack does move.
		const next = intact(ops.moveSection(before, 'Review', null));
		expect(next.stacks[0]).toBe(before.stacks[0]);
		expect(titlesOf(next, 1)).toEqual(['Loose B', '### ---', 'Anon card', '### Review', 'R2']);
	});

	it('is a no-op for an unknown section, for itself and for the sectionless group', () => {
		const before = board();
		expect(ops.moveSection(before, 'Nope', null)).toBe(before);
		expect(ops.moveSection(before, 'Backlog', 'Backlog')).toBe(before);
		expect(ops.moveSection(before, '', null)).toBe(before);
	});

	it('moves the last section to the front and back again', () => {
		const first = intact(ops.moveSection(board(), 'Review', 'Backlog'));
		const back = intact(ops.moveSection(first, 'Backlog', 'Review'));
		expect(body(back)).toBe(body(board()));
	});

	it('keeps cards, checklists and markers of the moved group', () => {
		const text = [
			FM,
			'## S',
			'',
			'### A',
			'',
			'- [ ] one',
			'\t- [x] sub',
			'',
			'### B',
			'',
			'- two',
			'',
		].join('\n');
		const next = intact(ops.moveSection(parseBoard(text), 'B', 'A'));
		expect(body(next)).toBe(
			['## S', '', '### B', '', '- two', '', '### A', '', '- [ ] one', '\t- [x] sub', ''].join('\n'),
		);
	});
});

describe('sections: adding a card', () => {
	it('adds to the end of the section’s group in the chosen stack', () => {
		const next = intact(ops.addCardToSection(board(), 0, named('Backlog'), 'B4'));
		expect(titlesOf(next, 0)).toEqual(['Loose A', '### Backlog', 'B1', 'B2', 'B4', '### Review', 'R1']);
	});

	it('creates the divider in a stack that does not hold the section yet', () => {
		const next = intact(ops.addCardToSection(board(), 1, named('Backlog'), 'B5'));
		// Backlog precedes Review globally, so it lands in front of Doing's Review.
		expect(titlesOf(next, 1)).toEqual([
			'Loose B',
			'### Backlog',
			'B5',
			'### Review',
			'R2',
			'### ---',
			'Anon card',
		]);
	});

	it('appends the new divider when no later section is present in that stack', () => {
		const text = [FM, '## S', '', '- loose', '', '### Review', '', '- r', ''].join('\n');
		const b = parseBoard(text);
		// "Zebra" is unknown to the board, so it has no global position and goes last.
		const next = intact(ops.addCardToSection(b, 0, named('Zebra'), 'z'));
		expect(titlesOf(next, 0)).toEqual(['loose', '### Review', 'r', '### Zebra', 'z']);
	});

	it('adds to the sectionless group at its end, or at the top on request', () => {
		const end = intact(ops.addCardToSection(board(), 0, NONE, 'Loose C'));
		expect(titlesOf(end, 0).slice(0, 3)).toEqual(['Loose A', 'Loose C', '### Backlog']);
		const top = intact(ops.addCardToSection(board(), 0, NONE, 'Loose C', true));
		expect(titlesOf(top, 0).slice(0, 3)).toEqual(['Loose C', 'Loose A', '### Backlog']);
	});

	it('adds to an anonymous section by its divider', () => {
		const anon = sectionsOf(board()).find((s) => s.key.kind === 'anon')!.key;
		const next = intact(ops.addCardToSection(board(), 1, anon, 'Anon 2'));
		expect(titlesOf(next, 1)).toEqual(['Loose B', '### Review', 'R2', '### ---', 'Anon card', 'Anon 2']);
	});

	it('completes a card added to a completing stack', () => {
		const next = intact(ops.addCardToSection(board(), 2, named('Backlog'), 'B6'));
		const entry = next.stacks[2]!.items[2];
		expect(entry?.kind === 'card' && entry.card.task).toBe('x');
	});

	it('refuses an unknown stack and an anonymous section from another stack', () => {
		const before = board();
		expect(ops.addCardToSection(before, 9, NONE, 'x')).toBe(before);
		const anon = sectionsOf(before).find((s) => s.key.kind === 'anon')!.key;
		expect(ops.addCardToSection(before, 0, anon, 'x')).toBe(before);
	});

	it('reports where the card landed, so the composer can open it', () => {
		// End of the group, in the stack that already holds the section.
		expect(ops.addCardToSectionAt(board(), 0, named('Backlog'), 'B4').ref).toEqual({ stack: 0, item: 4 });
		// Past the divider this very call had to create.
		expect(ops.addCardToSectionAt(board(), 1, named('Backlog'), 'B5').ref).toEqual({ stack: 1, item: 2 });
		// The sectionless group, both ends.
		expect(ops.addCardToSectionAt(board(), 0, NONE, 'x').ref).toEqual({ stack: 0, item: 1 });
		expect(ops.addCardToSectionAt(board(), 0, NONE, 'x', true).ref).toEqual({ stack: 0, item: 0 });
	});

	it('reports the card it created is the card at that ref', () => {
		const { board: next, ref } = ops.addCardToSectionAt(board(), 1, named('Backlog'), 'B5');
		intact(next);
		const entry = ref ? next.stacks[ref.stack]?.items[ref.item] : undefined;
		expect(entry?.kind === 'card' && entry.card.title).toBe('B5');
	});

	it('reports no ref when nothing was inserted', () => {
		const anon = sectionsOf(board()).find((s) => s.key.kind === 'anon')!.key;
		expect(ops.addCardToSectionAt(board(), 9, NONE, 'x').ref).toBeNull();
		expect(ops.addCardToSectionAt(board(), 0, anon, 'x').ref).toBeNull();
	});

	it('creates a section in an empty stack', () => {
		const text = [FM, '## Empty', ''].join('\n');
		const next = intact(ops.addCardToSection(parseBoard(text), 0, named('New'), 'first'));
		expect(body(next)).toBe(['## Empty', '', '### New', '', '- first', ''].join('\n'));
	});
});

describe('sections: adding an empty named section', () => {
	it('appends its divider to the first stack after every card', () => {
		const next = intact(ops.addSection(board(), 'New section'));
		expect(titlesOf(next, 0)).toEqual([
			'Loose A',
			'### Backlog',
			'B1',
			'B2',
			'### Review',
			'R1',
			'### New section',
		]);
		expect(titlesOf(next, 1)).not.toContain('### New section');
		expect(titlesOf(next, 2)).not.toContain('### New section');
	});

	it('trims the name and refuses an empty, existing, or stackless section', () => {
		const trimmed = intact(ops.addSection(board(), '  New section  '));
		expect(titlesOf(trimmed, 0).at(-1)).toBe('### New section');

		const before = board();
		expect(ops.addSection(before, '  ')).toBe(before);
		expect(ops.addSection(before, 'Backlog')).toBe(before);

		const stackless = parseBoard([FM, ''].join('\n'));
		expect(ops.addSection(stackless, 'New section')).toBe(stackless);
	});
});

describe('sections: moving a card', () => {
	it('moves a card into another section of its own stack', () => {
		const next = intact(ops.moveCardToSection(board(), { stack: 0, item: 0 }, 0, named('Review')));
		expect(titlesOf(next, 0)).toEqual(['### Backlog', 'B1', 'B2', '### Review', 'R1', 'Loose A']);
		expect(sectionOf(next, { stack: 0, item: 5 })).toEqual(named('Review'));
	});

	it('puts a menu-style section move at the top of its target group when requested', () => {
		const next = intact(
			ops.moveCardToSection(board(), { stack: 0, item: 0 }, 0, named('Review'), null, true),
		);
		expect(titlesOf(next, 0)).toEqual(['### Backlog', 'B1', 'B2', '### Review', 'Loose A', 'R1']);
	});

	it('moves a card out of a section into the sectionless group', () => {
		const next = intact(ops.moveCardToSection(board(), { stack: 0, item: 2 }, 0, NONE));
		expect(titlesOf(next, 0)).toEqual(['Loose A', 'B1', '### Backlog', 'B2', '### Review', 'R1']);
	});

	it('creates the section in the card’s stack when it has none', () => {
		const next = intact(ops.moveCardToSection(board(), { stack: 1, item: 0 }, 1, named('Backlog')));
		expect(titlesOf(next, 1)).toEqual([
			'### Backlog',
			'Loose B',
			'### Review',
			'R2',
			'### ---',
			'Anon card',
		]);
	});

	it('lands in front of the card it was dropped on', () => {
		const next = intact(
			ops.moveCardToSection(board(), { stack: 0, item: 0 }, 0, named('Backlog'), { stack: 0, item: 3 }),
		);
		expect(titlesOf(next, 0)).toEqual(['### Backlog', 'B1', 'Loose A', 'B2', '### Review', 'R1']);
	});

	it('reorders two cards inside one section', () => {
		const next = intact(
			ops.moveCardToSection(board(), { stack: 0, item: 3 }, 0, named('Backlog'), { stack: 0, item: 2 }),
		);
		expect(titlesOf(next, 0)).toEqual(['Loose A', '### Backlog', 'B2', 'B1', '### Review', 'R1']);
	});

	it('ignores a drop target that is not a card of the destination stack', () => {
		const next = intact(
			ops.moveCardToSection(board(), { stack: 0, item: 0 }, 0, named('Backlog'), { stack: 1, item: 4 }),
		);
		expect(titlesOf(next, 0)).toEqual(['### Backlog', 'B1', 'B2', 'Loose A', '### Review', 'R1']);
	});

	it('moves a card to another stack keeping its section, creating it there', () => {
		const next = intact(ops.moveCardToStack(board(), { stack: 0, item: 2 }, 1));
		expect(titlesOf(next, 0)).toEqual(['Loose A', '### Backlog', 'B2', '### Review', 'R1']);
		expect(titlesOf(next, 1)).toEqual([
			'Loose B',
			'### Backlog',
			'B1',
			'### Review',
			'R2',
			'### ---',
			'Anon card',
		]);
	});

	it('moves a sectionless card to another stack’s sectionless group', () => {
		const next = intact(ops.moveCardToStack(board(), { stack: 0, item: 0 }, 1));
		expect(titlesOf(next, 1)).toEqual([
			'Loose B',
			'Loose A',
			'### Review',
			'R2',
			'### ---',
			'Anon card',
		]);
	});

	it('completes a card moved into a completing stack', () => {
		const next = intact(ops.moveCardToStack(board(), { stack: 0, item: 2 }, 2));
		const entry = next.stacks[2]!.items[2];
		expect(entry?.kind === 'card' && entry.card.task).toBe('x');
	});

	it('is a no-op for a divider, an unknown stack and a move onto its own stack', () => {
		const before = board();
		expect(ops.moveCardToSection(before, { stack: 0, item: 1 }, 0, NONE)).toBe(before);
		expect(ops.moveCardToSection(before, { stack: 0, item: 0 }, 9, NONE)).toBe(before);
		expect(ops.moveCardToStack(before, { stack: 0, item: 0 }, 0)).toBe(before);
		expect(ops.moveCardToSection(before, { stack: 0, item: 0 }, 0, NONE)).toBe(before);
	});
});

describe('sections: renaming and removing', () => {
	it('renames the divider in every stack', () => {
		const next = intact(ops.renameSection(board(), 'Backlog', 'Later'));
		expect(sectionOrder(next)).toEqual(['Later', 'Review']);
		expect(titlesOf(next, 2)).toEqual(['### Later', 'B3']);
	});

	it('merges into an existing section when renamed onto its name', () => {
		const next = intact(ops.renameSection(board(), 'Review', 'Backlog'));
		expect(sectionOrder(next)).toEqual(['Backlog']);
		const backlog = sectionsOf(next).find((s) => s.name === 'Backlog')!;
		// Two dividers of each name, all four now reading `### Backlog`.
		expect(backlog.dividers).toHaveLength(4);
		expect(backlog.cards).toHaveLength(5);
	});

	it('refuses an empty name and a rename to itself', () => {
		const before = board();
		expect(ops.renameSection(before, 'Backlog', '  ')).toBe(before);
		expect(ops.renameSection(before, 'Backlog', 'Backlog')).toBe(before);
		expect(ops.renameSection(before, '', 'x')).toBe(before);
		expect(ops.renameSection(before, 'Nope', 'x')).toBe(before);
	});

	it('names an anonymous divider into an existing section', () => {
		const anon = sectionsOf(board()).find((s) => s.key.kind === 'anon')!;
		const ref = anon.dividers[0]!;
		const next = intact(ops.renameDivider(board(), ref, 'Review'));
		expect(sectionOrder(next)).toEqual(['Backlog', 'Review']);
		expect(sectionsOf(next).some((s) => s.key.kind === 'anon')).toBe(false);
	});

	it('removes a section everywhere and keeps its cards', () => {
		const next = intact(ops.removeSection(board(), 'Backlog'));
		expect(sectionOrder(next)).toEqual(['Review']);
		expect(titlesOf(next, 0)).toEqual(['Loose A', 'B1', 'B2', '### Review', 'R1']);
		expect(titlesOf(next, 2)).toEqual(['B3']);
		expect(sectionOf(next, { stack: 0, item: 1 })).toEqual(NONE);
	});

	it('is a no-op removing an unknown or empty name', () => {
		const before = board();
		expect(ops.removeSection(before, 'Nope')).toBe(before);
		expect(ops.removeSection(before, '')).toBe(before);
	});

	it('leaves anonymous sections alone when a named one goes', () => {
		const next = intact(ops.removeSection(board(), 'Review'));
		expect(titlesOf(next, 1)).toEqual(['Loose B', 'R2', '### ---', 'Anon card']);
	});
});

describe('sections: blank lines stay canonical', () => {
	it('keeps the canonical layout after a section move', () => {
		const next = ops.moveSection(board(), 'Review', 'Backlog');
		expect(body(next)).toBe(
			[
				'## To do',
				'',
				'- Loose A',
				'',
				'### Review',
				'',
				'- R1',
				'',
				'### Backlog',
				'',
				'- B1',
				'- B2',
				'',
				'## Doing',
				'',
				'- Loose B',
				'',
				'### Review',
				'',
				'- R2',
				'',
				'---',
				'',
				'- Anon card',
				'',
				'## Done %%completes%%',
				'',
				'### Backlog',
				'',
				'- B3',
				'',
			].join('\n'),
		);
	});

	it('keeps the canonical layout after a card is added to a new section', () => {
		const next = ops.addCardToSection(board(), 1, named('Backlog'), 'B5');
		expect(body(next).split('\n').slice(0, 11)).toEqual([
			'## To do',
			'',
			'- Loose A',
			'',
			'### Backlog',
			'',
			'- B1',
			'- B2',
			'',
			'### Review',
			'',
		]);
		expect(body(next)).toContain(['- Loose B', '', '### Backlog', '', '- B5', '', '### Review'].join('\n'));
	});

	it('keeps the canonical layout after a card leaves a section', () => {
		const next = ops.moveCardToSection(board(), { stack: 0, item: 2 }, 0, NONE);
		expect(body(next).split('\n').slice(0, 9)).toEqual([
			'## To do',
			'',
			'- Loose A',
			'- B1',
			'',
			'### Backlog',
			'',
			'- B2',
			'',
		]);
	});
});

describe('sections: view state', () => {
	const listBoard = (): Board =>
		parseBoard(
			[
				boardHead({
					views: [{ id: 'v1', name: 'List', type: 'list' }],
					properties: [{ name: 'due', type: 'datetime' }],
				}),
				'## To do',
				'',
				'- a',
				'',
			].join('\n'),
		);

	it('writes a section’s collapse into the view', () => {
		const next = intact(ops.setSectionState(listBoard(), 'v1', 'Backlog', { collapsed: true }));
		const view = next.config.views[0]!;
		expect(view.type === 'list' && view.sections?.Backlog).toEqual({ collapsed: true });
		expect(serializeBoard(next)).toContain('"Backlog"');
	});

	it('prunes a section back out of the view when its state is cleared', () => {
		const set = ops.setSectionState(listBoard(), 'v1', '', { collapsed: true });
		const cleared = intact(ops.setSectionState(set, 'v1', '', { collapsed: false }));
		const view = cleared.config.views[0]!;
		expect(view.type === 'list' && view.sections).toBeUndefined();
		expect(serializeBoard(cleared)).toBe(serializeBoard(listBoard()));
	});

	it('keeps one section’s collapse while another changes', () => {
		const first = ops.setSectionState(listBoard(), 'v1', '', { collapsed: true });
		const second = intact(ops.setSectionState(first, 'v1', 'Backlog', { collapsed: true }));
		const view = second.config.views[0]!;
		expect(view.type === 'list' && view.sections).toEqual({
			'': { collapsed: true },
			Backlog: { collapsed: true },
		});
	});

	it('is a no-op for an unchanged state, a Kanban view and an unknown id', () => {
		const before = listBoard();
		expect(ops.setSectionState(before, 'v1', '', {})).toBe(before);
		expect(ops.setSectionState(before, 'v1', '', { collapsed: false })).toBe(before);
		expect(ops.setSectionState(before, 'nope', '', { collapsed: true })).toBe(before);
		expect(ops.setSectionState(parseBoard(BOARD), 'v1', '', { collapsed: true })).toEqual(parseBoard(BOARD));
	});

	it('updates the view-wide controls', () => {
		const next = intact(ops.updateView(listBoard(), 'v1', { controls: 'fixed' }));
		const view = next.config.views[0]!;
		expect(view.type === 'list' && view.controls).toBe('fixed');
	});

	it('sets and clears the view-wide filter and sort keys', () => {
		const filter = {
			kind: 'group' as const,
			op: 'and' as const,
			children: [
				{
					kind: 'condition' as const,
					field: { kind: 'builtin' as const, id: 'tags' as const },
					op: 'contains' as const,
					value: 'bug',
				},
			],
		};
		const sorts = [{ field: { kind: 'property' as const, name: 'due' }, dir: 'desc' as const }];
		const set = intact(ops.setViewSorts(ops.setViewFilter(listBoard(), 'v1', filter), 'v1', sorts));
		const view = set.config.views[0]!;
		expect(view.type === 'list' && view.filter).toEqual(filter);
		expect(view.type === 'list' && view.sorts).toEqual(sorts);
		expect(serializeBoard(set)).toContain('"field":"@tags"');
		expect(serializeBoard(set)).toContain('"sorts":[{"field":"due","dir":"desc"}]');

		// Setting the same thing twice changes nothing, and clearing drops the keys.
		expect(ops.setViewFilter(set, 'v1', filter)).toBe(set);
		const cleared = intact(ops.setViewSorts(ops.setViewFilter(set, 'v1', null), 'v1', []));
		const bare = cleared.config.views[0]!;
		expect(bare.type === 'list' && 'filter' in bare).toBe(false);
		expect(bare.type === 'list' && 'sorts' in bare).toBe(false);
		expect(serializeBoard(cleared)).toBe(serializeBoard(listBoard()));
	});

	it('an empty group is not a filter, so it drops the key too', () => {
		const before = listBoard();
		expect(ops.setViewFilter(before, 'v1', { kind: 'group', op: 'and', children: [] })).toBe(before);
	});
});
