// The reminders section of Board settings: one row per reminder.
// Spec: docs/specs/digest-and-reminders.md §4.1, §6.

import type { App } from 'obsidian';
import {
	REMINDER_UNITS,
	doneFilter,
	nextReminderId,
	type ReminderDef,
	type ReminderRepeat,
	type ReminderUnit,
} from '../model/reminders';
import { isCalendarProperty } from '../model/views';
import { t } from '../i18n';
import { cloneJson, definitionFilterButton, type DefinitionEditorOptions } from './DigestEditor';

export class RemindersEditor {
	private reminders: ReminderDef[];

	constructor(
		private readonly app: App,
		private readonly container: HTMLElement,
		reminders: readonly ReminderDef[] | undefined,
		private readonly onChange: (reminders: ReminderDef[] | undefined) => void,
		private readonly options: DefinitionEditorOptions,
	) {
		this.reminders = cloneJson([...(reminders ?? [])]);
	}

	render(): void {
		const el = this.container;
		el.empty();
		el.addClass('eb-pe');
		const names = this.options
			.properties()
			.filter((p) => isCalendarProperty(p))
			.map((p) => p.name);

		if (!this.reminders.length) el.createDiv({ cls: 'eb-pe-empty', text: t('reminder.editor.empty') });
		this.reminders.forEach((reminder, index) => this.renderRow(el, reminder, index, names));

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: t('reminder.editor.add') });
		add.disabled = names.length === 0;
		if (!names.length) add.title = t('digest.editor.noDateProperties');
		add.addEventListener('click', () => {
			this.reminders.push({
				id: nextReminderId(this.reminders),
				comment: '',
				property: names[0] ?? '',
				repeat: 'once',
				offsets: [{ dir: 'before', amount: 1, unit: 'day' }],
			});
			this.commit();
		});
	}

	private renderRow(el: HTMLElement, reminder: ReminderDef, index: number, names: readonly string[]): void {
		const row = el.createDiv({ cls: 'eb-pe-row eb-reminder-row' });
		const head = row.createDiv({ cls: 'eb-pe-head' });

		const comment = head.createEl('input', { type: 'text', cls: 'eb-pe-name' });
		comment.value = reminder.comment;
		comment.placeholder = t('reminder.editor.commentPlaceholder');
		comment.setAttr('aria-label', t('reminder.editor.comment'));
		// Live, like every other text field in this modal: Escape closes and saves.
		comment.addEventListener('input', () => {
			reminder.comment = comment.value.trim();
			this.onChange(this.value());
		});

		const property = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		property.setAttr('aria-label', t('reminder.editor.property'));
		// A name the board no longer declares stays selectable, flagged below.
		const options = names.includes(reminder.property) ? names : [...names, reminder.property];
		for (const name of options) property.createEl('option', { text: name }).value = name;
		property.value = reminder.property;
		property.addEventListener('change', () => {
			reminder.property = property.value;
			this.commit();
		});

		const repeat = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		repeat.setAttr('aria-label', t('reminder.editor.repeat'));
		for (const value of ['once', 'launch'] as const) {
			repeat.createEl('option', { text: t(`reminder.editor.repeatOption.${value}`) }).value = value;
		}
		repeat.value = reminder.repeat;
		repeat.addEventListener('change', () => {
			reminder.repeat = repeat.value as ReminderRepeat;
			// A `launch` reminder that never ends would follow a card forever, so a
			// new one starts with "Checkbox is set" (§4.1).
			if (reminder.repeat === 'launch' && !reminder.endFilter) reminder.endFilter = doneFilter();
			this.commit();
		});

		const remove = head.createEl('button', { cls: 'eb-pe-button', text: '✕' });
		remove.setAttribute('aria-label', t('reminder.editor.remove'));
		remove.title = t('reminder.editor.remove');
		remove.addEventListener('click', () => {
			this.reminders.splice(index, 1);
			this.commit();
		});

		const body = row.createDiv({ cls: 'eb-pe-body' });
		this.renderOffsets(body, reminder);

		const buttons = body.createDiv({ cls: 'eb-pe-option' });
		definitionFilterButton(this.app, buttons, this.options, {
			label: t('reminder.editor.filter'),
			tabs: 'filters',
			filter: reminder.filter,
			onApply: (filter) => {
				if (filter) reminder.filter = filter;
				else delete reminder.filter;
				this.commit();
			},
		});
		if (reminder.repeat === 'launch') {
			definitionFilterButton(this.app, buttons, this.options, {
				label: t('reminder.editor.endFilter'),
				tabs: 'filters',
				filter: reminder.endFilter,
				onApply: (filter) => {
					if (filter) reminder.endFilter = filter;
					else delete reminder.endFilter;
					this.commit();
				},
			});
		}
		definitionFilterButton(this.app, buttons, this.options, {
			label: t('reminder.editor.sort'),
			tabs: 'sorts',
			sorts: reminder.sorts,
			onApply: (_filter, sorts) => {
				if (sorts) reminder.sorts = sorts;
				else delete reminder.sorts;
				this.commit();
			},
		});

		if (!names.includes(reminder.property)) {
			row.createDiv({
				cls: 'eb-pe-diags',
				text: t('reminder.editor.unknownProperty', { name: reminder.property }),
			});
		}
	}

	/** "N units before / after", any number of them; none = at the date. */
	private renderOffsets(body: HTMLElement, reminder: ReminderDef): void {
		if (!reminder.offsets.length) {
			body.createDiv({ cls: 'eb-pe-empty', text: t('reminder.editor.atDate') });
		}
		reminder.offsets.forEach((offset, index) => {
			const line = body.createDiv({ cls: 'eb-pe-option' });
			const amount = line.createEl('input', { type: 'number', cls: 'eb-dh-amount' });
			amount.value = String(offset.amount);
			amount.min = '0';
			amount.step = '1';
			amount.setAttr('aria-label', t('dateHighlights.amount'));
			amount.addEventListener('change', () => {
				const next = Number.parseInt(amount.value, 10);
				if (Number.isInteger(next) && next >= 0) offset.amount = next;
				this.commit();
			});
			const unit = line.createEl('select', { cls: 'dropdown eb-pe-type' });
			for (const value of REMINDER_UNITS) {
				unit.createEl('option', { text: t(`reminder.editor.unit.${value}`) }).value = value;
			}
			unit.value = offset.unit;
			unit.addEventListener('change', () => {
				offset.unit = unit.value as ReminderUnit;
				this.commit();
			});
			const dir = line.createEl('select', { cls: 'dropdown eb-pe-type' });
			for (const value of ['before', 'after'] as const) {
				dir.createEl('option', { text: t(`reminder.editor.dir.${value}`) }).value = value;
			}
			dir.value = offset.dir;
			dir.addEventListener('change', () => {
				offset.dir = dir.value === 'before' ? 'before' : 'after';
				this.commit();
			});
			const remove = line.createEl('button', { cls: 'eb-pe-button', text: '✕' });
			remove.setAttribute('aria-label', t('reminder.editor.removeOffset'));
			remove.addEventListener('click', () => {
				reminder.offsets.splice(index, 1);
				this.commit();
			});
		});
		const add = body.createDiv({ cls: 'eb-pe-actions eb-reminder-add-offset' }).createEl('button', {
			text: t('reminder.editor.addOffset'),
		});
		add.addEventListener('click', () => {
			reminder.offsets.push({ dir: 'before', amount: 1, unit: 'day' });
			this.commit();
		});
	}

	private value(): ReminderDef[] | undefined {
		return this.reminders.length ? cloneJson(this.reminders) : undefined;
	}

	private commit(): void {
		this.onChange(this.value());
		this.render();
	}
}
