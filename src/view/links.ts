// Obsidian-side behaviour of the links a card shows: resolving them, opening
// them, and raising the same hover preview any other internal link raises.
// Spec: docs/specs/card-content-and-checklists.md §1.1, kanban-view.md §2.

import { App, HoverParent, Keymap, TFile } from 'obsidian';
import type { CardLink } from '../model/link';

/**
 * The note a link points at, or `null` when it is unresolved. Resolution goes
 * through `getFirstLinkpathDest`, so relative and shortest-path links behave
 * exactly as they do in the editor.
 */
export function resolveCardLink(app: App, link: CardLink, sourcePath: string): TFile | null {
	return app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
}

/** Open a link target; Ctrl/Cmd and middle click open it in a new tab. */
export function openLinkText(
	app: App,
	linktext: string,
	sourcePath: string,
	evt: MouseEvent,
): void {
	const newTab = Keymap.isModEvent(evt) || evt.button === 1;
	void app.workspace.openLinkText(linktext, sourcePath, newTab);
}

/** Ask Obsidian for the page preview it shows on any other internal link. */
export function hoverLinkText(
	app: App,
	linktext: string,
	sourcePath: string,
	evt: MouseEvent,
	hoverParent: HoverParent,
): void {
	app.workspace.trigger('hover-link', {
		event: evt,
		source: 'extraboard',
		hoverParent,
		targetEl: evt.currentTarget,
		linktext,
		sourcePath,
	});
}
