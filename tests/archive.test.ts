import { describe, it, expect } from 'vitest';
import {
	archiveOrder,
	atMarker,
	countArchivedCards,
	extractFrom,
	fromMarker,
	parseArchive,
	serializeArchive,
	trimArchiveBody,
} from '../src/model/archive';
import * as ops from '../src/model/ops';
import { parseBoard } from '../src/model/parse';
import { serializeBoard } from '../src/model/serialize';
import type { Board } from '../src/model/types';
import { boardHead } from './boardFile';

const FM = boardHead();

const BOARD = [
	FM,
	'## To do',
	'',
	'- [ ] Open card',
	'- [x] Finished card',
	'',
	'## Doing',
	'',
	'- [x] Also finished',
	'\t- [x] Sub item',
	'',
].join('\n');

const WITH_ARCHIVE = [
	FM,
	'## To do',
	'',
	'- Live card',
	'',
	'## Archive %%archive%%',
	'',
	'- [x] Fix login redirect @{priority|1} #bug %%from|Doing%%',
	'\t- [x] Audit current flow',
	'- Old idea nobody picked up %%from|Inbox%%',
	'',
].join('\n');

const board = (text = BOARD): Board => parseBoard(text);
const body = (b: Board): string => serializeBoard(b).slice(FM.length + 1);

describe('archive section: format', () => {
	it('captures the section as raw text without parsing it', () => {
		const b = board(WITH_ARCHIVE);
		expect(b.stacks).toHaveLength(1);
		expect(b.archive?.heading).toBe('Archive');
		expect(b.archive?.body).toContain('%%from|Doing%%');
	});

	it('re-emits an untouched archive byte for byte', () => {
		expect(serializeBoard(parseBoard(WITH_ARCHIVE))).toBe(WITH_ARCHIVE);
	});

	it('never interprets what is inside it', () => {
		const broken = [
			FM,
			'## To do',
			'',
			'- Live card',
			'',
			'## Old stuff %%archive%%',
			'',
			'### Not a divider',
			'- [x] Card @{unclosed',
			'nonsense',
			'',
		].join('\n');
		const b = parseBoard(broken);
		expect(b.stacks).toHaveLength(1);
		expect(b.archive?.heading).toBe('Old stuff');
		expect(serializeBoard(b)).toBe(broken);
	});

	it('is recognized by its marker, whatever the heading says and wherever it sits', () => {
		const first = [FM, '## Архив %%archive%%', '', '- [x] Card %%from|Done%%', ''].join('\n');
		const b = parseBoard(first);
		expect(b.stacks).toHaveLength(0);
		expect(b.archive?.heading).toBe('Архив');
		expect(serializeBoard(b)).toBe(first);
	});

	it('takes everything after its heading, including further H2 lines', () => {
		const b = parseBoard(
			[FM, '## Archive %%archive%%', '', '- [x] One %%from|A%%', '', '## Not a stack', '', '- Two', ''].join('\n'),
		);
		expect(b.stacks).toHaveLength(0);
		// The second H2 is a line inside the archive, not a stack: it stays with
		// the card above it, and the list item under it is an archived card.
		const cards = ops.archivedCards(b);
		expect(cards.map((c) => c.card.title)).toEqual(['One', 'Two']);
		expect(cards[0]!.card.trailing).toContain('## Not a stack');
	});
});

describe('origin marker', () => {
	it('round-trips a name with escapes', () => {
		const name = '50% \\ done';
		const { from, rest } = extractFrom(`Card ${fromMarker(name)}`);
		expect(from).toBe(name);
		expect(rest.trim()).toBe('Card');
	});

	it('treats an empty or absent marker as an unknown origin', () => {
		expect(extractFrom('Card %%from|%%').from).toBeUndefined();
		expect(extractFrom('Card').from).toBeUndefined();
	});
});

describe('parse/serialize archived cards', () => {
	it('reads cards with their checklist, properties and origin', () => {
		const cards = parseArchive(parseBoard(WITH_ARCHIVE).archive!.body, parseBoard(WITH_ARCHIVE).config);
		expect(cards).toHaveLength(2);
		expect(cards[0]!.from).toBe('Doing');
		expect(cards[0]!.card.task).toBe('x');
		expect(cards[0]!.card.title).toBe('Fix login redirect');
		expect(cards[0]!.card.tags).toEqual(['bug']);
		expect(cards[0]!.card.checklist).toHaveLength(1);
		expect(cards[1]!.from).toBe('Inbox');
	});

	it('is a fixed point for a canonical body', () => {
		const b = parseBoard(WITH_ARCHIVE);
		const cards = parseArchive(b.archive!.body, b.config);
		expect(serializeArchive(cards, b.config)).toBe(b.archive!.body);
	});

	it('serializes an empty list as an empty body', () => {
		expect(serializeArchive([], parseBoard(BOARD).config)).toBe('');
	});
});

