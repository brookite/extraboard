// Reusable editor for a list of property definitions. Shared by the board
// settings modal (per-board `extraboard.properties`) and the plugin settings
// tab (`defaultProperties`). Specs: properties.md, settings.md.

import { App } from 'obsidian';
import { validatePropertyDefs, type PropertyDiagnostic } from '../model/properties';
import type { PropertyDef, PropertyType, StringListOption } from '../model/types';
import { colorField } from './ColorPicker';
import { t } from '../i18n';

function describePropertyDiagnostic(diag: PropertyDiagnostic): string {
	switch (diag.kind) {
		case 'noName':
			return t('propertyDefs.diagnostic.noName');
		case 'duplicateName':
			return t('propertyDefs.diagnostic.duplicateName', { name: diag.name });
		case 'strictOptionsWrongType':
			return t('propertyDefs.diagnostic.strictOptionsWrongType', { name: diag.name });
		case 'timeWrongType':
			return t('propertyDefs.diagnostic.timeWrongType', { name: diag.name });
		case 'tooManyColors':
			return t('propertyDefs.diagnostic.tooManyColors');
	}
}

export function typeLabels(): Record<PropertyType, string> {
	return {
		string: t('propertyDefs.type.string'),
		'string-list': t('propertyDefs.type.stringList'),
		integer: t('propertyDefs.type.integer'),
		percent: t('propertyDefs.type.percent'),
		checkbox: t('propertyDefs.type.checkbox'),
		color: t('propertyDefs.type.color'),
		datetime: t('propertyDefs.type.datetime'),
		'date-range': t('propertyDefs.type.dateRange'),
		recurrence: t('propertyDefs.type.recurrence'),
		'date-list': t('propertyDefs.type.dateList'),
	};
}

function timeLabels(): Record<'none' | 'optional' | 'required', string> {
	return {
		none: t('propertyDefs.time.none'),
		optional: t('propertyDefs.time.optional'),
		required: t('propertyDefs.time.required'),
	};
}

/** Deep copy so the editor never mutates the caller's definitions in place. */
export function cloneDefs(defs: PropertyDef[]): PropertyDef[] {
	return defs.map((d) => ({
		...d,
		...(d.options && { options: d.options.map((o) => ({ ...o })) }),
	}));
}

/** Types drawn as a badge, and so the ones an accent outline can apply to. */
function isAccentable(type: PropertyType): boolean {
	return type !== 'color' && type !== 'percent';
}

function uniqueName(defs: PropertyDef[]): string {
	let i = 1;
	let name = 'property';
	while (defs.some((d) => d.name === name)) name = `property ${String(++i)}`;
	return name;
}

export class PropertyDefsEditor {
	private defs: PropertyDef[];

	constructor(
		private readonly app: App,
		private readonly container: HTMLElement,
		defs: PropertyDef[],
		private readonly onChange: (defs: PropertyDef[]) => void,
	) {
		this.defs = cloneDefs(defs);
	}

	/** Current definitions, with unnamed entries dropped. */
	value(): PropertyDef[] {
		return cloneDefs(this.defs.filter((d) => d.name.trim() !== ''));
	}

