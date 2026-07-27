// The manage-views modal: list, switch, create, configure — one place, no
// staged state (every action applies its op immediately).
// Spec: docs/specs/views.md §4.

import { App, Modal, Setting, setIcon } from 'obsidian';
import * as ops from '../model/ops';
import type { Board, CalendarMode, PropertyDef, ViewDef, ViewKind } from '../model/types';
import { dateProperties, defaultViewName, hasKanbanView, isViewUsable } from '../model/views';
import type { BoardApi } from '../view/api';
import { ICONS, viewIcon } from '../util/constants';
import { t } from '../i18n';

export interface ViewsModalOptions {
	api: BoardApi;
	/** Escape hatch from "this board has no date property" (views.md §4.3). */
	openBoardSettings: () => void;
	/** Called when the user picks a view; the modal closes right after. */
	onSwitch?: (id: string) => void;
}

export function openViewsModal(app: App, options: ViewsModalOptions): void {
	new ViewsModal(app, options).open();
}

class ViewsModal extends Modal {
	constructor(
		app: App,
		private readonly options: ViewsModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(t('modal.views.title'));
		this.modalEl.addClass('eb-views-modal');
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private board(): Board | null {
		return this.options.api.getBoard();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const board = this.board();
		if (!board) return;

		const { views, activeView } = board.config;
		const list = el.createDiv({ cls: 'eb-views-list' });
		views.forEach((view, index) => {
			this.renderRow(list, board, view, index, view.id === activeView);
		});

		const actions = el.createDiv({ cls: 'modal-button-container' });
		const add = actions.createEl('button', { cls: 'mod-cta', text: t('modal.views.newView') });
		add.addEventListener('click', () => {
			this.createView();
		});
	}

	private renderRow(
		list: HTMLElement,
		board: Board,
		view: ViewDef,
		index: number,
		active: boolean,
	): void {
		const row = list.createDiv({ cls: 'eb-views-row' });
		if (active) row.addClass('is-active');

		// The card body is the switch (views.md §4.1).
		const main = row.createEl('button', { cls: 'eb-views-main' });
		main.disabled = active;
		const icon = main.createSpan({ cls: 'eb-views-icon' });
		setIcon(icon, viewIcon(view.type));
		const text = main.createDiv({ cls: 'eb-views-text' });
		text.createDiv({ cls: 'eb-views-name', text: view.name });
		text.createDiv({ cls: 'eb-views-desc', text: describe(board, view) });
		if (active) main.createSpan({ cls: 'eb-views-active', text: t('modal.views.active') });
		main.addEventListener('click', () => {
			this.options.api.update((b) => ops.setActiveView(b, view.id));
			this.options.onSwitch?.(view.id);
			this.close();
		});

		const buttons = row.createDiv({ cls: 'eb-views-actions' });
		const move = (before: number | null, label: string, iconName: string, enabled: boolean) => {
			const button = buttons.createEl('button', { cls: 'eb-views-button' });
			setIcon(button, iconName);
			button.setAttribute('aria-label', label);
			button.disabled = !enabled;
			button.addEventListener('click', () => {
				this.options.api.update((b) => ops.moveView(b, view.id, before));
				this.render();
			});
		};
		move(index - 1, t('propertyDefs.moveUp'), ICONS.up, index > 0);
		move(index + 2, t('propertyDefs.moveDown'), ICONS.down, index < board.config.views.length - 1);

		const edit = buttons.createEl('button', { cls: 'eb-views-button' });
		setIcon(edit, ICONS.edit);
		edit.setAttribute('aria-label', t('modal.views.editView'));
		edit.addEventListener('click', () => {
			this.editView(view);
		});

		const remove = buttons.createEl('button', { cls: 'eb-views-button mod-warning' });
		setIcon(remove, ICONS.delete);
		const last = board.config.views.length <= 1;
		remove.setAttribute(
			'aria-label',
			last ? t('modal.views.needsOneView') : t('modal.views.deleteView'),
		);
		remove.disabled = last;
		remove.addEventListener('click', () => {
			void this.deleteView(view);
		});
	}

	private async deleteView(view: ViewDef): Promise<void> {
		const ok = await this.options.api.confirm(
			t('modal.views.deleteView'),
			t('modal.views.deleteConfirmMessage', { name: view.name }),
			t('common.delete'),
		);
		if (!ok) return;
		this.options.api.update((b) => ops.deleteView(b, view.id));
		this.render();
	}

	private createView(): void {
		const board = this.board();
		if (!board) return;
		const dates = dateProperties(board.config);
		const kanbanTaken = hasKanbanView(board.config.views);
		const type: ViewKind = kanbanTaken ? 'calendar' : 'kanban';
		void this.form({
			title: t('modal.views.newView'),
			cta: t('modal.newBoard.cta'),
			fields: {
				name: defaultViewName(type),
				type,
				dateProperty: dates.length === 1 ? dates[0]?.name : undefined,
				mode: 'month',
			},
			lockType: false,
			kanbanTaken,
			dates,
		}).then((fields) => {
			if (!fields) return;
			this.options.api.update((b) =>
				ops.addView(
					b,
					fields.type === 'calendar'
						? {
								name: fields.name || defaultViewName('calendar'),
								type: 'calendar',
								dateProperty: fields.dateProperty ?? '',
								mode: fields.mode,
							}
						: { name: fields.name || defaultViewName('kanban'), type: 'kanban' },
					false,
				),
			);
			this.render();
		});
	}

	private editView(view: ViewDef): void {
		const board = this.board();
		if (!board) return;
		void this.form({
			title: t('modal.views.editView'),
			cta: t('modal.boardSettings.save'),
			fields: {
				name: view.name,
				type: view.type,
				dateProperty: view.type === 'calendar' ? view.dateProperty : undefined,
				mode: view.type === 'calendar' ? view.mode : 'month',
			},
			lockType: true,
			kanbanTaken: hasKanbanView(board.config.views),
			dates: dateProperties(board.config),
		}).then((fields) => {
			if (!fields) return;
			this.options.api.update((b) =>
				ops.updateView(b, view.id, {
					name: fields.name || defaultViewName(fields.type),
					...(fields.type === 'calendar' && {
						dateProperty: fields.dateProperty,
						mode: fields.mode,
					}),
				}),
			);
			this.render();
		});
	}

	private form(options: Omit<ViewFormOptions, 'openBoardSettings'>): Promise<ViewFields | null> {
		return new Promise((resolve) => {
			new ViewFormModal(
				this.app,
				{
					...options,
					openBoardSettings: () => {
						this.close();
						this.options.openBoardSettings();
					},
				},
				resolve,
			).open();
		});
	}
}

/** Subtitle of a view card: what it is, and what it is computed from. */
function describe(board: Board, view: ViewDef): string {
	if (view.type !== 'calendar') return t('modal.views.kanban');
	const mode = view.mode === 'month' ? t('modal.views.mode.month') : t('modal.views.mode.week');
	const suffix = isViewUsable(board.config, view) ? '' : t('modal.views.missingProperty');
	return t('modal.views.describeCalendar', { prop: view.dateProperty, mode }) + suffix;
}

// --- the view form ----------------------------------------------------------

interface ViewFields {
	name: string;
	type: ViewKind;
	dateProperty?: string;
	mode: CalendarMode;
}

interface ViewFormOptions {
	title: string;
	cta: string;
	fields: ViewFields;
	/** Editing: the type is fixed once a view exists (views.md §4.2). */
	lockType: boolean;
	kanbanTaken: boolean;
	dates: PropertyDef[];
	openBoardSettings: () => void;
}

class ViewFormModal extends Modal {
	private fields: ViewFields;
	private resolved = false;