describe('ops: archiving', () => {
	it('archives one card with its origin stack', () => {
		const b = ops.archiveCard(board(), { stack: 0, item: 1 }, {});
		expect(body(b)).toBe(
			[
				'## To do',
				'',
				'- [ ] Open card',
				'',
				'## Doing',
				'',
				'- [x] Also finished',
				'\t- [x] Sub item',
				'',
				'## Archive %%archive%%',
				'',
				'- [x] Finished card %%from|To do%%',
				'',
			].join('\n'),
		);
	});

	it('prepends, so the newest card is first', () => {
		let b = ops.archiveCard(board(), { stack: 0, item: 1 }, {});
		b = ops.archiveCard(b, { stack: 1, item: 0 }, {});
		const cards = ops.archivedCards(b);
		expect(cards.map((c) => c.card.title)).toEqual(['Also finished', 'Finished card']);
		expect(cards[0]!.card.checklist).toHaveLength(1);
	});

	it('archives every completed card in one edit, in document order', () => {
		const b = ops.archiveCompletedCards(board(), {});
		expect(ops.countCompletedCards(board())).toBe(2);
		expect(ops.countCompletedCards(b)).toBe(0);
		expect(ops.archivedCards(b).map((c) => c.card.title)).toEqual(['Finished card', 'Also finished']);
		expect(body(b)).toBe(
			[
				'## To do',
				'',
				'- [ ] Open card',
				'',
				'## Doing',
				'',
				'## Archive %%archive%%',
				'',
				'- [x] Finished card %%from|To do%%',
				'- [x] Also finished %%from|Doing%%',
				'\t- [x] Sub item',
				'',
			].join('\n'),
		);
	});

	it('changes nothing when there is nothing to archive', () => {
		const b = board([FM, '## To do', '', '- [ ] Open card', ''].join('\n'));
		expect(ops.archiveCompletedCards(b, {})).toBe(b);
	});

	it('deletes an untitled card instead of archiving it', () => {
		const b = board([FM, '## To do', '', '- First', '- ', '- [x] ', ''].join('\n'));
		const one = ops.archiveCard(b, { stack: 0, item: 1 }, {});
		expect(one.archive).toBeUndefined();
		expect(one.stacks[0]!.items).toHaveLength(2);

		// The same rule on the bulk path: the completed untitled card leaves the
		// board, but writes nothing into the archive.
		const all = ops.archiveCompletedCards(b, {});
		expect(all.stacks[0]!.items).toHaveLength(2);
		expect(ops.archivedCards(all)).toHaveLength(0);
		expect(all.archive).toBeUndefined();

		// And when a stack is deleted.
		const gone = ops.deleteStack(board([FM, '## To do', '', '- ', ''].join('\n')), 0, {});
		expect(gone.archive).toBeUndefined();
	});

	it('archives the cards of a deleted stack', () => {
		const b = ops.deleteStack(board(), 1, {});
		expect(b.stacks).toHaveLength(1);
		expect(ops.archivedCards(b).map((c) => c.from)).toEqual(['Doing']);
	});

	it('leaves an empty stack no archive to write', () => {
		const b = board([FM, '## To do', '', '## Doing', '', '- Card', ''].join('\n'));
		expect(ops.deleteStack(b, 0, {}).archive).toBeUndefined();
	});
});

