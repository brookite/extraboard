// Creating a card's content note. Spec: docs/specs/card-content-and-checklists.md §2.

import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { noteFileName } from '../model/link';

/**
 * Resolve the folder for a new card note: the board's `cardContentDir`, then
 * the plugin's `cardNoteFolder`, then the vault root (settings.md).
 */
export function resolveNoteFolder(boardDir: string | undefined, settingDir: string): string {
	const dir = (boardDir ?? '').trim() || settingDir.trim();
	return dir ? normalizePath(dir) : '';
}

/** Create `folder` (and its parents) unless it is the vault root or exists. */
async function ensureFolder(app: App, folder: string): Promise<boolean> {
	if (!folder) return true;
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing instanceof TFolder) return true;
	if (existing) return false; // a file sits where the folder should be
	try {
		await app.vault.createFolder(folder);
		return true;
	} catch {
		// A concurrent create is fine; anything else is not a folder we can use.
		return app.vault.getAbstractFileByPath(folder) instanceof TFolder;
	}
}

/** `<folder>/<name>.md`, with ` 2`, ` 3`… appended until the path is free. */
function uniquePath(app: App, folder: string, name: string): string {
	const make = (n: string): string => normalizePath(folder ? `${folder}/${n}.md` : `${n}.md`);
	let path = make(name);
	for (let i = 2; app.vault.getAbstractFileByPath(path); i++) path = make(`${name} ${String(i)}`);
	return path;
}

/**
 * Create the note for a card and return it with the link text that should
 * become the card's title. The file is created **empty** — no frontmatter, no
 * injected heading — and nothing is rewritten unless the file exists.
 */
export async function createCardNote(
	app: App,
	title: string,
	folder: string,
	sourcePath: string,
): Promise<{ file: TFile; link: string } | null> {
	if (!(await ensureFolder(app, folder))) {
		new Notice(`Extraboard: could not use the folder "${folder}".`);
		return null;
	}

	const name = noteFileName(title);
	let file: TFile;
	try {
		file = await app.vault.create(uniquePath(app, folder, name), '');
	} catch (err) {
		console.error('Extraboard: failed to create the card note', err);
		new Notice('Extraboard: could not create the note.');
		return null;
	}

	// The shortest unambiguous link, so the board follows the vault's link
	// format settings. The alias keeps the card reading the way it was written
	// when the sanitized file name differs from the title.
	const clean = title.trim();
	const alias = file.basename === clean ? undefined : clean;
	const link = app.fileManager.generateMarkdownLink(file, sourcePath, '', alias);
	return { file, link };
}
