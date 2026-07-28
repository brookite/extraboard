import { parseBoard } from '../model/parse';
import { serializeBoard } from '../model/serialize';
import type { Board } from '../model/types';

/**
 * Whether the in-memory board must be written over the file as it exists now.
 * A failed optimization check must never prevent the ordinary save.
 */
export async function boardSaveNeeded(
	board: Board,
	readFile: () => Promise<string>,
): Promise<boolean> {
	try {
		const persisted = parseBoard(await readFile());
		return serializeBoard(persisted) !== serializeBoard(board);
	} catch {
		return true;
	}
}

/**
 * Tracks only saves requested by board-view edits. A generation captured by an
 * async save can be handled without swallowing a newer request.
 */
export class PluginSaveRequests {
	private requested = 0;
	private handled = 0;

	request(): void {
		this.requested++;
	}

	pending(): number | null {
		return this.requested > this.handled ? this.requested : null;
	}

	markHandled(generation: number): void {
		this.handled = Math.max(this.handled, generation);
	}
}
