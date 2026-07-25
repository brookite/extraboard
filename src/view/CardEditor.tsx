// The inline card editor: a real Markdown field (so `[[` and `#` complete)
// with the card's property values as editable badges beneath it.
// Spec: docs/specs/card-content-and-checklists.md §3, kanban-view.md §6.6.

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { App } from 'obsidian';
import * as ops from '../model/ops';
import { cardLineContent } from '../model/serialize';
import type { Board, Card } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from './api';
import { InlineEditor } from './components/InlineEditor';
import { PropertyBadges } from './components/PropertyBadges';
import { createEmbeddedEditor } from './embeddedEditor';

const PLACEHOLDER = 'Card text, #tag';
const PLACEHOLDER_RAW = 'Card text, @{property|value}, #tag';

/**
 * What the field shows. With the tokens hidden it holds the title and tags
 * only, and the property values are carried over by the op; with them shown it
 * holds the card's whole line and is parsed exactly like the file is.
 */
export function cardEditText(card: Card, board: Board, showRaw: boolean): string {
	if (showRaw) return cardLineContent(card, board.config);
	return [card.title, ...card.tags.map((t) => `#${t}`)].filter(Boolean).join(' ');
}

interface FieldProps {
	app: App;
	value: string;
	placeholder: string;
	/** The whole editor: focus may move to the badges without closing the field. */
	scope: RefObject<HTMLElement>;
	onSubmit: (text: string) => void;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/**
 * Obsidian's embedded Markdown editor, or the plain textarea when this version
 * does not expose it (docs/NOTICES.md). A card must always be editable, so the
 * fallback is a normal render path, not an error case.
 */
function RichField({ app, value, placeholder, scope, onSubmit, onCommit, onCancel }: FieldProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [fallback, setFallback] = useState(false);
	// The callbacks change identity on every render; the editor is mounted once
	// and owns its text until it closes, so it reads them through a ref rather
	// than being torn down and rebuilt under the user's cursor.
	const handlers = useRef({ onSubmit, onCommit, onCancel });
	handlers.current = { onSubmit, onCommit, onCancel };
	const initial = useRef(value);

	useLayoutEffect(() => {
		const host = hostRef.current;
		if (fallback || !host) return;
		const handle = createEmbeddedEditor(app, host, {
			value: initial.current,
			...(scope.current && { scope: scope.current }),
			onSubmit: (text) => handlers.current.onSubmit(text),
			onCommit: (text) => handlers.current.onCommit(text),
			onCancel: () => handlers.current.onCancel(),
		});
		if (!handle) {
			setFallback(true);
			return;
		}
		handle.focus();
		return () => handle.destroy();
	}, [app, fallback, scope]);

	if (fallback) {
		return (
			<InlineEditor
				value={value}
				placeholder={placeholder}
				onSubmit={(text) => onSubmit(text)}
				onCancel={onCancel}
			/>
		);
	}
	return <div class="eb-card-field" ref={hostRef} />;
}

interface Props {
	board: Board;
	card: Card;
	target: ops.ItemRef;
	api: BoardApi;
	settings: ExtraboardSettings;
	onClose: () => void;
}

/** Obsidian surfaces that float above the board and must not close the editor. */
const FLOATING = '.modal-container, .menu, .suggestion-container, .notice-container';

export function CardEditor({ board, card, target, api, settings, onClose }: Props) {
	const showRaw = settings.showRawPropertyTokens;
	const rootRef = useRef<HTMLDivElement>(null);
	const save = (text: string): void => {
		api.update((b) => ops.setCardText(b, target, text, { keepProperties: !showRaw }));
	};

	// Pointing anywhere outside the editor closes it. The field's own blur has
	// already saved the text by then; this is what closes the editor when focus
	// sits on a property badge instead.
	useEffect(() => {
		const onPointerDown = (evt: Event): void => {
			const target = evt.target;
			if (!(target instanceof Node)) return;
			if (rootRef.current?.contains(target)) return;
			if (target.instanceOf(Element) && target.closest(FLOATING)) return;
			onClose();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, [onClose]);

	return (
		<div class="eb-card-editor" ref={rootRef} onClick={(e) => e.stopPropagation()}>
			<RichField
				app={api.app}
				value={cardEditText(card, board, showRaw)}
				placeholder={showRaw ? PLACEHOLDER_RAW : PLACEHOLDER}
				scope={rootRef}
				onSubmit={(text) => {
					onClose();
					save(text);
				}}
				onCommit={save}
				onCancel={onClose}
			/>
			<PropertyBadges board={board} card={card} target={target} api={api} />
		</div>
	);
}