describe('ops: restoring and destroying', () => {
	const archived = (): Board => ops.archiveCompletedCards(board(), {});

	it('restores into the stack named by the origin, at its end', () => {
		const b = ops.restoreCard(archived(), 1);
		expect(b.stacks[1]!.items.map((i) => (i.kind === 'card' ? i.card.title : '—'))).toEqual([
			'Also finished',
		]);
		expect(ops.archivedCards(b)).toHaveLength(1);
	});

	it('falls back to the first stack when the origin is gone', () => {
		let b = archived();
		b = ops.deleteStack(b, 1, {}); // "Doing" disappears (and archives nothing)
		b = ops.restoreCard(b, 1);
		expect(b.stacks[0]!.name).toBe('To do');
		expect(b.stacks[0]!.items.map((i) => (i.kind === 'card' ? i.card.title : '—'))).toEqual([
			'Open card',
			'Also finished',
		]);
	});

	it('creates a stack named after the origin when the board has none', () => {
		let b = archived();
		b = ops.deleteStack(b, 0, {});
		b = ops.deleteStack(b, 0, {});
		expect(b.stacks).toHaveLength(0);
		b = ops.restoreCard(b, 0);
		expect(b.stacks).toHaveLength(1);
		expect(b.stacks[0]!.name).toBe('To do');
	});

	it('names that stack "Restored" when the origin is unknown', () => {
		const b = ops.restoreCard(
			board([FM, '## Archive %%archive%%', '', '- Orphan', ''].join('\n')),
			0,
		);
		expect(b.stacks[0]!.name).toBe('Restored');
	});

	it('deletes one entry and clears the rest, keeping the section', () => {
		let b = ops.deleteArchived(archived(), 0);
		expect(ops.archivedCards(b).map((c) => c.card.title)).toEqual(['Also finished']);
		b = ops.clearArchive(b);
		expect(ops.archivedCards(b)).toHaveLength(0);
		expect(b.archive).toBeDefined();
		expect(body(b).endsWith('## Archive %%archive%%\n')).toBe(true);
	});

	it('is a no-op on an index nobody has and on an empty archive', () => {
		const b = archived();
		expect(ops.restoreCard(b, 9)).toBe(b);
		expect(ops.deleteArchived(b, 9)).toBe(b);
		const cleared = ops.clearArchive(b);
		expect(ops.clearArchive(cleared)).toBe(cleared);
		const plain = board();
		expect(ops.clearArchive(plain)).toBe(plain);
		expect(ops.restoreCard(plain, 0)).toBe(plain);
	});

	it('round-trips a board whose archive was edited', () => {
		const b = ops.restoreCard(archived(), 0);
		expect(serializeBoard(parseBoard(serializeBoard(b)))).toBe(serializeBoard(b));
	});
});

describe('archive: the archived-at marker', () => {
	it('writes `%%at|…%%` after the origin marker', () => {
		const b = ops.archiveCard(board(), { stack: 0, item: 1 }, { at: '2026-07-28 14:30' });
		expect(body(b)).toContain('- [x] Finished card %%from|To do%% %%at|2026-07-28 14:30%%');
	});

	it('reads both markers back off a card line', () => {
		const b = ops.archiveCard(board(), { stack: 0, item: 1 }, { at: '2026-07-28 14:30' });
		const [entry] = ops.archivedCards(b);
		expect(entry!.from).toBe('To do');
		expect(entry!.at).toBe('2026-07-28 14:30');
		// The markers are stripped from the title exactly as tokens and tags are.
		expect(entry!.card.title).toBe('Finished card');
	});

	it('stamps every card of a batch with the one time it was archived', () => {
		const b = ops.archiveCompletedCards(board(), { at: '2026-07-28 14:30' });
		expect(ops.archivedCards(b).map((c) => c.at)).toEqual(['2026-07-28 14:30', '2026-07-28 14:30']);
	});

	it('stamps the cards of a deleted stack too', () => {
		const b = ops.deleteStack(board(), 1, { at: '2026-07-28 14:30' });
		expect(ops.archivedCards(b).map((c) => c.at)).toEqual(['2026-07-28 14:30']);
	});

	it('writes no marker when the caller supplies no time', () => {
		const b = ops.archiveCard(board(), { stack: 0, item: 1 }, {});
		expect(body(b)).toContain('- [x] Finished card %%from|To do%%\n');
		expect(ops.archivedCards(b)[0]!.at).toBeUndefined();
	});

	it('treats a card archived before the marker existed as undated', () => {
		expect(ops.archivedCards(board(WITH_ARCHIVE)).map((c) => c.at)).toEqual([undefined, undefined]);
	});

	it('drops the stamp on restore — it lives only in the archive', () => {
		const b = ops.archiveCard(board(), { stack: 0, item: 1 }, { at: '2026-07-28 14:30' });
		const back = ops.restoreCard(b, 0);
		expect(body(back)).not.toContain('%%at|');
		expect(body(back)).not.toContain('%%from|');
	});

	it('escapes a `%` in the value, like every other marker', () => {
		const entries = parseArchive('\n- Card %%at|50\\% done%%\n', board().config);
		expect(entries[0]!.at).toBe('50% done');
		expect(atMarker('50% done')).toBe('%%at|50\\% done%%');
	});

	it('round-trips an archive holding both markers', () => {
		const text = ['', '- [x] A %%from|Doing%% %%at|2026-07-28 14:30%%', ''].join('\n');
		const config = board().config;
		expect(serializeArchive(parseArchive(text, config), config)).toBe(text);
	});
});

