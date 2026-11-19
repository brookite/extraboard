import { describe, expect, it, vi } from 'vitest';
import { SectionGroup, type SectionProps } from '../src/view/components/Section';
import { CardTile } from '../src/view/components/Card';
import { groupsOf, placesOf } from '../src/model/sections';
import { setCardText } from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import type { Board, Card } from '../src/model/types';
import { t } from '../src/i18n';
import { DEFAULT_SETTINGS } from '../src/settings';
import { boardHead } from './boardFile';

// Exercise the real group renderer and badge callbacks without Obsidian's DOM.
vi.mock('obsidian', () => ({ Menu: class {}, setIcon: vi.fn(), Platform: { isMobile: false } }));
vi.mock('preact/hooks', () => ({
	useEffect: vi.fn(),
	useRef: () => ({ current: null }),
	useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('../src/view/useSortable', () => ({ useSortable: vi.fn() }));
vi.mock('../src/view/components/Card', () => ({ CardTile: () => null }));
vi.mock('../src/view/components/InlineEditor', () => ({ InlineEditor: () => null }));
vi.mock('../src/ui/StackModal', () => ({ editStack: vi.fn() }));

interface Node {
	type: unknown;
	props: Record<string, unknown>;
}
function nodes(value: unknown): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes);
	if (value === null || typeof value !== 'object' || !('props' in value)) return [];
	const node = value as Node;
	return [node, ...nodes(node.props.children)];
}

function renderGroup(initial: Board, section: SectionProps['section'], ungrouped = false, locked = false) {
	let board = initial;
	const onSectionPick = vi.fn();
	const props: SectionProps = {
		board, section, where: placesOf(board), ungrouped, index: 0, config: board.config, rows: section.cards,
		state: { collapsed: true }, ordered: true, settings: DEFAULT_SETTINGS,
		api: { update: (mutate) => { board = mutate(board); } } as SectionProps['api'],
		composerStack: 0, onComposerStack: vi.fn(), composerSection: { kind: 'none' },
		onComposerSection: vi.fn(), onState: vi.fn(), onAddCard: vi.fn(), pending: null,
		onDrop: vi.fn(), menuExtra: vi.fn(), onStackPick: vi.fn(), onSectionPick,
		canMoveUp: false, canMoveDown: false,
		...(!locked && section.movable && { onMove: vi.fn() }),
	};
	return { rendered: nodes(SectionGroup(props)), board: () => board, props };
}

function setup(ungrouped = true) {
	const board = parseBoard(`${boardHead()}\n## To do\n\n### Work\n\n- Task\n\n## Done\n`);
	const section = groupsOf(board, ungrouped ? 'none' : 'section')[ungrouped ? 0 : 1]!;
	return renderGroup(board, section, ungrouped);
}

describe('ungrouped list rendering', () => {
	it('has no group header and ignores saved collapse while keeping both location badges', () => {
		const { rendered, props } = setup();
		expect(rendered.some((node) => node.props.class === 'eb-section-header')).toBe(false);
		expect(rendered.find((node) => node.props.class === 'eb-section-body')?.props.hidden).toBe(false);
		const tile = rendered.find((node) => node.type === CardTile)!;
		expect(tile.props.stackLabel).toBe('To do');
		expect(tile.props.sectionLabel).toBe('Work');
		expect(tile.props.onSectionPick).toBe(props.onSectionPick);
		const footerBadges = rendered.filter((node) => node.props.mode === 'move');
		expect(footerBadges.map((node) => node.props.label)).toEqual(['To do', 'Work']);
		expect(rendered.filter((node) => node.props.mode === 'pick')).toHaveLength(2);
	});

	it('keeps both badge move actions usable independently', () => {
		const { rendered, board } = setup();
		const badges = rendered.filter((node) => node.props.mode === 'move');
		const options = badges.map((badge) => (badge.props.options as () => { label: string; onPick(): void }[])());
		options[0]!.find((option) => option.label === 'Done')!.onPick();
		expect(board().stacks[1]!.items.some((item) => item.kind === 'card')).toBe(true);
		// Fresh render after a move uses current positions and section membership.
		const second = setup();
		const sectionBadge = second.rendered.find((node) => node.props.cls === 'eb-list-section' && node.props.mode === 'move')!;
		const sectionOptions = (sectionBadge.props.options as () => { onPick(): void }[])();
		sectionOptions[0]!.onPick();
		expect(second.board().stacks[0]!.items[0]?.kind).toBe('card');
	});

	it('preserves the existing header and collapse behavior for grouped views', () => {
		const { rendered } = setup(false);
		expect(rendered.some((node) => node.props.class === 'eb-section-header')).toBe(true);
		expect(rendered.find((node) => node.props.class === 'eb-section-body')?.props.hidden).toBe(true);
		const tile = rendered.find((node) => node.type === CardTile)!;
		expect(tile.props.sectionLabel).toBeUndefined();
	});

	it('automatically collapses a group with no visible rows and leaves its header available', () => {
		const { props } = setup(false);
		const rendered = nodes(SectionGroup({ ...props, rows: [], state: {} }));
		expect(rendered.some((node) => node.props.class === 'eb-section-header')).toBe(true);
		expect(rendered.find((node) => node.props.class === 'eb-section-body')?.props.hidden).toBe(true);
		expect(rendered.some((node) => node.props.class === 'eb-section-compose')).toBe(false);
		expect(props.onState).not.toHaveBeenCalled();
	});

	it('keeps the composer visible when the flat list is empty', () => {
		const { props } = setup();
		const rendered = nodes(SectionGroup({ ...props, rows: [] }));
		expect(rendered.find((node) => node.props.class === 'eb-section-body')?.props.hidden).toBe(false);
		expect(rendered.some((node) => node.props.class === 'eb-section-compose')).toBe(true);
	});
});

describe('tag group rendering', () => {
	const board = () => parseBoard(
		`${boardHead()}\n## To do\n\n### Work\n\n- Draft #a #b\n- Untagged\n`,
	);
	const tagTiles = (b: Board) => groupsOf(b, 'tag').map((group) => ({
		tag: group.name,
		tiles: renderGroup(b, group).rendered.filter((node) => node.type === CardTile),
	}));

	it('renders one shared card in every tag and keeps both location badges', () => {
		const groups = tagTiles(board());
		expect(groups.map(({ tag }) => tag)).toEqual(['', 'a', 'b']);
		const a = groups[1]!.tiles[0]!.props;
		const b = groups[2]!.tiles[0]!.props;
		expect(a.card).toBe(b.card);
		expect(a).toMatchObject({ stackLabel: 'To do', sectionLabel: 'Work' });
		expect(b).toMatchObject({ stackLabel: 'To do', sectionLabel: 'Work' });
		expect(groups[0]!.tiles[0]!.props.card).toMatchObject({ title: 'Untagged' });
	});

	it('keeps No tags at the top when every card has a tag', () => {
		const tagged = parseBoard(`${boardHead()}\n## To do\n\n- Tagged #a\n`);
		const [first, ...rest] = tagTiles(tagged);
		expect(first).toEqual({ tag: '', tiles: [] });
		expect(rest.map(({ tag }) => tag)).toEqual(['a']);
	});

	it('shows the six-dot handle for tag groups and leaves No tags pinned', () => {
		const b = board();
		const [untagged, tagged] = groupsOf(b, 'tag');
		const handle = renderGroup(b, tagged!).rendered.find((node) => node.props.class === 'eb-section-grip');
		expect(nodes(handle?.props.children).map((node) => node.props.name)).toContain('grip-vertical');
		expect(renderGroup(b, untagged!).rendered.some((node) => node.props.class === 'eb-section-grip')).toBe(false);
	});

	it('removes the drag target and keeps the collapse control for fixed groups', () => {
		const b = board();
		const tagged = groupsOf(b, 'tag')[1]!;
		const { rendered } = renderGroup(b, tagged, false, true);
		expect(rendered.some((node) => node.props.class === 'eb-section-grip')).toBe(false);
		const groupClass = rendered.find((node) => node.props['data-index'] === 0)?.props.class;
		expect(groupClass).not.toContain('is-movable');
		expect(rendered.some((node) => node.type === 'button' && node.props['aria-label'] === t('divider.expand'))).toBe(true);
	});

	it('refreshes repeated rows and changes group membership after saving a card', () => {
		const before = board();
		const ref = groupsOf(before, 'tag')[1]!.cards[0]!;
		const revised = setCardText(before, ref, 'Revised #a #b');
		expect(tagTiles(revised).slice(1).map(({ tiles }) => (tiles[0]!.props.card as Card).title))
			.toEqual(['Revised', 'Revised']);

		const retagged = setCardText(revised, ref, 'Retagged #a #c');
		expect(tagTiles(retagged).map(({ tag, tiles }) => [tag, (tiles[0]!.props.card as Card).title]))
			.toEqual([['', 'Untagged'], ['a', 'Retagged'], ['c', 'Retagged']]);

		const untagged = setCardText(retagged, ref, 'No longer tagged');
		expect(tagTiles(untagged).map(({ tag, tiles }) => [
			tag, tiles.map((tile) => (tile.props.card as Card).title),
		])).toEqual([['', ['No longer tagged', 'Untagged']]]);
	});
});
