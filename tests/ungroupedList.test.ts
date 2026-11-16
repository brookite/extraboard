import { describe, expect, it, vi } from 'vitest';
import { SectionGroup, type SectionProps } from '../src/view/components/Section';
import { CardTile } from '../src/view/components/Card';
import { groupsOf } from '../src/model/sections';
import { parseBoard } from '../src/model/parse';
import { DEFAULT_SETTINGS } from '../src/settings';
import { boardHead } from './boardFile';

// Exercise the real group renderer and badge callbacks without Obsidian's DOM.
vi.mock('obsidian', () => ({ Menu: class {}, setIcon: vi.fn(), Platform: { isMobile: false } }));
vi.mock('preact/hooks', () => ({ useRef: () => ({ current: null }), useState: (value: unknown) => [value, vi.fn()] }));
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

function setup(ungrouped = true) {
	let board = parseBoard(`${boardHead()}\n## To do\n\n### Work\n\n- Task\n\n## Done\n`);
	const section = groupsOf(board, ungrouped ? 'none' : 'section')[ungrouped ? 0 : 1]!;
	const onSectionPick = vi.fn();
	const props: SectionProps = {
		board, section, ungrouped, index: 0, config: board.config, rows: section.cards,
		state: { collapsed: true }, ordered: true, settings: DEFAULT_SETTINGS,
		api: { update: (mutate) => { board = mutate(board); } } as SectionProps['api'],
		composerStack: 0, onComposerStack: vi.fn(), composerSection: { kind: 'none' },
		onComposerSection: vi.fn(), onState: vi.fn(), onAddCard: vi.fn(), pending: null,
		onDrop: vi.fn(), menuExtra: vi.fn(), onStackPick: vi.fn(), onSectionPick,
		canMoveUp: false, canMoveDown: false,
	};
	return { rendered: nodes(SectionGroup(props)), board: () => board, props };
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
});
