// Board configuration modal. Reachable at any time from an open board (view
// header action + command), not only at creation: it rewrites the
// `extraboard-settings` block. Spec: kanban-view.md §5.4, markdown-format.md §2.

import { App, Modal, Setting, normalizePath } from 'obsidian';
import { invalidatedValues } from '../model/ops';
import type { BadgeColor, Board, BoardConfig, ProgressStyle, PropertyDef } from '../model/types';
import { colorField } from './ColorPicker';
import { PropertyDefsEditor, cloneDefs } from './PropertyDefsEditor';
import { DateHighlightsEditor } from './DateHighlightsEditor';
import { FolderSuggest } from './FolderSuggest';
import { cloneRules, type DateHighlightRule } from '../model/dateHighlights';
import { t } from '../i18n';

interface TagRow {
	tag: string;
	color: BadgeColor;
}

export interface BoardSettingsOptions {
	/** Configuration to edit. */
	config: BoardConfig;
	/**
	 * The board being configured. Omitted when a board is being created, where
	 * there is nothing yet to report impact against.
	 */
	board?: Board;
	title?: string;
	cta?: string;
	onSave: (config: BoardConfig) => void;
}

export class BoardSettingsModal extends Modal {
	private config: BoardConfig;
	private properties: PropertyDef[];
	private tags: TagRow[];
	private impactEl?: HTMLElement;
	/** The board's own highlight rules; `undefined` = follow the plugin (§3.2). */
	private highlights?: DateHighlightRule[];
	private highlightsEl?: HTMLElement;
	private highlightsEditor?: DateHighlightsEditor;

