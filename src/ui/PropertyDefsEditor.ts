// Reusable editor for a list of property definitions. Shared by the board
// settings modal (per-board `extraboard.properties`) and the plugin settings
// tab (`defaultProperties`). Specs: properties.md, settings.md.

import { App } from 'obsidian';
import { validatePropertyDefs } from '../model/properties';
import type { PropertyDef, PropertyType, StringListOption } from '../model/types';
import { colorField } from './ColorPicker';

const TYPE_LABELS: Record<PropertyType, string> = {
	string: 'Text',
	'string-list': 'List of values',
	integer: 'Number',
	percent: 'Percent',
	checkbox: 'Checkbox',
	color: 'Card color',
	datetime: 'Date',
	'date-range': 'Date range',
	recurrence: 'Recurrence',
	'date-list': 'List of dates',
};

const TIME_LABELS: Record<'none' | 'optional' | 'required', string> = {
	none: 'Date only',
	optional: 'Time optional',
	required: 'Time required',
};

/** Deep copy so the editor never mutates the caller's definitions in place. */
export function cloneDefs(defs: PropertyDef[]): PropertyDef[] {
	return defs.map((d) => ({
		...d,
		...(d.options && { options: d.options.map((o) => ({ ...o })) }),
	}));
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
			el.createDiv({ cls: 'eb-pe-empty', text: 'No properties yet.' });
		}
		this.defs.forEach((def, index) => {
			this.renderDef(el.createDiv({ cls: 'eb-pe-row' }), def, index);
		});

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: 'Add property' });
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
		name.placeholder = 'Name';
		name.addEventListener('change', () => {
			def.name = name.value.trim();
			this.commit();
		});

		const type = head.createEl('select', { cls: 'dropdown eb-pe-type' });
		for (const [value, label] of Object.entries(TYPE_LABELS)) {
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
			if (def.type !== 'datetime') delete def.time;
			this.commit();
		});

		this.iconButton(head, '↑', 'Move up', index > 0, () => {
			this.defs.splice(index - 1, 0, ...this.defs.splice(index, 1));
			this.commit();
		});
		this.iconButton(head, '↓', 'Move down', index < this.defs.length - 1, () => {
			this.defs.splice(index + 1, 0, ...this.defs.splice(index, 1));
			this.commit();
		});
		this.iconButton(head, '✕', 'Remove property', true, () => {
			this.defs.splice(index, 1);
			this.commit();
		});

		if (def.type === 'string-list') this.renderListOptions(row, def);
		if (def.type === 'datetime') this.renderTimeMode(row, def);
	}

	private renderTimeMode(row: HTMLElement, def: PropertyDef): void {
		const body = row.createDiv({ cls: 'eb-pe-body' });
		body.createSpan({ cls: 'eb-pe-label', text: 'Time' });
		const select = body.createEl('select', { cls: 'dropdown' });
		for (const [value, label] of Object.entries(TIME_LABELS)) {
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
		strictLabel.createSpan({ text: 'Only allow the values below' });
		strict.addEventListener('change', () => {
			if (strict.checked) def.strict = true;
			else delete def.strict;
			this.commit();
		});

		const options = def.options ?? [];
		for (const [i, option] of options.entries()) {
			this.renderOption(body.createDiv({ cls: 'eb-pe-option' }), def, option, i);
		}

		const add = body.createEl('button', { cls: 'eb-pe-add-value', text: 'Add value' });
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
		value.placeholder = 'Value';
		value.addEventListener('change', () => {
			option.value = value.value.trim();
			this.commit();
		});

		colorField(this.app, el, 'Background', option.bg, (next) => {
			if (next) option.bg = next;
			else delete option.bg;
			this.commit();
		});
		colorField(this.app, el, 'Text', option.fg, (next) => {
			if (next) option.fg = next;
			else delete option.fg;
			this.commit();
		});

		this.iconButton(el, '✕', 'Remove value', true, () => {
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
		for (const d of diags) list.createDiv({ text: d });
	}

	private commit(): void {
		this.onChange(this.value());
		this.render();
	}
}
