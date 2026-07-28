import { describe, expect, it } from 'vitest';
import { parseBoard } from '../src/model/parse';
import * as ops from '../src/model/ops';
import { boardSaveNeeded, PluginSaveRequests } from '../src/view/saveGuard';
import { boardHead } from './boardFile';

const ORIGINAL_TEXT =
	`${boardHead({
		properties: [{ name: 'due', type: 'datetime' }],
		views: [
			{ id: 'v1', name: 'Board', type: 'kanban' },
			{ id: 'v2', name: 'Due dates', type: 'calendar', dateProperty: 'due', mode: 'month' },
		],
	})}\n\n## To do\n\n- First card\n`;

describe('boardSaveNeeded', () => {
	it('does not write when normalized file text represents the same complete board', async () => {
		const board = parseBoard(ORIGINAL_TEXT);
		const crlfText = ORIGINAL_TEXT.replace(/\n/g, '\r\n');

		expect(await boardSaveNeeded(board, async () => crlfText)).toBe(false);
	});

	it('writes when card content changed', async () => {
		const board = parseBoard(ORIGINAL_TEXT);
		const changed = ops.setCardTitle(board, { stack: 0, item: 0 }, 'Changed card');

		expect(await boardSaveNeeded(changed, async () => ORIGINAL_TEXT)).toBe(true);
	});

	it('writes when board parameters changed', async () => {
		const board = parseBoard(ORIGINAL_TEXT);
		const changed = ops.setBoardConfig(board, {
			...board.config,
			showCardCheckbox: true,
		});

		expect(await boardSaveNeeded(changed, async () => ORIGINAL_TEXT)).toBe(true);
	});

	it('writes when a view definition or active view changed', async () => {
		const board = parseBoard(ORIGINAL_TEXT);
		const renamed = ops.updateView(board, 'v2', { name: 'Deadlines' });
		const activated = ops.setActiveView(board, 'v2');

		expect(await boardSaveNeeded(renamed, async () => ORIGINAL_TEXT)).toBe(true);
		expect(await boardSaveNeeded(activated, async () => ORIGINAL_TEXT)).toBe(true);
	});

	it('falls back to writing when reading or parsing fails', async () => {
		const board = parseBoard(ORIGINAL_TEXT);

		expect(
			await boardSaveNeeded(board, async () => {
				throw new Error('read failed');
			}),
		).toBe(true);
		expect(
			await boardSaveNeeded(board, async () => undefined as unknown as string),
		).toBe(true);
	});
});

describe('PluginSaveRequests', () => {
	it('leaves a newer request pending when an earlier generation finishes', () => {
		const requests = new PluginSaveRequests();
		expect(requests.pending()).toBeNull();

		requests.request();
		const first = requests.pending();
		expect(first).not.toBeNull();

		requests.request();
		requests.markHandled(first!);
		const second = requests.pending();
		expect(second).not.toBeNull();

		requests.markHandled(second!);
		expect(requests.pending()).toBeNull();
	});
});
