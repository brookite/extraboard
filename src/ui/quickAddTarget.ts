// Where the quick-add dialog writes: the board's open view when there is one,
// else the file itself. Spec: docs/specs/quick-add-card.md §2, §5.

import { Notice, type App, type TFile } from 'obsidian';
import { isBoardText } from '../model/frontmatter';
import { parseBoard } from '../model/parse';
import { serializeBoard } from '../model/serialize';
import type { Board } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import { boardFiles } from '../util/boardFiles';
import { VIEW_TYPE_BOARD } from '../util/constants';
import type { BoardApi } from '../view/api';
import { BoardSuggestModal } from './BoardSuggestModal';
import { openQuickAddModal } from './QuickAddModal';
import { t } from '../i18n';

/**
 * The slice of `BoardView` this module reads. It is matched by view type
 * rather than imported, since the view itself opens the dialog.
 */
interface OpenBoard {
	file: TFile | null;
	board: Board | null;
	getApi(): BoardApi;
}

/** A loaded board view showing `path`, in any leaf. */
function openBoardFor(app: App, path: string): OpenBoard | null {
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
		const view = leaf.view as Partial<OpenBoard>;
		if (view.file?.path === path && view.board && typeof view.getApi === 'function') {
			return view as OpenBoard;
		}
	}
	return null;
}

/** The board in `file`, from its view when it is open, else from disk. */
async function readBoard(app: App, file: TFile): Promise<Board | null> {
	const open = openBoardFor(app, file.path);
	if (open?.board) return open.board;
	const text = await app.vault.cachedRead(file);
	if (!isBoardText(text)) return null;
	try {
		return parseBoard(text);
	} catch (err) {
		console.error('Extraboard: failed to parse board', err);
		return null;
	}
}

/**
 * Apply `mutate` to the board in `file` as it stands now: through its open
 * view, which renders and saves it, or by rewriting the file (§5).
 */
async function commitTo(app: App, file: TFile, mutate: (board: Board) => Board): Promise<boolean> {
	const open = openBoardFor(app, file.path);
	if (open) {
		open.getApi().update(mutate);
		return true;
	}
	let ok = true;
	await app.vault.process(file, (text) => {
		if (!isBoardText(text)) {
			ok = false;
			return text;
		}
		const board = parseBoard(text);
		const next = mutate(board);
		return next === board ? text : serializeBoard(next);
	});
	if (!ok) new Notice(t('quickAdd.notBoard'));
	return ok;
}

/**
 * Open the dialog for `file`. `fromBoard` is set when the board itself is on
 * screen, where the new card needs no notice to be seen.
 */
export async function openQuickAdd(
	app: App,
	settings: ExtraboardSettings,
	file: TFile,
	fromBoard: boolean,
): Promise<void> {
	const board = await readBoard(app, file);
	if (!board) {
		new Notice(t('quickAdd.notBoard'));
		return;
	}
	if (!board.stacks.length) {
		new Notice(t('quickAdd.noStacks'));
		return;
	}
	openQuickAddModal(app, settings, {
		board,
		name: file.basename,
		path: file.path,
		commit: (mutate) => commitTo(app, file, mutate),
		notify: !fromBoard,
	});
}

/** The command outside a board: pick a board file first (§2). */
export function chooseBoardAndQuickAdd(app: App, settings: ExtraboardSettings): void {
	const boards = boardFiles(app);
	if (!boards.length) {
		new Notice(t('quickAdd.noBoards'));
		return;
	}
	new BoardSuggestModal(app, boards, (file) => {
		void openQuickAdd(app, settings, file, false);
	}).open();
}