	constructor(
		app: App,
		private readonly options: ViewFormOptions,
		private readonly done: (fields: ViewFields | null) => void,
	) {
		super(app);
		this.fields = { ...options.fields };
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const { dates, kanbanTaken, lockType } = this.options;
		const calendarPossible = dates.length > 0;
		// Editing a Kanban view must not report *itself* as the blocking one.
		const kanbanPossible = !kanbanTaken || (lockType && this.fields.type === 'kanban');

		const name = new Setting(el).setName(t('modal.stack.name')).addText((text) =>
			text
				.setPlaceholder(defaultViewName(this.fields.type))
				.setValue(this.fields.name)
				.onChange((value) => {
					this.fields.name = value;
				}),
		);
		const input = name.controlEl.querySelector('input');
		input?.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || !this.usable()) return;
			event.preventDefault();
			this.finish(this.fields);
		});

		const typeSetting = new Setting(el).setName(t('modal.views.type')).addDropdown((dropdown) => {
			dropdown
				.addOptions({ kanban: t('modal.views.kanban'), calendar: t('modal.views.calendar') })
				.setValue(this.fields.type)
				.onChange((value) => {
					this.fields.type = value as ViewKind;
					if (this.fields.name === defaultViewName(other(this.fields.type))) {
						this.fields.name = defaultViewName(this.fields.type);
					}
					if (this.fields.type === 'calendar' && !this.fields.dateProperty && dates.length === 1) {
						this.fields.dateProperty = dates[0]?.name;
					}
					this.render();
				});
			dropdown.selectEl.disabled = lockType;
			for (const option of Array.from(dropdown.selectEl.options)) {
				if (option.value === 'kanban' && !kanbanPossible) option.disabled = true;
				if (option.value === 'calendar' && !calendarPossible) option.disabled = true;
			}
		});
		if (lockType) {
			typeSetting.setDesc(t('modal.views.typeFixedDesc'));
		}

		// Both limits are shown with their reason rather than hidden (views.md §4.3, §4.4).
		if (!lockType && !kanbanPossible) {
			el.createDiv({
				cls: 'setting-item-description eb-views-note',
				text: t('modal.views.kanbanTakenNote'),
			});
		}
		if (!calendarPossible) {
			const note = el.createDiv({ cls: 'setting-item-description eb-views-note' });
			note.createDiv({
				text: t('modal.views.calendarNeedsDateNote'),
			});
			const open = note.createEl('button', { text: t('command.boardSettings') });
			open.addEventListener('click', () => {
				this.close();
				this.options.openBoardSettings();
			});
		}

		if (this.fields.type === 'calendar' && calendarPossible) {
			new Setting(el)
				.setName(t('modal.views.dateProperty'))
				.setDesc(t('modal.views.datePropertyDesc'))
				.addDropdown((dropdown) => {
					const options: Record<string, string> = {};
					for (const def of dates) options[def.name] = `${def.name} (${def.type})`;
					dropdown
						.addOptions(options)
						.setValue(this.fields.dateProperty ?? dates[0]?.name ?? '')
						.onChange((value) => {
							this.fields.dateProperty = value;
						});
					this.fields.dateProperty ??= dropdown.getValue();
				});

			new Setting(el).setName(t('modal.views.mode.label')).addDropdown((dropdown) =>
				dropdown
					.addOptions({ month: t('modal.views.mode.month'), week: t('modal.views.mode.week') })
					.setValue(this.fields.mode)
					.onChange((value) => {
						this.fields.mode = value as CalendarMode;
					}),
			);
		}

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		const cancel = buttons.createEl('button', { text: t('common.cancel') });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const confirm = buttons.createEl('button', { cls: 'mod-cta', text: this.options.cta });
		confirm.disabled = !this.usable();
		confirm.addEventListener('click', () => {
			this.finish(this.fields);
		});

		input?.focus();
		input?.select();
	}

	/** A calendar without a date property is never created (views.md §4.3). */
	private usable(): boolean {
		if (this.fields.type === 'kanban') {
			return this.options.lockType || !this.options.kanbanTaken;
		}
		return Boolean(this.fields.dateProperty);
	}

	private finish(fields: ViewFields | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(fields === null ? null : { ...fields, name: fields.name.trim() });
		if (fields !== null) this.close();
	}
}

function other(type: ViewKind): ViewKind {
	return type === 'kanban' ? 'calendar' : 'kanban';
}
