// The checklist editor: the only place a card's nested task list is edited in
// the board view. Spec: docs/specs/card-content-and-checklists.md §4.3.
//
// The board stays the single source of truth: every change goes out through
// `apply` as a pure tree transform and the rows are re-rendered from whatever
// comes back, so closing the modal is not a commit and dismissing it undoes
// nothing.

import { App, Modal, setIcon } from 'obsidian';
import Sortable from 'sortablejs';
import * as cl from '../model/checklist';
import type { ChecklistItem, ChecklistPath } from '../model/checklist';
import { t } from '../i18n';
import { showDropdownMenu } from '../util/menu';

export interface ChecklistModalOptions {
	/** The card's display text, shown as the modal title. */
	title: string;
	/** The card's checklist as it stands right now. */
	items(): ChecklistItem[];
	/** Apply a pure transform to it (through a board op). */
	apply(mutate: (items: ChecklistItem[]) => ChecklistItem[]): void;
}

/** `data-path` back into a path; `null` when the element carries none. */
function readPath(el: Element | null): ChecklistPath | null {
	if (!(el instanceof HTMLElement)) return null;
	const raw = el.dataset.path;
	if (raw === undefined || raw === '') return null;
	return raw.split('.').map(Number);
}

export class ChecklistModal extends Modal {
	private listEl!: HTMLElement;
	private countEl!: HTMLElement;
	private sortable: Sortable | null = null;
	/** Row to focus after the next render. */
	private focusPath: ChecklistPath | null = null;
	/** True while rows are being torn down, so a stale blur commits nothing. */
	private rebuilding = false;

	constructor(
		app: App,
		private options: ChecklistModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('eb-checklist-modal');
		this.titleEl.setText(this.options.title || t('modal.checklist.title'));
		this.countEl = this.titleEl.createSpan({ cls: 'eb-checklist-count' });

		this.listEl = this.contentEl.createDiv({ cls: 'eb-checklist' });
		this.enableDrag();

		const footer = this.contentEl.createDiv({ cls: 'eb-checklist-footer' });
		const add = footer.createEl('button', { cls: 'mod-cta', text: t('modal.checklist.addItem') });
		add.addEventListener('click', () => {
			this.change((items) => {
				const r = cl.insertAfter(items, this.lastRootPath(items));
				this.focusPath = r.path;
				return r.items;
			});
		});

		this.render();
	}

	override onClose(): void {
		this.sortable?.destroy();
		this.sortable = null;
		this.contentEl.empty();
	}

	// --- editing ---

	/** Apply a transform, then re-render from the board's new state. */
	private change(mutate: (items: ChecklistItem[]) => ChecklistItem[]): void {
		this.options.apply(mutate);
		this.render();
	}

	/** Path of the last root item, so "Add item" appends at the bottom. */
	private lastRootPath(items: ChecklistItem[]): ChecklistPath {
		return items.length ? [items.length - 1] : [];
	}

	private render(): void {
		this.rebuilding = true;
		this.listEl.empty();
		this.rebuilding = false;
		const items = this.options.items();
		const { done, total } = cl.progress(items);
		this.countEl.setText(total ? `  ${String(done)}/${String(total)}` : '');

		const rows = cl.flatten(items);
		if (!rows.length) {
			this.listEl.createDiv({ cls: 'eb-checklist-empty', text: t('modal.checklist.empty') });
		}
		for (const row of rows) this.renderRow(row.item, row.path);

		this.applyFocus();
	}

	private renderRow(item: ChecklistItem, path: ChecklistPath): void {
		const rowEl = this.listEl.createDiv({ cls: 'eb-checklist-row' });
		rowEl.setCssProps({ '--eb-checklist-depth': String(path.length - 1) });
		rowEl.dataset.path = path.join('.');

		// The row's only drag zone, so the text field keeps its own gestures.
		const grip = rowEl.createSpan({ cls: 'eb-checklist-grip' });
		setIcon(grip, 'grip-vertical');
		grip.setAttr('aria-hidden', 'true');
		grip.setAttr('title', t('modal.checklist.dragToReorder'));

		const check = rowEl.createEl('input', {
			type: 'checkbox',
			cls: 'task-list-item-checkbox',
		});
		check.checked = cl.isDone(item);
		// A custom marker (`[/]`, `[-]`) reads as "not done" and is only rewritten
		// when the user toggles that row (markdown-format.md §4.5).
		check.setAttr(
			'aria-label',
			cl.isDone(item) ? t('modal.checklist.markNotDone') : t('modal.checklist.markDone'),
		);
		check.addEventListener('change', () => {
			this.change((items) => cl.toggle(items, path));
		});

		const input = rowEl.createEl('input', { type: 'text', cls: 'eb-checklist-text' });
		input.value = item.text;
		input.dataset.path = path.join('.');
		input.addEventListener('change', () => {
			this.commitText(path, input.value);
		});
		input.addEventListener('blur', () => {
			this.commitText(path, input.value);
		});
		input.addEventListener('keydown', (evt) => {
			this.onKeyDown(evt, path, input);
		});

		const menu = rowEl.createEl('button', { cls: 'eb-icon-button', attr: { type: 'button' } });
		setIcon(menu, 'more-vertical');
		menu.setAttr('aria-label', t('modal.checklist.itemOptions'));
		menu.addEventListener('click', (evt) => {
			this.openRowMenu(evt, path, input);
		});
	}

