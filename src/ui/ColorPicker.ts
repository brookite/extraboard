// Shared color picker: card colors (card menu) and badge colors (property /
// tag editors) both go through it.
//
// A color is stored verbatim — any CSS color, including theme variables — so
// the palette is the primary control and free-form text stays available. The
// native `<input type="color">` is offered as an extra rather than the only way
// in: it cannot express anything but `#rrggbb`, and on mobile it hands over to
// the platform picker, which not every device provides.

import { App, Modal } from 'obsidian';
import { resolveColor, safeColor, withAlpha } from '../util/color';
import { t } from '../i18n';
import { keyboardAwareModal } from './keyboardInset';

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

	// The control keeps itself current, so it can live in a form that is not
	// re-rendered on every change (the stack modal) as well as in one that is.
	const set = (next: string): void => {
		input.value = next;
		swatch.style.background = safeColor(next) ?? 'transparent';
		onChange(next);
	};

	input.addEventListener('change', () => set(input.value.trim()));

	swatch.addEventListener('click', () => {
		void pickColor(app, {
			title: t('colorPicker.colorForTitle', { label }),
			value: input.value,
			clearLabel: t('colorPicker.noColor'),
		}).then((next) => {
			if (next !== null) set(next);
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
	private alphaEl!: HTMLInputElement;
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
		keyboardAwareModal(this);
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
					this.select(withAlpha(color, this.alpha()));
				});
				this.swatches.set(color, swatch);
			}
		}

		const custom = el.createDiv({ cls: 'eb-cp-custom' });
		this.nativeEl = custom.createEl('input', { type: 'color', cls: 'eb-cp-native' });
		this.nativeEl.setAttribute('aria-label', t('colorPicker.pickCustomColor'));
		// Hue and opacity are independent: changing one keeps the other, so
		// "pick a color, then fade it" works in either order.
		this.nativeEl.addEventListener('input', () => {
			this.select(withAlpha(this.nativeEl.value, this.alpha()));
		});
		// Opacity is a second axis rather than a second picker: `<input
		// type="color">` cannot express alpha on any platform we support, and a
		// hand-rolled saturation/alpha canvas would be a large touch-hostile
		// control for one number. The slider composes `#rrggbbaa` out of what the
		// native input already gives us.
		this.alphaEl = custom.createEl('input', { type: 'range', cls: 'eb-cp-alpha' });
		this.alphaEl.min = '0';
		this.alphaEl.max = '100';
		this.alphaEl.step = '1';
		this.alphaEl.setAttribute('aria-label', t('colorPicker.opacity'));
		this.alphaEl.addEventListener('input', () => {
			const base = resolveColor(this.value, this.contentEl);
			if (!base) return;
			this.select(withAlpha(base.hex, Number(this.alphaEl.value) / 100));
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

	/** The opacity currently in force; `1` while there is no color to read one from. */
	private alpha(): number {
		return resolveColor(this.value, this.contentEl)?.alpha ?? 1;
	}

	private sync(fromText: boolean): void {
		const safe = safeColor(this.value);
		// `backgroundColor`, not the `background` shorthand: the checkerboard
		// behind a translucent swatch is a `background-image`, and the shorthand
		// would wipe it out.
		this.previewEl.style.backgroundColor = safe ?? 'transparent';
		this.previewEl.classList.toggle('is-empty', safe === null);
		this.labelEl.setText(
			this.value === ''
				? t('colorPicker.noColor')
				: safe === null
					? t('colorPicker.notAColor', { value: this.value })
					: this.value,
		);
		if (!fromText) this.textEl.value = this.value;

		const resolved = resolveColor(this.value, this.contentEl);
		if (resolved) this.nativeEl.value = resolved.hex;
		this.alphaEl.value = String(Math.round((resolved?.alpha ?? 1) * 100));
		// A value the slider cannot recompose without destroying it — `var(--x)`
		// resolves to a color, but writing hex back would freeze the theme
		// variable into a literal. Only what is already hex or `rgb()` is fadeable.
		this.alphaEl.disabled = resolved === null || !/^(#|rgba?\()/i.test(this.value.trim());
		// Compared on the resolved hue, so a faded color still marks its swatch.
		for (const [color, swatch] of this.swatches) {
			swatch.classList.toggle('is-selected', color === resolved?.hex);
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
