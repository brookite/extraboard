// One line of inline Markdown, rendered with Obsidian's own renderer and then
// **unwrapped** out of the paragraph the renderer puts it in — the caller
// supplies the layout, not the Markdown block. Shared by a card title
// (kanban-view.md §2) and a checklist row (card-content-and-checklists.md §4.3).

import { App, Component, MarkdownRenderer } from 'obsidian';

/**
 * Characters that could start any inline construct. Text without one of them
 * is plain, and skipping the renderer for it keeps a large board cheap — most
 * titles are prose.
 */
const MARKDOWN_RE = /[[\]`*_~=$<>&^!\\|]/;

export function hasMarkdown(text: string): boolean {
	return MARKDOWN_RE.test(text);
}

/**
 * A card title's tags are its own tokens, cut out before it renders; a
 * checklist row keeps them in its text, so `#` is worth a render there.
 */
function needsRenderer(text: string): boolean {
	return hasMarkdown(text) || text.includes('#');
}

/** Children of `el`, lifted out of the single paragraph the renderer wraps them in. */
function unwrapped(el: HTMLElement): Node[] {
	const only = el.childElementCount === 1 ? el.firstElementChild : null;
	const from = only instanceof HTMLParagraphElement ? only : el;
	return Array.from(from.childNodes);
}

/**
 * Render `markdown` into `el`. `owner` scopes whatever the renderer loads.
 * The result is built off-document and moved in only while `isCurrent()` —
 * a caller that re-rendered, or turned `el` into an editor, meanwhile keeps
 * what it has. A failure falls back to the raw text.
 */
export async function renderInlineMarkdown(
	app: App,
	markdown: string,
	el: HTMLElement,
	sourcePath: string,
	owner: Component,
	isCurrent: () => boolean = () => true,
): Promise<void> {
	if (!needsRenderer(markdown)) {
		el.setText(markdown);
		return;
	}
	const scratch = createDiv();
	try {
		await MarkdownRenderer.render(app, markdown, scratch, sourcePath, owner);
		if (isCurrent()) el.replaceChildren(...unwrapped(scratch));
	} catch (err: unknown) {
		console.error('Extraboard: failed to render inline Markdown', err);
		if (isCurrent()) el.setText(markdown);
	}
}
