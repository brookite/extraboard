// A stack's parameters in one small form: its name and whether it completes the
// cards that land in it. Spec: stack-completion-and-divider-colors.md §3.3.
//
// The same modal creates a stack and edits one, so the flag is offered wherever
// a stack comes into being — the composer never leaves it to be discovered later
// in a menu.

import { App, Modal, Setting } from 'obsidian';

export interface StackFields {
	name: string;
	completes: boolean;
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
		this.fields = { name: options.name ?? '', completes: options.completes ?? false };
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title);
		const el = this.contentEl;
		el.empty();

		const name = new Setting(el).setName('Name').addText((text) =>
			text
				.setPlaceholder('Stack name')
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
			.setName('Counts cards as completed')
			.setDesc(
				'A card moved into this stack is marked done, together with every item of its checklist. Cards already here are left as they are.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.fields.completes).onChange((value) => {
					this.fields.completes = value;
				}),
			);

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
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