describe('archive: display order', () => {
	const at = (...stamps: (string | undefined)[]) =>
		stamps.map((s) => ({ card: { title: '', properties: [], tags: [], checklist: [], trailing: [] }, ...(s !== undefined && { at: s }) }));

	it('orders newest first by default', () => {
		const cards = at('2026-01-01 10:00', '2026-03-01 10:00', '2026-02-01 10:00');
		expect(archiveOrder(cards, true)).toEqual([1, 2, 0]);
	});

	it('inverts to oldest first', () => {
		const cards = at('2026-01-01 10:00', '2026-03-01 10:00', '2026-02-01 10:00');
		expect(archiveOrder(cards, false)).toEqual([0, 2, 1]);
	});

	it('sorts undated cards as older than any dated one', () => {
		const cards = at(undefined, '2026-01-01 10:00');
		expect(archiveOrder(cards, true)).toEqual([1, 0]);
		expect(archiveOrder(cards, false)).toEqual([0, 1]);
	});

	it('reverses an archive with no stamps at all, since document order is recency', () => {
		const cards = at(undefined, undefined, undefined);
		expect(archiveOrder(cards, true)).toEqual([0, 1, 2]);
		expect(archiveOrder(cards, false)).toEqual([2, 1, 0]);
	});

	it('breaks ties on document order, and inverts those too', () => {
		const cards = at('2026-01-01 10:00', '2026-01-01 10:00');
		expect(archiveOrder(cards, true)).toEqual([0, 1]);
		expect(archiveOrder(cards, false)).toEqual([1, 0]);
	});
});

describe('archive: the card limit', () => {
	const withCards = (n: number): string =>
		'\n' + Array.from({ length: n }, (_, i) => `- Card ${i}`).join('\n') + '\n';

	it('counts cards without parsing them', () => {
		expect(countArchivedCards(withCards(5))).toBe(5);
		expect(countArchivedCards('')).toBe(0);
	});

	it('does not count a card\'s continuation lines', () => {
		expect(countArchivedCards('\n- Card\n\t- [ ] Sub item\n\tnote\n- Other\n')).toBe(2);
	});

	it('leaves an archive within its limit byte-identical', () => {
		const body = withCards(5);
		expect(trimArchiveBody(body, 10)).toBe(body);
		expect(trimArchiveBody(body, 5)).toBe(body);
	});

	it('drops the oldest cards — the ones at the end', () => {
		expect(trimArchiveBody(withCards(5), 3)).toBe('\n- Card 0\n- Card 1\n- Card 2\n');
	});

	it('takes a card\'s continuation lines with it', () => {
		const body = '\n- Keep\n\t- [ ] Sub\n- Drop\n\t- [ ] Sub\n';
		expect(trimArchiveBody(body, 1)).toBe('\n- Keep\n\t- [ ] Sub\n');
	});

	it('never empties the archive, whatever the limit says', () => {
		expect(trimArchiveBody(withCards(5), 0)).toBe('\n- Card 0\n');
		expect(trimArchiveBody(withCards(5), -3)).toBe('\n- Card 0\n');
	});

	it('enforces the limit as cards are archived', () => {
		let b = board();
		b = ops.archiveCard(b, { stack: 0, item: 1 }, { limit: 2 });
		b = ops.archiveCard(b, { stack: 1, item: 0 }, { limit: 2 });
		expect(ops.archivedCards(b).map((c) => c.card.title)).toEqual(['Also finished', 'Finished card']);

		// A third card pushes the oldest off the end.
		b = ops.addCard(b, 0, 'Third', 0);
		b = ops.archiveCard(b, { stack: 0, item: 0 }, { limit: 2 });
		expect(ops.archivedCards(b).map((c) => c.card.title)).toEqual(['Third', 'Also finished']);
	});

	it('bounds a whole batch, not just one card', () => {
		const b = ops.archiveCompletedCards(board(), { limit: 1 });
		expect(ops.archivedCards(b).map((c) => c.card.title)).toEqual(['Finished card']);
	});

	it('enforces nothing when the caller names no limit', () => {
		const b = ops.archiveCompletedCards(board(), {});
		expect(ops.archivedCards(b)).toHaveLength(2);
	});
});
