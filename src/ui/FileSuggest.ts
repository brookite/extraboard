// Type-ahead over the vault's notes, for the operand of a "linked to" filter.
// Spec: docs/specs/filters-and-sorting.md §3.4.
//
// The sibling of `FolderSuggest`, and for the same reason: Obsidian's own
// suggester already carries the popover, the keyboard navigation and the
// theming, so the field behaves like every other one in the app.

import { AbstractInputSuggest, App, TFile, prepareFuzzySearch, renderResults } from 'obsidian';
import type { SearchResult } from 'obsidian';

interface FileMatch {
	file: TFile;
	/** `null` for an empty query, where every note matches and none is scored. */
	match: SearchResult | null;
}

/** How many rows an empty query offers — the whole vault is not a menu. */
const EMPTY_QUERY_LIMIT = 20;

export class FileSuggest extends AbstractInputSuggest<FileMatch> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		/** Runs on pick, since `onChange` does not fire for a programmatic set. */
		private readonly onPick: (path: string) => void,
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): FileMatch[] {
		const files = this.app.vault.getMarkdownFiles();
		const search = query.trim();
		if (!search) {
			const sorted = files.slice().sort((a, b) => a.basename.localeCompare(b.basename));
			return sorted.slice(0, EMPTY_QUERY_LIMIT).map((file) => ({ file, match: null }));
		}

		const matcher = prepareFuzzySearch(search);
		const matches: FileMatch[] = [];
		for (const file of files) {
			const match = matcher(file.path);
			if (match) matches.push({ file, match });
		}
		matches.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
		return matches;
	}

	renderSuggestion({ file, match }: FileMatch, el: HTMLElement): void {
		if (match) renderResults(el, file.path, match);
		else el.setText(file.path);
	}

	selectSuggestion({ file }: FileMatch): void {
		// The basename is what a `[[wikilink]]` usually holds, and the matcher
		// compares by basename anyway (model/link.ts: sameLinkTarget).
		this.inputEl.value = file.basename;
		this.onPick(file.basename);
		this.close();
	}
}
