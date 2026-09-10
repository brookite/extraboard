// A stack's parameters in one small form: its name, whether it completes the
// cards that land in it, and its accent color. Spec:
// stack-completion-and-divider-colors.md §3.3, §6.
//
// The same modal creates a stack and edits one, so both are offered wherever a
// stack comes into being — the composer never leaves them to be discovered later
// in a menu.

import { App, Modal, Setting } from 'obsidian';
import { colorField } from './ColorPicker';
import { t } from '../i18n';

export interface StackFields {
	name: string;
	completes: boolean;
	/** Any CSS color; `''` means the stack has no accent. */
	accent: string;
}

interface StackModalOptions extends Partial<StackFields> {
	/** Modal title, e.g. "Add stack" / "Edit stack". */
	title: string;
	/** Label of the confirming button. */
	cta: string;
}

/**
 * Open the form. Resolves to the fields, or to `null` when it was dismissed —
 * dismissing creates and changes nothing.
 */
export function editStack(app: App, options: StackModalOptions): Promise<StackFields | null> {
	return new Promise((resolve) => {
		new StackModal(app, options, resolve).open();
	});
}

class StackModal extends Modal {
	private fields: StackFields;
	private resolved = false;

	constructor(
		app: App,
		private readonly options: StackModalOptions,
		private readonly done: (fields: StackFields | null) => void,
	) {
		super(app);
		this.fields = {
			name: options.name ?? '',
			completes: options.completes ?? false,
			accent: options.accent ?? '',
		};
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title);
		const el = this.contentEl;
		el.empty();

		const name = new Setting(el).setName(t('modal.stack.name')).addText((text) =>
			text
				.setPlaceholder(t('modal.stack.namePlaceholder'))
				.setValue(this.fields.name)
				.onChange((value) => {
					this.fields.name = value;
				}),
		);
		// Enter confirms, like every other one-field form on the board.
		const input = name.controlEl.querySelector('input');
		input?.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			event.preventDefault();
			this.finish(this.fields);
		});

		new Setting(el)
			.setName(t('modal.stack.completes'))
			.setDesc(t('modal.stack.completesDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.fields.completes).onChange((value) => {
					this.fields.completes = value;
				}),
			);

		// The shared color control, the same one the property and tag editors use,
		// so a stack accent is picked from the same palette as everything else.
		const accent = new Setting(el)
			.setName(t('modal.stack.accent'))
			.setDesc(t('modal.stack.accentDesc'));
		colorField(this.app, accent.controlEl, t('modal.stack.accent'), this.fields.accent, (value) => {
			this.fields.accent = value;
		});

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: t('common.cancel') });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const confirm = buttons.createEl('button', { cls: 'mod-cta', text: this.options.cta });
		confirm.addEventListener('click', () => {
			this.finish(this.fields);
		});

		input?.focus();
		input?.select();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private finish(fields: StackFields | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(fields === null ? null : { ...fields, name: fields.name.trim() });
		if (fields !== null) this.close();
	}
}
