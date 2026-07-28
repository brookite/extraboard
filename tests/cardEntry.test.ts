import { describe, expect, it } from 'vitest';
import * as ops from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import { DEFAULT_SETTINGS, cardEntryPos, type ExtraboardSettings } from '../src/settings';
import type { Board, BoardConfig } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead();

const BOARD = [
	FM,
	'## To do',
	'',
	'- First',
	'- Second',
	'',
	'## Done %%completes%%',
	'',
	'- Already done',
	'',
].join('\n');

const board = (): Board => parseBoard(BOARD);
const titles = (b: Board, stack: number): string[] =>
	b.stacks[stack]!.items.flatMap((i) => (i.kind === 'card' ? [i.card.title] : []));

const settings = (over: Partial<ExtraboardSettings> = {}): ExtraboardSettings => ({
	...DEFAULT_SETTINGS,
	...over,
});
const plain = (over: Partial<BoardConfig> = {}): BoardConfig => ({ ...board().config, ...over });

const todo = { completes: false };
const done = { completes: true };

describe('cardEntryPos', () => {
	it('puts every card at the top by default', () => {
		expect(cardEntryPos(todo, plain(), settings())).toBe(0);
		expect(cardEntryPos(done, plain(), settings())).toBe(0);
	});

	it('configures completing stacks separately from the rest', () => {
		const s = settings({ addToTopCompleting: false });
		expect(cardEntryPos(todo, plain(), s)).toBe(0);
		expect(cardEntryPos(done, plain(), s)).toBeNull();

		const t = settings({ addToTopOther: false });
		expect(cardEntryPos(todo, plain(), t)).toBeNull();
		expect(cardEntryPos(done, plain(), t)).toBe(0);
	});

	it('lets a board override the plugin, per kind', () => {
		const s = settings({ addToTopOther: true, addToTopCompleting: true });
		expect(cardEntryPos(todo, plain({ addToTopOther: false }), s)).toBeNull();
		// The other kind still follows the plugin.
		expect(cardEntryPos(done, plain({ addToTopOther: false }), s)).toBe(0);
	});

	it('treats an explicit board `false` as an override, not as absent', () => {
		const s = settings({ addToTopOther: true });
		expect(cardEntryPos(todo, plain({ addToTopOther: false }), s)).toBeNull();
	});

	it('treats a stack that does not exist yet as an ordinary one', () => {
		// Restoring into a board with no stacks creates one, and a created stack
		// never completes.
		expect(cardEntryPos(undefined, plain(), settings())).toBe(0);
		expect(cardEntryPos(undefined, plain(), settings({ addToTopOther: false }))).toBeNull();
	});
});

describe('card entry, applied', () => {
	it('adds a card to the top of a stack', () => {
		const b = ops.addCard(board(), 0, 'New', cardEntryPos(todo, plain(), settings()));
		expect(titles(b, 0)).toEqual(['New', 'First', 'Second']);
	});

	it('adds a card to the end when configured to', () => {
		const s = settings({ addToTopOther: false });
		const b = ops.addCard(board(), 0, 'New', cardEntryPos(todo, plain(), s));
		expect(titles(b, 0)).toEqual(['First', 'Second', 'New']);
	});

	it('completes a card into the top of the completing stack', () => {
		const b = board();
		const pos = cardEntryPos(b.stacks[1], b.config, settings());
		const next = ops.moveItem(b, { stack: 0, item: 0 }, 1, pos);
		expect(titles(next, 1)).toEqual(['First', 'Already done']);
		// It is still marked done on the way in, wherever in the stack it landed.
		const landed = next.stacks[1]!.items[0]!;
		expect(landed.kind === 'card' && ops.isCardDone(landed.card)).toBe(true);
	});

	it('restores a card to the top of its origin stack', () => {
		const archived = ops.archiveCard(board(), { stack: 0, item: 1 }, {});
		const entry = ops.archivedCards(archived)[0]!;
		const target = ops.restoreTarget(archived, entry);
		expect(target?.name).toBe('To do');
		const back = ops.restoreCard(archived, 0, cardEntryPos(target, archived.config, settings()));
		expect(titles(back, 0)).toEqual(['Second', 'First']);
	});

	it('restores to the end when configured to', () => {
		const archived = ops.archiveCard(board(), { stack: 0, item: 0 }, {});
		const entry = ops.archivedCards(archived)[0]!;
		const s = settings({ addToTopOther: false });
		const back = ops.restoreCard(archived, 0, cardEntryPos(ops.restoreTarget(archived, entry), archived.config, s));
		expect(titles(back, 0)).toEqual(['Second', 'First']);
	});

	it('restoreCard still defaults to the end, so the op alone is unchanged', () => {
		const archived = ops.archiveCard(board(), { stack: 0, item: 0 }, {});
		expect(titles(ops.restoreCard(archived, 0), 0)).toEqual(['Second', 'First']);
	});

	it('names no target when the board has no stacks to restore into', () => {
		const empty = parseBoard([FM, ''].join('\n'));
		expect(ops.restoreTarget(empty, { card: { title: 'x', properties: [], tags: [], checklist: [], trailing: [] } })).toBeUndefined();
	});
});

describe('board config round-trip', () => {
	const withConfig = (over: Partial<BoardConfig>): string => {
		const b = ops.setBoardConfig(board(), { ...board().config, ...over });
		return serializeBoard(b);
	};

	it('writes and reads back an explicit `false`', () => {
		const text = withConfig({ addToTopOther: false });
		expect(text).toContain('"addToTopOther":false');
		expect(parseBoard(text).config.addToTopOther).toBe(false);
	});

	it('writes and reads back an explicit `true`', () => {
		const text = withConfig({ addToTopCompleting: true });
		expect(parseBoard(text).config.addToTopCompleting).toBe(true);
	});

	it('writes nothing when the board follows the plugin', () => {
		const text = withConfig({});
		expect(text).not.toContain('addToTopOther');
		expect(parseBoard(text).config.addToTopOther).toBeUndefined();
	});
});
