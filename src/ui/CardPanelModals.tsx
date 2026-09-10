// The card editor's two large panels as modals, which is how a phone gets them.
// Spec: docs/specs/mobile.md §7.1.
//
// Inline, both panels live inside `.eb-stack-body` — the board's only vertical
// scroller — and both open with a focused control. The web view answers that
// focus by scrolling the panel into view, which drags the card being edited out
// of it. A modal is outside that scroller entirely, so the board does not move
// and Obsidian's own modal handles the keyboard, as it does everywhere else.

import type { App } from 'obsidian';
import type { RefObject } from 'preact';
import type { ItemRef } from '../model/ops';
import type { PropertyDef, PropertyValue } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from '../view/api';
import type { CardField } from '../view/CardEditor';
import { TagPicker } from '../view/components/TagPicker';
import { ValueEditor } from '../view/components/ValueEditor';
import { openPreactModal } from './PreactModal';
import { t } from '../i18n';

/**
 * The tag picker (card-content-and-checklists.md §3.1.1) in a modal. It still
 * edits the card **field's** text, so the card editor behind it stays open —
 * `CardEditor`'s dismissal already ignores anything inside `.modal-container`.
 */
export function openTagPickerModal(
	app: App,
	options: { field: RefObject<CardField | null>; api: BoardApi },
): void {
	openPreactModal(app, {
		title: t('tagPicker.title'),
		cls: 'eb-panel-modal',
		body: (close) => <TagPicker field={options.field} api={options.api} onClose={close} />,
	});
}

export interface ValueEditorModalOptions {
	name: string;
	def: PropertyDef | undefined;
	target: ItemRef;
	api: BoardApi;
	settings: ExtraboardSettings;
	onCommit: (pv: PropertyValue | null) => void;
	onRemove: () => void;
}

/**
 * One property's value editor in a modal, for the types whose editor is a
 * calendar. The value is re-read from the board on every board change rather
 * than captured at open: a `date-list` grows an entry per commit, and the modal
 * outlives each of them.
 */
export function openValueEditorModal(app: App, options: ValueEditorModalOptions): void {
	const { name, def, target, api, settings, onCommit, onRemove } = options;
	openPreactModal(app, {
		title: name,
		cls: 'eb-panel-modal',
		subscribe: (rerender) => api.onChange(rerender),
		body: (close) => (
			<ValueEditor
				name={name}
				def={def}
				pv={liveValue(api, target, name)}
				api={api}
				settings={settings}
				onCommit={onCommit}
				onRemove={() => {
					onRemove();
					close();
				}}
				onClose={close}
			/>
		),
	});
}

/** The card's current value for `name`, read through the board as it stands now. */
function liveValue(api: BoardApi, target: ItemRef, name: string): PropertyValue | undefined {
	const entry = api.getBoard()?.stacks[target.stack]?.items[target.item];
	if (entry?.kind !== 'card') return undefined;
	return entry.card.properties.find((pv) => pv.name === name);
}
