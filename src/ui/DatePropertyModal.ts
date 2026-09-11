// Which date a calendar edit is about, when the card is on the grid through
// more than one property. Spec: docs/specs/calendar-view.md §6.2.
//
// A merged chip is one drawing of one card, but the values behind it are
// several, and only the user knows which of them the drag meant. So the grid
// asks — with the current value beside each name, because "start" and "due"
// tell apart by their dates, not by their names.

import { App, Modal } from 'obsidian';
import type { OccurrenceSource } from '../model/calendar';
import { t } from '../i18n';
import { keyboardAwareModal } from './keyboardInset';

export interface DatePropertyChoice {
	source: OccurrenceSource;
	/** The property's name, as the board declares it. */
	label: string;
	/** Its current value, already formatted; absent when it has none. */
	value?: string;
}

export interface DatePropertyModalOptions {
	title: string;
	message: string;
	choices: DatePropertyChoice[];
	/** Offer "All of them" — absent for an edit that only one value can take. */
	allowAll?: boolean;
}

/**
 * Ask which value to edit. Resolves to the chosen sources, or to `null` when
 * the modal was dismissed — dismissing moves nothing, which is what makes this
 * safe to raise in the middle of a drop.
 */
export function pickDateProperty(
	app: App,
	options: DatePropertyModalOptions,
): Promise<OccurrenceSource[] | null> {
	return new Promise((resolve) => {
		new DatePropertyModal(app, options, resolve).open();
	});
}

class DatePropertyModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: DatePropertyModalOptions,
		private readonly done: (sources: OccurrenceSource[] | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		keyboardAwareModal(this);
		this.modalEl.addClass('eb-date-property-modal');
		this.titleEl.setText(this.options.title);
		const el = this.contentEl;
		el.empty();
		el.createDiv({ cls: 'setting-item-description', text: this.options.message });

		const list = el.createDiv({ cls: 'eb-date-property-list' });
		for (const choice of this.options.choices) {
			const button = list.createEl('button', { cls: 'eb-date-property-choice' });
			button.createSpan({ cls: 'eb-date-property-name', text: choice.label });
			button.createSpan({
				cls: 'eb-date-property-value',
				text: choice.value ?? t('dateProperty.notSet'),
			});
			button.addEventListener('click', () => {
				this.finish([choice.source]);
			});
		}

		if (this.options.allowAll && this.options.choices.length > 1) {
			const all = list.createEl('button', { cls: 'eb-date-property-choice mod-cta' });
			all.createSpan({ cls: 'eb-date-property-name', text: t('dateProperty.all') });
			all.addEventListener('click', () => {
				this.finish(this.options.choices.map((choice) => choice.source));
			});
		}

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: t('common.cancel') });
		cancel.addEventListener('click', () => {
			this.close();
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private finish(sources: OccurrenceSource[] | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(sources);
		if (sources !== null) this.close();
	}
}
