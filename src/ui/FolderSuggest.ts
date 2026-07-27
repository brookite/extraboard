// Type-ahead over the vault's folders, for the two places that ask for one:
// the plugin's `cardNoteFolder` and a board's own `cardContentDir`.
// Spec: docs/specs/settings.md.

import { AbstractInputSuggest, App, TFolder, prepareFuzzySearch, renderResults } from 'obsidian';
import type { SearchResult } from 'obsidian';

interface FolderMatch {
	folder: TFolder;
	/** `null` for an empty query, where every folder matches and none is scored. */
	match: SearchResult | null;
}

/**
 * Obsidian's own `AbstractInputSuggest` rather than a hand-rolled dropdown: it
 * already carries the popover, the keyboard navigation and the theming every
 * other suggester in the app has, so the field behaves the way the rest of the
 * settings do.
 *
 * Folders are collected with `getAllLoadedFiles()` rather than the more direct
 * `getAllFolders()`, which is only available from Obsidian 1.6.6 — the class
 * itself already costs us 1.4.10 in `minAppVersion`, and there is no reason to
 * spend two more minor versions for a filter we can write here.
 */
export class FolderSuggest extends AbstractInputSuggest<FolderMatch> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		/** Runs on pick, since `onChange` does not fire for a programmatic set. */
		private readonly onPick: (path: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): FolderMatch[] {
		const folders: TFolder[] = [];
		for (const file of this.app.vault.getAllLoadedFiles()) {
			// The root is a TFolder with an empty path; clearing the field is what
			// selects it, so offering it as a row would be a row that looks blank.
			if (file instanceof TFolder && file.path !== '/' && file.path !== '') folders.push(file);
		}

		const search = query.trim();
		if (!search) {
			folders.sort((a, b) => a.path.localeCompare(b.path));
			return folders.map((folder) => ({ folder, match: null }));
		}

		// Fuzzy rather than substring: folder paths are long and nested, and
		// "Cards/2026" should be reachable by typing "c26" the way the quick
		// switcher allows.
		const matcher = prepareFuzzySearch(search);
		const matches: FolderMatch[] = [];
		for (const folder of folders) {
			const match = matcher(folder.path);
			if (match) matches.push({ folder, match });
		}
		matches.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
		return matches;
	}

	renderSuggestion({ folder, match }: FolderMatch, el: HTMLElement): void {
		if (match) renderResults(el, folder.path, match);
		else el.setText(folder.path);
	}

	selectSuggestion({ folder }: FolderMatch): void {
		this.inputEl.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}
