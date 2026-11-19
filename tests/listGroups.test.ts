import { describe, expect, it } from 'vitest';
import { listGroups, moveListGroup } from '../src/model/listGroups';
import { moveStack, setListGroupState, updateView } from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import { boardHead } from './boardFile';

function board() {
	return parseBoard([
		boardHead({ views: [
			{ id: 'v1', name: 'First', type: 'list', sections: { Work: { collapsed: true } } },
			{ id: 'v2', name: 'Second', type: 'list' },
		] }),
		'## To do', '', '### Work', '', '- A #a #b', '',
		'## Done', '', '### Review', '', '- B #c', '',
	].join('\n'));
}

describe('list group presentation', () => {
	it('keeps order and collapse separate by view and grouping across a reload', () => {
		const before = board();
		const sections = listGroups(before, 'section');
		const stacks = listGroups(before, 'stack');
		const tags = listGroups(before, 'tag');
		const changed = setListGroupState(before, 'v1', 'section', () => ({
			order: moveListGroup(sections, undefined, 'Review', 'Work'),
			collapsed: { Work: false, Review: true },
		}));
		const stacked = setListGroupState(changed, 'v1', 'stack', () => ({
			order: moveListGroup(stacks, undefined, stacks[1]!.id, stacks[0]!.id),
			collapsed: { [stacks[1]!.id]: true },
		}));
		const tagged = setListGroupState(stacked, 'v1', 'tag', () => ({
			order: moveListGroup(tags, undefined, 'c', 'a'),
			collapsed: { c: true },
		}));
		expect(tagged.stacks).toBe(before.stacks);

		const reloaded = parseBoard(serializeBoard(updateView(tagged, 'v1', { groupBy: 'tag' })));
		const [first, second] = reloaded.config.views;
		if (first?.type !== 'list') throw new Error('Fixture did not load a list view');
		expect(first.groupBy).toBe('tag');
		expect(first.groupStates).toEqual(tagged.config.views[0]!.type === 'list'
			? tagged.config.views[0]!.groupStates : undefined);
		expect(first.sections).toEqual({ Work: { collapsed: true } });
		expect(first.groupStates?.section?.collapsed?.Work).toBe(false);
		expect(second).not.toHaveProperty('groupStates');
		expect(listGroups(reloaded, 'section', first.groupStates?.section?.order).map(({ id }) => id))
			.toEqual(['', 'Review', 'Work']);
		expect(listGroups(reloaded, 'stack', first.groupStates?.stack?.order).map(({ section }) => section.name))
			.toEqual(['Done', 'To do']);
		expect(listGroups(reloaded, 'tag', first.groupStates?.tag?.order).map(({ id }) => id))
			.toEqual(['', 'c', 'a', 'b']);
	});

	it('retains absent tag ranks while moving visible groups', () => {
		const order = ['b', 'absent', 'a', 'c'];
		const groups = listGroups(board(), 'tag', order);
		const next = moveListGroup(groups, order, 'c', 'a');
		expect(next).toEqual(['b', 'absent', 'c', 'a']);
		expect(listGroups(board(), 'tag', next).map(({ id }) => id)).toEqual(['', 'b', 'c', 'a']);
	});

	it('keeps stack identities attached to names when columns move', () => {
		const before = board();
		const stackIds = listGroups(before, 'stack').map(({ id }) => id);
		const moved = moveStack(before, 0, null);
		expect(listGroups(moved, 'stack', stackIds).map(({ section }) => section.key))
			.toEqual([{ kind: 'stack', index: 1 }, { kind: 'stack', index: 0 }]);
	});
});
