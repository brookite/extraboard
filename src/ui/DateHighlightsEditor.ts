// Reusable editor for a list of date highlight rules. Shared by the plugin
// settings tab (the global list) and the board settings modal (a board's own
// list). Spec: docs/specs/i18n-and-dates.md §3.3.
//
// The rows are dragged rather than nudged with arrows, because their order is
// the user's own escalation and the first match wins (§3.1).

import { App, setIcon } from 'obsidian';
import Sortable from 'sortablejs';
import {
	cloneRules,
	isDateFamily,
	validateDateHighlights,
	type DateHighlightDiagnostic,
	type DateHighlightRule,
	type HighlightUnit,
	type HighlightWhen,
} from '../model/dateHighlights';
import type { PropertyDef } from '../model/types';
import { colorField } from './ColorPicker';
import { t } from '../i18n';

/** Color a freshly added rule starts with, so it does something immediately. */
const NEW_RULE_COLOR = '#e0ac00';

function describeDiagnostic(diag: DateHighlightDiagnostic): string {
	// Rules are numbered from 1 in the UI, as the user sees them.
	const index = diag.index + 1;
	switch (diag.kind) {
		case 'noColor':
			return t('dateHighlights.diagnostic.noColor', { index });
		case 'badAmount':
			return t('dateHighlights.diagnostic.badAmount', { index });
		case 'unknownProperty':
			return t('dateHighlights.diagnostic.unknownProperty', { index, name: diag.name });
	}
}

function whenLabels(): Record<HighlightWhen, string> {
	return {
		before: t('dateHighlights.when.before'),
		after: t('dateHighlights.when.after'),
	};
}

function unitLabels(): Record<HighlightUnit, string> {
	return {
		hour: t('dateHighlights.unit.hour'),
		day: t('dateHighlights.unit.day'),
		week: t('dateHighlights.unit.week'),
		month: t('dateHighlights.unit.month'),
	};
}

export interface DateHighlightsEditorOptions {
	/**
	 * The declared properties a rule can name, read afresh on every render: the
	 * board settings modal edits its property list in the same dialog. Omitted by
	 * the plugin-wide list, which cannot know which board a rule will meet — there
	 * the property is typed in and never flagged as unknown.
	 */
	properties?: () => readonly PropertyDef[];
}

export class DateHighlightsEditor {
	private rules: DateHighlightRule[];
	private sortable: Sortable | null = null;

	constructor(
		private readonly app: App,
		private readonly container: HTMLElement,
		rules: readonly DateHighlightRule[],
		private readonly onChange: (rules: DateHighlightRule[]) => void,
		private readonly options: DateHighlightsEditorOptions = {},
	) {
		this.rules = cloneRules(rules);
	}

	/** The current rules; an empty list is a meaningful value, not "nothing" (§3.2). */
	value(): DateHighlightRule[] {
		return cloneRules(this.rules);
	}

