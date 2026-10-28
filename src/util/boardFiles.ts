// The vault's board files, as the metadata cache knows them.
// Spec: docs/specs/quick-add-card.md §2, markdown-format.md (board detection).

import type { App, TFile } from 'obsidian';

/** True iff cached frontmatter carries the top-level `extraboard` marker. */
export function hasBoardKey(fm: unknown): boolean {
	return typeof fm === 'object' && fm !== null && Object.prototype.hasOwnProperty.call(fm, 'extraboard');
}

/**
 * Every Markdown file the cache marks as a board, the recently opened ones
 * first (in that order), then the rest by most recent change.
 */
export function boardFiles(app: App): TFile[] {
	const boards = app.vault
		.getMarkdownFiles()
		.filter((file) => hasBoardKey(app.metadataCache.getFileCache(file)?.frontmatter));
	const recent = app.workspace.getLastOpenFiles();
	const rank = (file: TFile): number => {
		const at = recent.indexOf(file.path);
		return at === -1 ? recent.length : at;
	};
	return boards.sort((a, b) => rank(a) - rank(b) || b.stat.mtime - a.stat.mtime);
}

