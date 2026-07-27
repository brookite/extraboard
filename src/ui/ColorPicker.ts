// Shared color picker: card colors (card menu) and badge colors (property /
// tag editors) both go through it.
//
// A color is stored verbatim — any CSS color, including theme variables — so
// the palette is the primary control and free-form text stays available. The
// native `<input type="color">` is offered as an extra rather than the only way
// in: it cannot express anything but `#rrggbb`, and on mobile it hands over to
// the platform picker, which not every device provides.

import { App, Modal } from 'obsidian';
import { safeColor, toHexColor } from '../util/color';
import { t } from '../i18n';

/** Preset palette: Obsidian's accent hues, soft variants, and neutrals. */
const PALETTE: string[][] = [
	['#e93147', '#ec7500', '#e0ac00', '#08b94e', '#00bfbc', '#086ddd', '#7852ee', '#d53984'],
	['#f5a3ad', '#f7c08a', '#efdc9a', '#93e0b4', '#9adedd', '#a6c8f5', '#c6b6f7', '#eeaacb'],
	['#ffffff', '#c8c8c8', '#8a8a8a', '#4d4d4d'],
];

export interface ColorPickerOptions {
	title?: string;
	/** Color to start from; anything the browser accepts. */
	value?: string;
	/** Label of the "remove the color" action. Omitted => no such action. */
	clearLabel?: string;
}

/**
 * Open the picker. Resolves to the chosen color, to `''` when the user cleared
 * it, or to `null` when the modal was dismissed (nothing should change then).
 */
export function pickColor(app: App, options: ColorPickerOptions = {}): Promise<string | null> {
	return new Promise((resolve) => {
		new ColorPickerModal(app, options, resolve).open();
	});
}

/**
 * A labelled color control for the settings editors: a swatch that opens the
 * picker, plus the raw text field, so a value the palette cannot express can
 * still be typed. `onChange` receives `''` for "no color".
 */
export function colorField(
	app: App,
	el: HTMLElement,
	label: string,
	value: string | undefined,
	onChange: (value: string) => void,
): void {
	const wrap = el.createDiv({ cls: 'eb-pe-color' });

	const swatch = wrap.createEl('button', { cls: 'eb-swatch eb-swatch-button' });
	swatch.type = 'button';
	swatch.style.background = safeColor(value) ?? 'transparent';
	const chooseLabel = t('colorPicker.chooseColorFor', { label: label.toLowerCase() });
	swatch.setAttribute('aria-label', chooseLabel);
	swatch.title = chooseLabel;

	const input = wrap.createEl('input', { type: 'text', cls: 'eb-pe-color-input' });
	input.value = value ?? '';
	input.placeholder = label;
	input.setAttribute('aria-label', label);
	input.addEventListener('change', () => onChange(input.value.trim()));

	swatch.addEventListener('click', () => {
		void pickColor(app, {
			title: t('colorPicker.colorForTitle', { label }),
			value: input.value,
			clearLabel: t('colorPicker.noColor'),
		}).then((next) => {
			if (next !== null) onChange(next);
		});
	});
}

class ColorPickerModal extends Modal {
	private value: string;
	private resolved = false;
	private swatches = new Map<string, HTMLElement>();
	private previewEl!: HTMLElement;
	private labelEl!: HTMLElement;
	private textEl!: HTMLInputElement;
	private nativeEl!: HTMLInputElement;
	private ctaEl!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly options: ColorPickerOptions,
		private readonly done: (value: string | null) => void,
	) {
		super(app);
		this.value = options.value?.trim() ?? '';
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title ?? t('colorPicker.defaultTitle'));
		this.modalEl.addClass('eb-cp-modal');
		const el = this.contentEl;
		el.empty();
		el.addClass('eb-cp');

		const preview = el.createDiv({ cls: 'eb-cp-preview' });
		this.previewEl = preview.createDiv({ cls: 'eb-cp-preview-swatch' });
		this.labelEl = preview.createSpan({ cls: 'eb-cp-preview-label' });

		for (const row of PALETTE) {
			const rowEl = el.createDiv({ cls: 'eb-cp-row' });
			for (const color of row) {
				const swatch = rowEl.createEl('button', { cls: 'eb-cp-swatch' });
				swatch.type = 'button';
				swatch.style.background = color;
				swatch.setAttribute('aria-label', color);
				swatch.title = color;
				swatch.addEventListener('click', () => {
					this.select(color);
				});
				this.swatches.set(color, swatch);
			}
		}

		const custom = el.createDiv({ cls: 'eb-cp-custom' });
		this.nativeEl = custom.createEl('input', { type: 'color', cls: 'eb-cp-native' });
		this.nativeEl.setAttribute('aria-label', t('colorPicker.pickCustomColor'));
		this.nativeEl.addEventListener('input', () => {
			this.select(this.nativeEl.value);
		});
		this.textEl = custom.createEl('input', { type: 'text', cls: 'eb-cp-text' });
		this.textEl.placeholder = t('colorPicker.anyCssValue');
		this.textEl.setAttribute('aria-label', t('colorPicker.customColorValue'));
		this.textEl.addEventListener('input', () => {
			this.select(this.textEl.value, true);
		});
		this.textEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || safeColor(this.value) === null) return;
			event.preventDefault();
			this.finish(this.value);
		});

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		if (this.options.clearLabel !== undefined) {
			const clear = buttons.createEl('button', { text: this.options.clearLabel });
			clear.addEventListener('click', () => {
				this.finish('');
			});
		}
		const cancel = buttons.createEl('button', { text: t('common.cancel') });
		cancel.addEventListener('click', () => {
			this.close();
		});
		this.ctaEl = buttons.createEl('button', { cls: 'mod-cta', text: t('colorPicker.select') });
		this.ctaEl.addEventListener('click', () => {
			this.finish(this.value);
		});

		this.sync(false);
	}

	override onClose(): void {
		this.contentEl.empty();
		// Dismissing the modal (Escape, click-away, Cancel) changes nothing.
		this.finish(null);
	}

	/** Adopt a color; `fromText` leaves the text field alone while it is typed in. */
	private select(value: string, fromText = false): void {
		this.value = value.trim();
		this.sync(fromText);
	}

	private sync(fromText: boolean): void {
		const safe = safeColor(this.value);
		this.previewEl.style.background = safe ?? 'transparent';
		this.previewEl.classList.toggle('is-empty', safe === null);
		this.labelEl.setText(
			this.value === ''
				? t('colorPicker.noColor')
				: safe === null
					? t('colorPicker.notAColor', { value: this.value })
					: this.value,
		);
		if (!fromText) this.textEl.value = this.value;

		const hex = toHexColor(this.value, this.contentEl);
		if (hex !== null) this.nativeEl.value = hex;
		for (const [color, swatch] of this.swatches) {
			swatch.classList.toggle('is-selected', color === safe?.toLowerCase());
		}
		this.ctaEl.disabled = safe === null;
	}

	private finish(value: string | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(value);
		if (value !== null) this.close();
	}
}