	render(): void {
		// Sortable holds the row elements it was built over, so the instance dies
		// with them (`ChecklistModal` does the same on close).
		this.sortable?.destroy();
		this.sortable = null;

		const el = this.container;
		el.empty();
		el.addClass('eb-pe');

		if (this.rules.length === 0) {
			el.createDiv({ cls: 'eb-pe-empty', text: t('dateHighlights.empty') });
		}

		const names = this.dateProperties();
		const diags = validateDateHighlights(
			this.rules,
			this.options.properties ? names : undefined,
		);
		const list = el.createDiv({ cls: 'eb-dh-list' });
		this.rules.forEach((rule, index) => {
			const row = list.createDiv({ cls: 'eb-pe-row' });
			row.dataset.index = String(index);
			this.renderRule(row, rule, index, names);
			// Diagnostics sit next to the row they are about (§3.3).
			const own = diags.filter((d) => d.index === index);
			if (own.length) {
				const box = row.createDiv({ cls: 'eb-pe-diags' });
				for (const d of own) box.createDiv({ text: describeDiagnostic(d) });
			}
		});
		this.enableDrag(list);

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: t('dateHighlights.addRule') });
		add.addEventListener('click', () => {
			// Appended at the end: a newly added rule is the wider net until the
			// user drags it up (§3.3).
			this.rules.push({ when: 'before', amount: 1, unit: 'day', color: NEW_RULE_COLOR });
			this.commit();
		});

		if (this.rules.length > 1) {
			el.createDiv({ cls: 'eb-pe-empty eb-dh-hint', text: t('dateHighlights.orderHint') });
		}
	}

	/** Date-family names of the declared properties; empty when none are known. */
	private dateProperties(): string[] {
		const defs = this.options.properties?.() ?? [];
		return defs.filter((d) => isDateFamily(d.type)).map((d) => d.name);
	}

	// --- rows -----------------------------------------------------------------

	private renderRule(
		row: HTMLElement,
		rule: DateHighlightRule,
		index: number,
		names: readonly string[],
	): void {
		const head = row.createDiv({ cls: 'eb-pe-head' });

		const grip = head.createSpan({ cls: 'eb-checklist-grip eb-dh-grip' });
		setIcon(grip, 'grip-vertical');
		grip.setAttr('aria-hidden', 'true');
		grip.setAttr('title', t('dateHighlights.dragToReorder'));

		this.renderProperty(head, rule, names);

		const when = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		for (const [value, label] of Object.entries(whenLabels())) {
			when.createEl('option', { text: label }).value = value;
		}
		when.value = rule.when;
		when.setAttr('aria-label', t('dateHighlights.when.label'));
		when.addEventListener('change', () => {
			rule.when = when.value as HighlightWhen;
			this.commit();
		});

		const amount = head.createEl('input', { type: 'number', cls: 'eb-dh-amount' });
		amount.value = String(rule.amount);
		amount.min = '0';
		amount.step = '1';
		amount.setAttr('aria-label', t('dateHighlights.amount'));
		amount.addEventListener('change', () => {
			const next = Number.parseInt(amount.value, 10);
			// Anything else is not stored at all: re-rendering snaps the field back
			// to the value the rule still holds.
			if (Number.isInteger(next) && next >= 0) rule.amount = next;
			this.commit();
		});

		const unit = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		for (const [value, label] of Object.entries(unitLabels())) {
			unit.createEl('option', { text: label }).value = value;
		}
		unit.value = rule.unit;
		unit.setAttr('aria-label', t('dateHighlights.unit.label'));
		unit.addEventListener('change', () => {
			rule.unit = unit.value as HighlightUnit;
			this.commit();
		});

		colorField(this.app, head, t('dateHighlights.color'), rule.color, (next) => {
			rule.color = next;
			this.commit();
		});

		const remove = head.createEl('button', { cls: 'eb-pe-button', text: '✕' });
		remove.setAttribute('aria-label', t('dateHighlights.removeRule'));
		remove.title = t('dateHighlights.removeRule');
		remove.addEventListener('click', () => {
			this.rules.splice(index, 1);
			this.commit();
		});
	}

	/**
	 * The property a rule applies to: a picker over the board's declared
	 * date-family properties, or a plain field when no list is known.
	 */
	private renderProperty(
		head: HTMLElement,
		rule: DateHighlightRule,
		names: readonly string[],
	): void {
		if (!this.options.properties) {
			const input = head.createEl('input', { type: 'text', cls: 'eb-pe-name' });
			input.value = rule.property ?? '';
			input.placeholder = t('dateHighlights.anyProperty');
			input.setAttr('aria-label', t('dateHighlights.property'));
			input.addEventListener('change', () => {
				const name = input.value.trim();
				if (name) rule.property = name;
				else delete rule.property;
				this.commit();
			});
			return;
		}

		const select = head.createEl('select', { cls: 'dropdown eb-pe-name' });
		select.createEl('option', { text: t('dateHighlights.anyProperty') }).value = '';
		// A name the board no longer declares stays selectable, so opening the
		// dialog does not quietly retarget the rule; it is flagged instead.
		const options = rule.property && !names.includes(rule.property)
			? [...names, rule.property]
			: names;
		for (const name of options) {
			select.createEl('option', { text: name }).value = name;
		}
		select.value = rule.property ?? '';
		select.setAttr('aria-label', t('dateHighlights.property'));
		select.addEventListener('change', () => {
			if (select.value) rule.property = select.value;
			else delete rule.property;
			this.commit();
		});
	}

	// --- drag & drop ----------------------------------------------------------

	/** Flat list, so a drop is a plain splice; `render` rebuilds the rows. */
	private enableDrag(list: HTMLElement): void {
		this.sortable = Sortable.create(list, {
			animation: 150,
			handle: '.eb-dh-grip',
			draggable: '.eb-pe-row',
			ghostClass: 'eb-drag-ghost',
			dragClass: 'eb-drag-item',
			fallbackOnBody: true,
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
				// The DOM already shows the dropped order, so the move is applied and
				// re-rendered one tick later: `render` destroys this very Sortable
				// instance, which must not happen inside its own event handler.
				window.setTimeout(() => {
					this.rules.splice(newIndex, 0, ...this.rules.splice(oldIndex, 1));
					this.commit();
				}, 0);
			},
		});
	}

	private commit(): void {
		this.onChange(this.value());
		this.render();
	}
}
