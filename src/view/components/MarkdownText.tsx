// Inline Markdown inside a card title. Spec: docs/specs/kanban-view.md §2.
//
// A card title is one line of inline Markdown, so it is rendered with
// Obsidian's own renderer and then **unwrapped** out of the paragraph the
// renderer puts it in — the card supplies the layout, not the Markdown block.

import { Component } from 'obsidian';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { BoardApi } from '../api';
import { hoverLinkText, openLinkText } from '../links';
import { renderInlineMarkdown } from '../inlineMarkdown';

export { hasMarkdown } from '../inlineMarkdown';

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
		// Child of the view, so anything the renderer loads (embeds, popovers)
		// unloads with the board rather than leaking.
		const owner = new Component();
		api.component.addChild(owner);
		void renderInlineMarkdown(api.app, markdown, el, sourcePath, owner, () => !cancelled);
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
