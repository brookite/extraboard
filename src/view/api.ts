// The editing surface the Preact tree talks to. `BoardView` owns the board and
// the save path; components only describe *what* changed via a pure op from
// `model/ops.ts`. Spec: docs/specs/kanban-view.md §6.

import { App, Modal } from 'obsidian';
import type { Board } from '../model/types';

export interface BoardApi {
	/** Apply a pure op; a no-op op (same reference back) never touches the file. */
	update(mutate: (board: Board) => Board): void;
	/** Ask before something destructive. Resolves false when dismissed. */
	confirm(title: string, message: string, cta: string): Promise<boolean>;
}

class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private cta: string,
		private done: (ok: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createEl('p', { text: this.message });
		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		const confirm = buttons.createEl('button', { cls: 'mod-warning', text: this.cta });
		confirm.addEventListener('click', () => {
			this.finish(true);
			this.close();
		});
		confirm.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.finish(false);
	}

	private finish(ok: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(ok);
	}
}

export function confirmDestructive(
	app: App,
	title: string,
	message: string,
	cta: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, cta, resolve).open();
	});
}
