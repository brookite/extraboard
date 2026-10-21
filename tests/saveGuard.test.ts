import { describe, expect, it } from 'vitest';
import { parseBoard } from '../src/model/parse';
import * as ops from '../src/model/ops';
import { boardSaveNeeded, PluginSaveRequests, SaveQueue } from '../src/view/saveGuard';
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

describe('SaveQueue', () => {
	it('settles a later save only after an earlier one has finished writing', async () => {
		const queue = new SaveQueue();
		const events: string[] = [];
		let finishWrite!: () => void;

		const first = queue.run(async () => {
			events.push('first: check');
			await new Promise<void>((resolve) => (finishWrite = resolve));
			events.push('first: written');
		});
		const second = queue.run(async () => {
			events.push('second');
		});

		await Promise.resolve();
		finishWrite();
		await second;
		expect(events).toEqual(['first: check', 'first: written', 'second']);
		await first;
	});

	it('keeps running after a failed save', async () => {
		const queue = new SaveQueue();
		const failed = queue.run(async () => {
			throw new Error('write failed');
		});
		await expect(failed).rejects.toThrow('write failed');

		let ran = false;
		await queue.run(async () => {
			ran = true;
		});
		expect(ran).toBe(true);
	});
});