	constructor(
		app: App,
		private readonly options: BoardSettingsOptions,
	) {
		super(app);
		const config = options.config;
		this.config = { ...config };
		this.properties = cloneDefs(config.properties);
		this.highlights = config.dateHighlights ? cloneRules(config.dateHighlights) : undefined;
		this.tags = Object.entries(config.tagColors).map(([tag, color]) => ({
			tag,
			color: { ...color },
		}));
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title ?? t('modal.boardSettings.title'));
		this.modalEl.addClass('eb-board-settings');
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t('modal.boardSettings.showCardCheckbox.name'))
			.setDesc(t('modal.boardSettings.showCardCheckbox.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.config.showCardCheckbox === true).onChange((value) => {
					if (value) this.config.showCardCheckbox = true;
					else delete this.config.showCardCheckbox;
				}),
			);

		// Tri-state: a board may follow the plugin or override it, and "follow"
		// has to stay expressible — it is the default and the common case (§6.7).
		const addToSetting = (
			key: 'addToTopOther' | 'addToTopCompleting',
			name: string,
			desc: string,
		): void => {
			new Setting(contentEl)
				.setName(name)
				.setDesc(desc)
				.addDropdown((drop) =>
					drop
						.addOption('inherit', t('modal.boardSettings.addTo.inherit'))
						.addOption('top', t('settings.addTo.top'))
						.addOption('end', t('settings.addTo.end'))
						.setValue(
							this.config[key] === undefined ? 'inherit' : this.config[key] ? 'top' : 'end',
						)
						.onChange((value) => {
							if (value === 'inherit') delete this.config[key];
							else this.config[key] = value === 'top';
						}),
				);
		};

		addToSetting(
			'addToTopOther',
			t('modal.boardSettings.addToTopOther.name'),
			t('modal.boardSettings.addToTopOther.desc'),
		);
		addToSetting(
			'addToTopCompleting',
			t('modal.boardSettings.addToTopCompleting.name'),
			t('modal.boardSettings.addToTopCompleting.desc'),
		);

		new Setting(contentEl)
			.setName(t('modal.boardSettings.cardNoteFolder.name'))
			.setDesc(t('modal.boardSettings.cardNoteFolder.desc'))
			.addText((text) => {
				const save = (value: string) => {
					const dir = value.trim();
					if (dir) this.config.cardContentDir = normalizePath(dir);
					else delete this.config.cardContentDir;
				};
				text
					.setPlaceholder(t('modal.boardSettings.cardNoteFolder.placeholder'))
					.setValue(this.config.cardContentDir ?? '')
					.onChange(save);
				// A picked suggestion sets the input directly, so `onChange` never
				// fires for it; the callback carries the same write.
				new FolderSuggest(this.app, text.inputEl, save);
			});

		new Setting(contentEl)
			.setName(t('modal.boardSettings.progressStyle.name'))
			.setDesc(t('modal.boardSettings.progressStyle.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'': t('modal.boardSettings.progressStyle.followPlugin'),
						ring: t('settings.progressStyle.ring'),
						fraction: t('settings.progressStyle.fraction'),
						percent: t('settings.progressStyle.percent'),
					})
					.setValue(this.config.progressStyle ?? '')
					.onChange((value) => {
						if (value) this.config.progressStyle = value as ProgressStyle;
						else delete this.config.progressStyle;
					}),
			);

		new Setting(contentEl)
			.setName(t('modal.boardSettings.dateHighlights.name'))
			.setDesc(t('modal.boardSettings.dateHighlights.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						'': t('modal.boardSettings.dateHighlights.followPlugin'),
						own: t('modal.boardSettings.dateHighlights.own'),
					})
					.setValue(this.highlights ? 'own' : '')
					.onChange((value) => {
						// Switching back to "follow" keeps nothing: the board's key is
						// deleted on save, and the rules typed here are gone with it.
						this.highlights = value === 'own' ? (this.highlights ?? []) : undefined;
						this.renderHighlights();
					}),
			);
		this.highlightsEl = contentEl.createDiv();
		this.renderHighlights();

		new Setting(contentEl).setName(t('modal.boardSettings.properties.heading')).setHeading();
		contentEl.createDiv({
			cls: 'setting-item-description',
			text: t('modal.boardSettings.properties.desc'),
		});
		const propsEl = contentEl.createDiv();
		const editor = new PropertyDefsEditor(this.app, propsEl, this.properties, (defs) => {
			this.properties = defs;
			// The rule rows pick their property from this list, so they follow it.
			this.highlightsEditor?.render();
			this.renderImpact();
		});
		editor.render();

		new Setting(contentEl).setName(t('modal.boardSettings.tagColors.heading')).setHeading();
		const tagsEl = contentEl.createDiv();
		this.renderTags(tagsEl);

		this.impactEl = contentEl.createDiv({ cls: 'eb-pe-diags eb-impact' });
		this.renderImpact();

		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.options.cta ?? t('modal.boardSettings.save'))
					.setCta()
					.onClick(() => {
						this.options.onSave(this.nextConfig());
						this.close();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	// --- date highlights ------------------------------------------------------

	private renderHighlights(): void {
		const el = this.highlightsEl;
		if (!el) return;
		el.empty();
		el.removeClass('eb-pe');
		this.highlightsEditor = undefined;
		const rules = this.highlights;
		if (!rules) return;
		this.highlightsEditor = new DateHighlightsEditor(
			this.app,
			el,
			rules,
			(next) => {
				this.highlights = next;
			},
			{ properties: () => this.properties },
		);
		this.highlightsEditor.render();
	}

	// --- tag colors -----------------------------------------------------------

	private renderTags(el: HTMLElement): void {
		el.empty();
		el.addClass('eb-pe');
		if (this.tags.length === 0) {
			el.createDiv({ cls: 'eb-pe-empty', text: t('modal.boardSettings.tagColors.empty') });
		}

		this.tags.forEach((row, index) => {
			const line = el.createDiv({ cls: 'eb-pe-option' });
			const name = line.createEl('input', { type: 'text', cls: 'eb-pe-value' });
			name.value = row.tag;
			name.placeholder = t('modal.boardSettings.tagColors.namePlaceholder');
			name.addEventListener('change', () => {
				row.tag = name.value.trim().replace(/^#/, '');
			});
			colorField(this.app, line, t('propertyDefs.background'), row.color.bg, (value) => {
				if (value) row.color.bg = value;
				else delete row.color.bg;
				this.renderTags(el);
			});
			colorField(this.app, line, t('propertyDefs.text'), row.color.fg, (value) => {
				if (value) row.color.fg = value;
				else delete row.color.fg;
				this.renderTags(el);
			});
			const remove = line.createEl('button', { cls: 'eb-pe-button', text: '✕' });
			remove.setAttribute('aria-label', t('modal.boardSettings.tagColors.removeAria'));
			remove.addEventListener('click', () => {
				this.tags.splice(index, 1);
				this.renderTags(el);
			});
		});

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: t('modal.boardSettings.tagColors.addTagColor') });
		add.addEventListener('click', () => {
			this.tags.push({ tag: '', color: {} });
			this.renderTags(el);
		});
	}

	// --- result ---------------------------------------------------------------

	private nextConfig(): BoardConfig {
		const tagColors: Record<string, BadgeColor> = {};
		for (const row of this.tags) {
			if (!row.tag || (row.color.bg === undefined && row.color.fg === undefined)) continue;
			tagColors[row.tag] = { ...row.color };
		}
		const config: BoardConfig = { ...this.config, properties: cloneDefs(this.properties), tagColors };
		// An empty list is kept on purpose ("this board wants no highlights");
		// "follow the plugin" is the absence of the key (§3.2).
		if (this.highlights) config.dateHighlights = cloneRules(this.highlights);
		else delete config.dateHighlights;
		return config;
	}

	/**
	 * Values that a re-read of the file would drop under the new definitions.
	 * Reported, never applied: the card text stays as the user wrote it.
	 */
	private renderImpact(): void {
		const el = this.impactEl;
		const board = this.options.board;
		if (!el || !board) return;
		el.empty();
		const affected = invalidatedValues(board, this.nextConfig());
		if (affected.length === 0) return;
		const names = [...new Set(affected.map((a) => a.property))].join(', ');
		const text =
			affected.length === 1
				? t('modal.boardSettings.impactOne', { count: affected.length, names })
				: t('modal.boardSettings.impactMany', { count: affected.length, names });
		el.createDiv({ text });
	}
}
