// A modal whose body is a Preact tree. Spec: docs/specs/mobile.md §7.1.
//
// The board's own panels — the tag picker, a property's value editor — are
// components, not DOM builders, so the phone's modal host renders the *same*
// component rather than a second, drifting rendering of it. `DayModal` does the
// same thing by hand; this is that pattern with nothing calendar-specific left.

import { App, Modal } from 'obsidian';
import { render, type ComponentChild } from 'preact';

export interface PreactModalOptions {
	/** The modal's heading. */
	title: string;
	/** An extra class on the modal element, so one panel can be shaped alone. */
	cls?: string;
	/** The body, rebuilt on open and on every re-render; `close` shuts the modal. */
	body: (close: () => void) => ComponentChild;
	/**
	 * Subscribe the modal to whatever it reads through — the board, for an
	 * editor whose value the op it just applied has replaced. Returns the
	 * unsubscribe, which runs on close.
	 */
	subscribe?: (rerender: () => void) => () => void;
	/** Ran after the tree is unmounted. */
	onClose?: () => void;
}

export function openPreactModal(app: App, options: PreactModalOptions): void {
	new PreactModal(app, options).open();
}

class PreactModal extends Modal {
	private unsubscribe?: () => void;

	constructor(
		app: App,
		private readonly options: PreactModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('eb-preact-modal');
		if (this.options.cls) this.modalEl.addClass(this.options.cls);
		this.titleEl.setText(this.options.title);
		this.unsubscribe = this.options.subscribe?.(() => this.draw());
		this.draw();
	}

	override onClose(): void {
		this.unsubscribe?.();
		render(null, this.contentEl);
		this.contentEl.empty();
		this.options.onClose?.();
	}

	private draw(): void {
		render(this.options.body(() => this.close()), this.contentEl);
	}
}