	private commitText(path: ChecklistPath, text: string): void {
		if (this.rebuilding) return;
		const current = cl.itemAt(this.options.items(), path);
		if (!current || current.text === text) return;
		// No re-render: the field already shows the new text and the caret must
		// stay where the user left it.
		this.options.apply((items) => cl.updateItem(items, path, { text }));
		this.refreshCount();
	}

	private refreshCount(): void {
		const { done, total } = cl.progress(this.options.items());
		this.countEl.setText(total ? `  ${String(done)}/${String(total)}` : '');
	}

	/**
	 * Enter adds a sibling, Tab/Shift+Tab indent and outdent, Alt+↑/↓ move the
	 * row with its subtree, and Backspace on an empty row deletes it. Escape is
	 * left to the modal, which closes.
	 */
	private onKeyDown(evt: KeyboardEvent, path: ChecklistPath, input: HTMLInputElement): void {
		if (evt.isComposing) return;

		if (evt.key === 'Enter') {
			evt.preventDefault();
			this.commitText(path, input.value);
			this.change((items) => {
				const r = cl.insertAfter(items, path);
				this.focusPath = r.path;
				return r.items;
			});
			return;
		}

		if (evt.key === 'Tab') {
			evt.preventDefault();
			this.commitText(path, input.value);
			this.change((items) => {
				const r = evt.shiftKey ? cl.outdent(items, path) : cl.indent(items, path);
				this.focusPath = r.path;
				return r.items;
			});
			return;
		}

		if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
			evt.preventDefault();
			this.commitText(path, input.value);
			this.change((items) => {
				const r = cl.move(items, path, evt.key === 'ArrowUp' ? -1 : 1);
				this.focusPath = r.path;
				return r.items;
			});
			return;
		}

		if (evt.key === 'Backspace' && input.value === '') {
			evt.preventDefault();
			const previous = this.previousPath(path);
			this.change((items) => {
				this.focusPath = previous;
				return cl.removeAt(items, path);
			});
		}
	}

	/** The row above `path` in display order, or `null` at the top. */
	private previousPath(path: ChecklistPath): ChecklistPath | null {
		const rows = cl.flatten(this.options.items());
		const at = rows.findIndex((r) => cl.samePath(r.path, path));
		return at > 0 ? rows[at - 1]!.path : null;
	}

	// --- drag & drop ------------------------------------------------------

	/**
	 * Rows are dragged by their grip. The list is flat in the DOM but a tree in
	 * the model, so a dropped row **takes the slot it was dropped into** — the
	 * level of the row it now sits in front of — and carries its subtree along
	 * (`model/checklist.ts: moveTo`).
	 */
	private enableDrag(): void {
		this.sortable = Sortable.create(this.listEl, {
			animation: 150,
			handle: '.eb-checklist-grip',
			draggable: '.eb-checklist-row',
			ghostClass: 'eb-drag-ghost',
			dragClass: 'eb-drag-item',
			fallbackOnBody: true,
			onEnd: (evt) => {
				const from = readPath(evt.item);
				// Pre-move coordinates on both sides: the model resolves the move,
				// and `render` rebuilds every row from what it returns.
				const to = readPath(evt.item.nextElementSibling);
				this.revert(evt);
				if (!from) return;
				this.change((items) => {
					const r = cl.moveTo(items, from, to);
					this.focusPath = r.path;
					return r.items;
				});
			},
		});
	}

	/** Undo Sortable's DOM move, so `render` starts from the document it built. */
	private revert(evt: Sortable.SortableEvent): void {
		const { item, from, oldIndex } = evt;
		item.remove();
		from.insertBefore(item, oldIndex === undefined ? null : (from.children[oldIndex] ?? null));
	}

	private openRowMenu(evt: MouseEvent, path: ChecklistPath, input: HTMLInputElement): void {
		this.commitText(path, input.value);
		showDropdownMenu(evt, (menu) => {
			const structural = (
			title: string,
			icon: string,
			mutate: (items: ChecklistItem[]) => { items: ChecklistItem[]; path: ChecklistPath },
			): void => {
				menu.addItem((mi) =>
					mi
						.setTitle(title)
						.setIcon(icon)
						.onClick(() => {
							this.change((items) => {
								const r = mutate(items);
								this.focusPath = r.path;
								return r.items;
							});
						}),
				);
			};

			structural(t('modal.checklist.indent'), 'indent', (items) => cl.indent(items, path));
			structural(t('modal.checklist.outdent'), 'outdent', (items) => cl.outdent(items, path));
			structural(t('propertyDefs.moveUp'), 'arrow-up', (items) => cl.move(items, path, -1));
			structural(t('propertyDefs.moveDown'), 'arrow-down', (items) => cl.move(items, path, 1));
			menu.addSeparator();
			menu.addItem((mi) =>
				mi
					.setTitle(t('modal.checklist.deleteItem'))
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => {
						this.change((items) => {
							this.focusPath = null;
							return cl.removeAt(items, path);
						});
					}),
			);
		});
	}

	private applyFocus(): void {
		const path = this.focusPath;
		this.focusPath = null;
		if (!path) return;
		const el = this.listEl.querySelector(`.eb-checklist-text[data-path="${path.join('.')}"]`);
		if (!(el instanceof HTMLInputElement)) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}
}