	render(): void {
		const el = this.container;
		el.empty();
		el.addClass('eb-pe');

		if (this.defs.length === 0) {
			el.createDiv({ cls: 'eb-pe-empty', text: t('propertyDefs.empty') });
		}
		this.defs.forEach((def, index) => {
			this.renderDef(el.createDiv({ cls: 'eb-pe-row' }), def, index);
		});

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: t('propertyDefs.addProperty') });
		add.addEventListener('click', () => {
			this.defs.push({ name: uniqueName(this.defs), type: 'string' });
			this.commit();
		});

		this.renderDiagnostics(el);
	}

	// --- rows -----------------------------------------------------------------

	private renderDef(row: HTMLElement, def: PropertyDef, index: number): void {
		const head = row.createDiv({ cls: 'eb-pe-head' });

		const name = head.createEl('input', { type: 'text', cls: 'eb-pe-name' });
		name.value = def.name;
		name.placeholder = t('propertyDefs.name');
		name.addEventListener('change', () => {
			def.name = name.value.trim();
			this.commit();
		});

		const type = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		for (const [value, label] of Object.entries(typeLabels())) {
			const option = type.createEl('option', { text: label });
			option.value = value;
		}
		type.value = def.type;
		type.addEventListener('change', () => {
			def.type = type.value as PropertyType;
			// Keep the definition well-formed: sub-options belong to one type only.
			if (def.type !== 'string-list') {
				delete def.strict;
				delete def.options;
			}
			if (def.type !== 'datetime' && def.type !== 'date-list') delete def.time;
			// `color` paints the card and `percent` draws a progress indicator;
			// neither has a badge to outline (properties.md §accent).
			if (!isAccentable(def.type)) delete def.accent;
			this.commit();
		});

		this.iconButton(head, '↑', t('propertyDefs.moveUp'), index > 0, () => {
			this.defs.splice(index - 1, 0, ...this.defs.splice(index, 1));
			this.commit();
		});
		this.iconButton(head, '↓', t('propertyDefs.moveDown'), index < this.defs.length - 1, () => {
			this.defs.splice(index + 1, 0, ...this.defs.splice(index, 1));
			this.commit();
		});
		this.iconButton(head, '✕', t('propertyDefs.removeProperty'), true, () => {
			this.defs.splice(index, 1);
			this.commit();
		});

		if (def.type === 'string-list') this.renderListOptions(row, def);
		if (def.type === 'datetime' || def.type === 'date-list') this.renderTimeMode(row, def);
		if (isAccentable(def.type)) this.renderAccent(row, def);
	}

	/**
	 * The property's badge accent. Its own row under the definition, wrapping
	 * like every other one, so a narrow settings pane on mobile stacks the label
	 * above the control instead of squeezing it.
	 */
	private renderAccent(row: HTMLElement, def: PropertyDef): void {
		const body = row.createDiv({ cls: 'eb-pe-body eb-pe-accent' });
		body.createSpan({ cls: 'eb-pe-label', text: t('propertyDefs.accent.label') });
		colorField(this.app, body, t('propertyDefs.accent.field'), def.accent, (next) => {
			if (next) def.accent = next;
			else delete def.accent;
			this.commit();
		});
	}

	private renderTimeMode(row: HTMLElement, def: PropertyDef): void {
		const body = row.createDiv({ cls: 'eb-pe-body' });
		body.createSpan({ cls: 'eb-pe-label', text: t('propertyDefs.time.label') });
		const select = body.createEl('select', { cls: 'dropdown' });
		for (const [value, label] of Object.entries(timeLabels())) {
			const option = select.createEl('option', { text: label });
			option.value = value;
		}
		select.value = def.time ?? 'optional';
		select.addEventListener('change', () => {
			def.time = select.value as 'none' | 'optional' | 'required';
			this.commit();
		});
	}

	private renderListOptions(row: HTMLElement, def: PropertyDef): void {
		const body = row.createDiv({ cls: 'eb-pe-body' });

		const strictLabel = body.createEl('label', { cls: 'eb-pe-check' });
		const strict = strictLabel.createEl('input', { type: 'checkbox' });
		strict.checked = def.strict === true;
		strictLabel.createSpan({ text: t('propertyDefs.strictOnly') });
		strict.addEventListener('change', () => {
			if (strict.checked) def.strict = true;
			else delete def.strict;
			this.commit();
		});

		const options = def.options ?? [];
		for (const [i, option] of options.entries()) {
			this.renderOption(body.createDiv({ cls: 'eb-pe-option' }), def, option, i);
		}

		const add = body.createEl('button', { cls: 'eb-pe-add-value', text: t('propertyDefs.addValue') });
		add.addEventListener('click', () => {
			def.options = [...options, { value: '' }];
			this.commit();
		});
	}

	private renderOption(
		el: HTMLElement,
		def: PropertyDef,
		option: StringListOption,
		index: number,
	): void {
		const value = el.createEl('input', { type: 'text', cls: 'eb-pe-value' });
		value.value = option.value;
		value.placeholder = t('propertyDefs.value');
		value.addEventListener('change', () => {
			option.value = value.value.trim();
			this.commit();
		});

		colorField(this.app, el, t('propertyDefs.background'), option.bg, (next) => {
			if (next) option.bg = next;
			else delete option.bg;
			this.commit();
		});
		colorField(this.app, el, t('propertyDefs.text'), option.fg, (next) => {
			if (next) option.fg = next;
			else delete option.fg;
			this.commit();
		});

		this.iconButton(el, '✕', t('propertyDefs.removeValue'), true, () => {
			def.options = (def.options ?? []).filter((_, i) => i !== index);
			this.commit();
		});
	}

	// --- small controls -------------------------------------------------------

	private iconButton(
		el: HTMLElement,
		glyph: string,
		label: string,
		enabled: boolean,
		onClick: () => void,
	): void {
		const button = el.createEl('button', { cls: 'eb-pe-button', text: glyph });
		button.setAttribute('aria-label', label);
		button.title = label;
		button.disabled = !enabled;
		button.addEventListener('click', onClick);
	}

	private renderDiagnostics(el: HTMLElement): void {
		const diags = validatePropertyDefs(this.defs);
		if (diags.length === 0) return;
		const list = el.createDiv({ cls: 'eb-pe-diags' });
		for (const d of diags) list.createDiv({ text: describePropertyDiagnostic(d) });
	}

	private commit(): void {
		this.onChange(this.value());
		this.render();
	}
}
