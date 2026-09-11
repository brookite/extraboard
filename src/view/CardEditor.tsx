// The inline card editor: a real Markdown field (so `[[` and `#` complete)
// with the card's property values as editable badges beneath it.
// Spec: docs/specs/card-content-and-checklists.md §3, kanban-view.md §6.6.

import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Notice, type App } from 'obsidian';
import { processCardText, type DroppedKind } from '../model/cardText';
import * as ops from '../model/ops';
import { cardLineContent } from '../model/serialize';
import type { BoardConfig, Card } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from './api';
import { InlineEditor } from './components/InlineEditor';
import { PropertyBadges } from './components/PropertyBadges';
import { createEmbeddedEditor } from './embeddedEditor';
import { useCloseOnReload } from './reload';
import { isTap } from '../util/gesture';
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
export function cardEditText(card: Card, config: BoardConfig, showRaw: boolean): string {
	if (showRaw) return cardLineContent(card, config);
	return [card.title, ...card.tags.map((t) => `#${t}`)].filter(Boolean).join(' ');
}

/**
 * The mounted field's live text, whichever field that is. Reading it lets a
 * caller flush the text on its own schedule instead of waiting on the field's
 * internal blur handling; writing it is how the tag button adds a `#tag`, which
 * lives in the text and not in the board (model/tags.ts).
 */
export interface CardField {
	getValue(): string;
	/** `focus: false` leaves focus where it is — see the picker in §3.1.1. */
	setValue(text: string, options?: { focus?: boolean }): void;
}

interface FieldProps {
	app: App;
	value: string;
	placeholder: string;
	/** The whole editor: focus may move to the badges without closing the field. */
	scope: RefObject<HTMLElement>;
	/** A field was mounted. */
	onReady: (field: CardField) => void;
	/**
	 * That same field is going away. It is handed back rather than simply
	 * cleared, because the fallback field mounts before the embedded one has
	 * finished tearing down — the release must not drop its successor.
	 */
	onRelease: (field: CardField) => void;
	onSubmit: (text: string) => void;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/**
 * Obsidian's embedded Markdown editor, or the plain textarea when this version
 * does not expose it (docs/NOTICES.md). A card must always be editable, so the
 * fallback is a normal render path, not an error case.
 */
function RichField({
	app,
	value,
	placeholder,
	scope,
	onReady,
	onRelease,
	onSubmit,
	onCommit,
	onCancel,
}: FieldProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [fallback, setFallback] = useState(false);
	// The callbacks change identity on every render; the editor is mounted once
	// and owns its text until it closes, so it reads them through a ref rather
	// than being torn down and rebuilt under the user's cursor.
	const handlers = useRef({ onReady, onRelease, onSubmit, onCommit, onCancel });
	handlers.current = { onReady, onRelease, onSubmit, onCommit, onCancel };
	const initial = useRef(value);
	// The fallback field's handle, kept so it can be handed back on release.
	const inlineField = useRef<CardField | null>(null);

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
		const field: CardField = {
			getValue: () => handle.getValue(),
			setValue: (text, options) => handle.setValue(text, options),
		};
		handlers.current.onReady(field);
		return () => {
			handlers.current.onRelease(field);
			handle.destroy();
		};
	}, [app, fallback, scope]);

	if (fallback) {
		return (
			<InlineEditor
				value={value}
				placeholder={placeholder}
				allowEmpty
				onReady={(handle) => {
					if (handle) {
						inlineField.current = handle;
						onReady(handle);
					} else if (inlineField.current) {
						onRelease(inlineField.current);
						inlineField.current = null;
					}
				}}
				onSubmit={(text) => onSubmit(text)}
				onCancel={onCancel}
			/>
		);
	}
	return <div class="eb-card-field" ref={hostRef} />;
}

interface Props {
	/** The board's configuration, not the board: an editor is mounted inside a
	 * memoized card, which is never handed the board object (m10-perf.md §2). */
	config: BoardConfig;
	card: Card;
	target: ops.ItemRef;
	api: BoardApi;
	settings: ExtraboardSettings;
	onClose: () => void;
}

