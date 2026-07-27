// The inline card editor: a real Markdown field (so `[[` and `#` complete)
// with the card's property values as editable badges beneath it.
// Spec: docs/specs/card-content-and-checklists.md §3, kanban-view.md §6.6.

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Notice, type App } from 'obsidian';
import { processCardText, type DroppedKind } from '../model/cardText';
import * as ops from '../model/ops';
import { cardLineContent } from '../model/serialize';
import type { Board, Card } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from './api';
import { InlineEditor } from './components/InlineEditor';
import { PropertyBadges } from './components/PropertyBadges';
import { createEmbeddedEditor } from './embeddedEditor';
import { t } from '../i18n';

function droppedLabel(kind: DroppedKind): string {
	switch (kind) {
		case 'list':
			return t('cardText.dropped.list');
		case 'quote':
			return t('cardText.dropped.quote');
		case 'heading':
			return t('cardText.dropped.heading');
		case 'rule':
			return t('cardText.dropped.rule');
		case 'code':
			return t('cardText.dropped.code');
		case 'math':
			return t('cardText.dropped.math');
		case 'table':
			return t('cardText.dropped.table');
		case 'html':
			return t('cardText.dropped.html');
		case 'image':
			return t('cardText.dropped.image');
	}
}

/** Human-readable summary of what a card could not keep, or `''`. */
function describeDropped(dropped: DroppedKind[]): string {
	if (!dropped.length) return '';
	const names = dropped.map(droppedLabel);
	const list =
		names.length === 1
			? names[0]!
			: `${names.slice(0, -1).join(', ')} ${t('cardText.and')} ${names[names.length - 1]!}`;
	return t('cardText.summary', { list });
}

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
	/**
	 * Reports a way to read the field's current text synchronously, or `null`
	 * while no such reader is mounted. Lets a caller flush the live text on its
	 * own schedule instead of waiting on the field's internal blur handling.
	 */
	onReady: (getValue: (() => string) | null) => void;
	onSubmit: (text: string) => void;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/**
 * Obsidian's embedded Markdown editor, or the plain textarea when this version
 * does not expose it (docs/NOTICES.md). A card must always be editable, so the
 * fallback is a normal render path, not an error case.
 */
function RichField({ app, value, placeholder, scope, onReady, onSubmit, onCommit, onCancel }: FieldProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [fallback, setFallback] = useState(false);
	// The callbacks change identity on every render; the editor is mounted once
	// and owns its text until it closes, so it reads them through a ref rather
	// than being torn down and rebuilt under the user's cursor.
	const handlers = useRef({ onReady, onSubmit, onCommit, onCancel });
	handlers.current = { onReady, onSubmit, onCommit, onCancel };
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
		handlers.current.onReady(() => handle.getValue());
		return () => {
			handlers.current.onReady(null);
			handle.destroy();
		};
	}, [app, fallback, scope]);

	if (fallback) {
		return (
			<InlineEditor
				value={value}
				placeholder={placeholder}
				allowEmpty
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
		// The op processes the raw text itself; this only reports what a card
		// could not keep, so a silent removal never surprises the user (§3.2).
		const notice = describeDropped(processCardText(text).dropped);
		if (notice) new Notice(notice);
		api.update((b) => ops.setCardText(b, target, text, { keepProperties: !showRaw }));
	};
	// `save` closes over `card`/`target`, both of which are stable for the life
	// of one editor instance, but read through a ref anyway so the pointerdown
	// handler below never needs to re-bind.
	const saveRef = useRef(save);
	saveRef.current = save;
	// Set while the field is mounted, so its current text can be read
	// synchronously — see the pointerdown handler below.
	const fieldValue = useRef<(() => string) | null>(null);

	// Pointing anywhere outside the editor closes it. The field's own blur
	// commits asynchronously (it defers to let a completion click land first),
	// which races the unmount this triggers: closing first can tear the field
	// down before its deferred commit runs, silently dropping the last edit.
	// Reading the live text here and saving it before closing removes the race.
	useEffect(() => {
		const onPointerDown = (evt: Event): void => {
			const target = evt.target;
			if (!(target instanceof Node)) return;
			if (rootRef.current?.contains(target)) return;
			if (target.instanceOf(Element) && target.closest(FLOATING)) return;
			const getValue = fieldValue.current;
			if (getValue) saveRef.current(getValue());
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
				placeholder={showRaw ? t('cardEditor.placeholderRaw') : t('cardEditor.placeholder')}
				scope={rootRef}
				onReady={(getValue) => {
					fieldValue.current = getValue;
				}}
				onSubmit={(text) => {
					onClose();
					save(text);
				}}
				onCommit={save}
				onCancel={onClose}
			/>
			<PropertyBadges board={board} card={card} target={target} api={api} settings={settings} />
		</div>
	);
}
