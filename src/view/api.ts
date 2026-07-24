// The editing surface the Preact tree talks to. `BoardView` owns the board and
// the save path; components only describe *what* changed via a pure op from
// `model/ops.ts`. Spec: docs/specs/kanban-view.md §6.

import { App, Modal, Notice } from 'obsidian';
import type { Board } from '../model/types';

export interface BoardApi {
	/** Apply a pure op; a no-op op (same reference back) never touches the file. */
	update(mutate: (board: Board) => Board): void;
	/** Ask before something destructive. Resolves false when dismissed. */
	confirm(title: string, message: string, cta: string): Promise<boolean>;
	/** Open the vault search for a tag, as clicking a tag elsewhere does. */
	searchTag(tag: string): void;
}

/**
 * The global search plugin is a core plugin but is not part of the public API,
 * so it is reached through a narrow structural type and every step is checked:
 * a user can disable it, and then the tag click just explains itself.
 */
interface SearchCapableApp {
	internalPlugins?: {
		getPluginById(id: string): { instance?: { openGlobalSearch?: (query: string) => void } } | null;
	};
}

export function searchTag(app: App, tag: string): void {
	const search = (app as App & SearchCapableApp).internalPlugins?.getPluginById('global-search');
	const open = search?.instance?.openGlobalSearch;
	if (!open) {
		new Notice('Search is disabled — enable it to search by tag.');
		return;
	}
	open.call(search.instance, `tag:#${tag}`);
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
