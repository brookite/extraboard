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
import { createEmbeddedEditor, type EmbeddedEditorHandle } from '../view/embeddedEditor';
import { t } from '../i18n';
import { showDropdownMenu } from '../util/menu';
import { keyboardAwareModal } from './keyboardInset';

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
	/**
	 * The one row being edited (§4.3). One at a time, because each editor is a
	 * whole CodeMirror instance and a checklist can be long — a row is a piece of
	 * text until it is pointed at.
	 */
	private editing: { path: ChecklistPath; handle: EmbeddedEditorHandle } | null = null;

	constructor(
		app: App,
		private options: ChecklistModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		keyboardAwareModal(this);
		this.modalEl.addClass('eb-checklist-modal');
		this.titleEl.setText(this.options.title || t('modal.checklist.title'));
		this.countEl = this.titleEl.createSpan({ cls: 'eb-checklist-count' });

		this.listEl = this.contentEl.createDiv({ cls: 'eb-checklist' });
		this.enableDrag();

		const footer = this.contentEl.createDiv({ cls: 'eb-checklist-footer' });
		const add = footer.createEl('button', { cls: 'mod-cta', text: t('modal.checklist.addItem') });
		add.addEventListener('click', () => {
			// Commit first: `change` → `render` tears the open row's editor down
			// without saving, and a click here must not race that teardown away.
			this.closeEditor(true);
			this.change((items) => {
				const r = cl.insertAfter(items, this.lastRootPath(items));
				this.focusPath = r.path;
				return r.items;
			});
		});

		this.render();
	}

	override onClose(): void {
		// Commit first: the last thing typed is as much an edit as any other, and
		// dismissing the modal was never a way to undo one.
		this.closeEditor(true);
		// Rows left empty by an "Add item"/Enter the user never filled in don't
		// belong in the saved checklist.
		this.options.apply((items) => cl.pruneEmpty(items));
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
		// The editor lives inside a row, and every row is about to be replaced.
		this.closeEditor(false);
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

		// Text, not a field: the row becomes an editor when it is pointed at, and
		// only then (§4.3). Focusable, so Tab still walks the list.
		const text = rowEl.createDiv({ cls: 'eb-checklist-text' });
		text.dataset.path = path.join('.');
		text.tabIndex = 0;
		this.fillText(text, item.text);
		const edit = (): void => this.editRow(path);
		text.addEventListener('click', edit);
		text.addEventListener('focus', edit);

		const menu = rowEl.createEl('button', { cls: 'eb-icon-button', attr: { type: 'button' } });
		setIcon(menu, 'more-vertical');
		menu.setAttr('aria-label', t('modal.checklist.itemOptions'));
		menu.addEventListener('click', (evt) => {
			this.openRowMenu(evt, path);
		});
	}

	/** A row's read-mode content: its text, or the placeholder for an empty one. */
	private fillText(el: HTMLElement, text: string): void {
		el.empty();
		el.removeClass('is-editing');
		if (text) el.setText(text);
		else el.createSpan({ cls: 'eb-placeholder', text: t('modal.checklist.itemPlaceholder') });
	}

	private textEl(path: ChecklistPath): HTMLElement | null {
		const el = this.listEl.querySelector(`.eb-checklist-text[data-path="${path.join('.')}"]`);
		return el instanceof HTMLElement ? el : null;
	}

	/**
	 * Turn one row into the board's own Markdown field, so `[[` and `#` complete
	 * here exactly as they do in a card (§4.3) — one line only: Enter belongs to
	 * the list, not to the text.
	 */
	private editRow(path: ChecklistPath): void {
		if (this.editing && cl.samePath(this.editing.path, path)) return;
		this.closeEditor(true);
		const el = this.textEl(path);
		const item = cl.itemAt(this.options.items(), path);
		if (!el || !item) return;

		el.empty();
		el.addClass('is-editing');
		const handle = createEmbeddedEditor(this.app, el, {
			value: item.text,
			singleLine: true,
			onKey: (evt) => this.onEditorKey(evt, path),
			// Focus left the row: keep what was typed, and go back to text.
			onSubmit: (text) => {
				this.editing = null;
				this.commitText(path, text);
				const target = this.textEl(path);
				if (target) this.fillText(target, text);
			},
			onCancel: () => {
				this.editing = null;
				const current = cl.itemAt(this.options.items(), path);
				const target = this.textEl(path);
				if (target) this.fillText(target, current?.text ?? '');
			},
		});
		// No embedded editor on this Obsidian version: the plain field of M6 is
		// still a field, and a checklist item must always be editable.
		if (!handle) {
			this.editInput(el, path, item.text);
			return;
		}
		this.editing = { path, handle };
		handle.focus();
	}

	/** The textarea-free fallback: one plain input, wired to the same keys. */
	private editInput(el: HTMLElement, path: ChecklistPath, value: string): void {
		const input = el.createEl('input', { type: 'text', cls: 'eb-checklist-input' });
		input.value = value;
		input.addEventListener('change', () => this.commitText(path, input.value));
		input.addEventListener('blur', () => {
			this.commitText(path, input.value);
			const target = this.textEl(path);
			if (target && !this.rebuilding) this.fillText(target, input.value);
		});
		input.addEventListener('keydown', (evt) => {
			if (evt.isComposing) return;
			if (this.onEditorKey(evt, path, () => input.value)) {
				evt.preventDefault();
				return;
			}
			if (evt.key === 'Escape') input.blur();
		});
		input.focus();
		input.setSelectionRange(value.length, value.length);
	}

	/**
	 * The keys a row owns, whichever field is mounted: Enter adds a sibling,
	 * Tab/Shift+Tab indent and outdent, Alt+↑/↓ move the row with its subtree.
	 * **Backspace is not one of them** — an empty row is a row the user is still
	 * writing, so deleting it is a menu item, never a keystroke (§4.3).
	 */
	private onEditorKey(evt: KeyboardEvent, path: ChecklistPath, read?: () => string): boolean {
		const value = (): string => read?.() ?? this.editing?.handle.getValue() ?? '';

		if (evt.key === 'Enter') {
			const text = value();
			this.closeEditor(false);
			this.commitText(path, text);
			this.change((items) => {
				const r = cl.insertAfter(items, path);
				this.focusPath = r.path;
				return r.items;
			});
			return true;
		}

		if (evt.key === 'Tab') {
			const text = value();
			this.closeEditor(false);
			this.commitText(path, text);
			this.change((items) => {
				const r = evt.shiftKey ? cl.outdent(items, path) : cl.indent(items, path);
				this.focusPath = r.path;
				return r.items;
			});
			return true;
		}

		if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
			const text = value();
			this.closeEditor(false);
			this.commitText(path, text);
			this.change((items) => {
				const r = cl.move(items, path, evt.key === 'ArrowUp' ? -1 : 1);
				this.focusPath = r.path;
				return r.items;
			});
			return true;
		}

		return false;
	}

	/**
	 * Tear the editor down. `commit` writes what it holds first; the structural
	 * keys pass `false` because they have already read and written the text
	 * themselves, and a second write would race the re-render.
	 */
	private closeEditor(commit: boolean): void {
		const editing = this.editing;
		if (!editing) return;
		this.editing = null;
		const text = editing.handle.getValue();
		editing.handle.destroy();
		if (commit) this.commitText(editing.path, text);
		const el = this.rebuilding ? null : this.textEl(editing.path);
		if (el) this.fillText(el, commit ? text : (cl.itemAt(this.options.items(), editing.path)?.text ?? ''));
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

	private openRowMenu(evt: MouseEvent, path: ChecklistPath): void {
		// Whatever the row holds is written before the menu acts on it.
		this.closeEditor(true);
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

	/**
	 * Put the caret back where the last edit left it — by opening the row's
	 * editor, so a chain of Enters, Tabs or Alt+arrows never drops the user out
	 * of the text.
	 */
	private applyFocus(): void {
		const path = this.focusPath;
		this.focusPath = null;
		if (!path || !this.textEl(path)) return;
		this.editRow(path);
	}
}
