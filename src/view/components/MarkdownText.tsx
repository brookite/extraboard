// Inline Markdown inside a card title. Spec: docs/specs/kanban-view.md §2.
//
// A card title is one line of inline Markdown, so it is rendered with
// Obsidian's own renderer and then **unwrapped** out of the paragraph the
// renderer puts it in — the card supplies the layout, not the Markdown block.

import { Component, MarkdownRenderer } from 'obsidian';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { BoardApi } from '../api';
import { hoverLinkText, openLinkText } from '../links';

/**
 * Characters that could start any inline construct. A title without one of them
 * is plain text, and skipping the renderer for it keeps a large board cheap —
 * most titles are prose.
 */
const MARKDOWN_RE = /[[\]`*_~=$<>&^!\\|]/;

export function hasMarkdown(text: string): boolean {
	return MARKDOWN_RE.test(text);
}

/** Lift a single rendered paragraph's children up into `el`. */
function unwrapParagraph(el: HTMLElement): void {
	const only = el.childElementCount === 1 ? el.firstElementChild : null;
	if (!(only instanceof HTMLParagraphElement)) return;
	el.replaceChildren(...Array.from(only.childNodes));
}

interface Props {
	markdown: string;
	api: BoardApi;
	class?: string;
}

export function MarkdownText({ markdown, api, class: cls }: Props) {
	const ref = useRef<HTMLSpanElement>(null);
	const sourcePath = api.sourcePath();

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		el.empty();
		// Child of the view, so anything the renderer loads (embeds, popovers)
		// unloads with the board rather than leaking.
		const owner = new Component();
		api.component.addChild(owner);
		void MarkdownRenderer.render(api.app, markdown, el, sourcePath, owner)
			.then(() => {
				if (!cancelled) unwrapParagraph(el);
			})
			.catch((err: unknown) => {
				console.error('Extraboard: failed to render card title', err);
				if (!cancelled) el.setText(markdown);
			});
		return () => {
			cancelled = true;
			api.component.removeChild(owner);
		};
	}, [markdown, sourcePath, api]);

	return (
		<span
			class={cls}
			ref={ref}
			// Links inside a title behave like links anywhere else, and the click
			// never reaches the card, so it does not open the inline editor.
			onClick={(evt) => {
				const anchor = evt.target instanceof Element ? evt.target.closest('a') : null;
				if (!anchor) return;
				evt.stopPropagation();
				const href = anchor.getAttribute('data-href');
				if (href === null) return; // external link: let Obsidian open it
				evt.preventDefault();
				openLinkText(api.app, href, sourcePath, evt);
			}}
			onAuxClick={(evt) => {
				if (evt.button !== 1) return;
				const anchor = evt.target instanceof Element ? evt.target.closest('a') : null;
				const href = anchor?.getAttribute('data-href');
				if (href === undefined || href === null) return;
				evt.stopPropagation();
				evt.preventDefault();
				openLinkText(api.app, href, sourcePath, evt);
			}}
			onMouseOver={(evt) => {
				const anchor = evt.target instanceof Element ? evt.target.closest('a') : null;
				const href = anchor?.getAttribute('data-href');
				if (href === undefined || href === null) return;
				hoverLinkText(api.app, href, sourcePath, evt, api.hoverParent);
			}}
		/>
	);
}