/**
 * Obsidian surfaces that float above the board and must not close the editor.
 * The phone's **editing toolbar** is one of them (mobile.md §7.3): it is the
 * card field's own chrome while it is being typed into, and its commands run
 * against that very field.
 */
const FLOATING =
	'.modal-container, .menu, .suggestion-container, .notice-container, .mobile-toolbar, .mobile-toolbar-options-container';

export function CardEditor({ config, card, target, api, settings, onClose }: Props) {
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
	// Set while a field is mounted, so its current text can be read synchronously
	// — see the pointerdown handler below — and rewritten by the tag button.
	const field = useRef<CardField | null>(null);
	// What the field was seeded with, so an interrupted edit can tell whether
	// anything was actually typed.
	const openedWith = useRef(cardEditText(card, config, showRaw));

	// The board was re-parsed from the file underneath this editor (view/reload.ts).
	// The field still holds the *old* card's text while `target` is an index that
	// may now hold a different card, so committing is the one thing that must not
	// happen: close, discarding the text, and say so when there was any.
	useCloseOnReload(() => {
		const current = field.current?.getValue();
		if (current !== undefined && current !== openedWith.current) {
			new Notice(t('notice.editDiscarded'));
		}
		onClose();
	});

	// **Tapping** outside the editor closes it — not merely pressing outside it.
	// A finger that presses a card and moves is scrolling the stack, and closing
	// on the press meant the gesture that would have scrolled a card into view
	// was also the gesture that dropped its editor. `pointercancel` is the
	// browser saying it took the gesture over for a scroll, which settles the
	// case even before the finger has drifted past the slop.
	//
	// The field's own blur commits asynchronously (it defers to let a completion
	// click land first), which races the unmount this triggers: closing first can
	// tear the field down before its deferred commit runs, silently dropping the
	// last edit. Reading the live text here and saving it before closing removes
	// the race.
	useEffect(() => {
		const dismiss = (): void => {
			const live = field.current;
			if (live) saveRef.current(live.getValue());
			onClose();
		};
		// Set while a press outside is still in flight, so an editor that closes
		// for another reason meanwhile takes its pending listeners with it.
		let pending: (() => void) | null = null;
		const onPointerDown = (evt: Event): void => {
			const target = evt.target;
			if (!(evt instanceof PointerEvent) || !(target instanceof Node)) return;
			if (rootRef.current?.contains(target)) return;
			if (target.instanceOf(Element) && target.closest(FLOATING)) return;
			const { clientX, clientY, pointerId } = evt;
			const settle = (up: Event): void => {
				// A second finger's events are not this press's answer.
				if (!(up instanceof PointerEvent) || up.pointerId !== pointerId) return;
				pending?.();
				if (up.type === 'pointerup' && isTap(up.clientX - clientX, up.clientY - clientY)) dismiss();
			};
			pending?.();
			pending = () => {
				pending = null;
				document.removeEventListener('pointerup', settle, true);
				document.removeEventListener('pointercancel', settle, true);
			};
			document.addEventListener('pointerup', settle, true);
			document.addEventListener('pointercancel', settle, true);
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			pending?.();
			document.removeEventListener('pointerdown', onPointerDown, true);
		};
	}, [onClose]);

	return (
		<div class="eb-card-editor" ref={rootRef} onClick={(e) => e.stopPropagation()}>
			<RichField
				app={api.app}
				value={cardEditText(card, config, showRaw)}
				placeholder={showRaw ? t('cardEditor.placeholderRaw') : t('cardEditor.placeholder')}
				scope={rootRef}
				onReady={(mounted) => {
					field.current = mounted;
				}}
				onRelease={(released) => {
					if (field.current === released) field.current = null;
				}}
				onSubmit={(text) => {
					onClose();
					save(text);
				}}
				onCommit={save}
				onCancel={onClose}
			/>
			<PropertyBadges
				config={config}
				card={card}
				target={target}
				api={api}
				settings={settings}
				field={field}
			/>
		</div>
	);
}
