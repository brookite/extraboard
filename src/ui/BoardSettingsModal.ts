// Board configuration modal. Reachable at any time from an open board (view
// header action + command), not only at creation: it rewrites the `extraboard`
// frontmatter node in place. Spec: kanban-view.md §5.4, markdown-format.md §2.

import { App, Modal, Setting } from 'obsidian';
import { invalidatedValues } from '../model/ops';
import type { BadgeColor, Board, BoardConfig, PropertyDef } from '../model/types';
import { colorField } from './ColorPicker';
import { PropertyDefsEditor, cloneDefs } from './PropertyDefsEditor';

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

	constructor(
		app: App,
		private readonly options: BoardSettingsOptions,
	) {
		super(app);
		const config = options.config;
		this.config = { ...config };
		this.properties = cloneDefs(config.properties);
		this.tags = Object.entries(config.tagColors).map(([tag, color]) => ({
			tag,
			color: { ...color },
		}));
	}

	override onOpen(): void {
		this.titleEl.setText(this.options.title ?? 'Board settings');
		this.modalEl.addClass('eb-board-settings');
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName('Show checkbox on cards')
			.setDesc(
				'Offer a task checkbox on cards that are not task list items yet. Cards that already are tasks always show one.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.config.showCardCheckbox === true).onChange((value) => {
					if (value) this.config.showCardCheckbox = true;
					else delete this.config.showCardCheckbox;
				}),
			);

		new Setting(contentEl)
			.setName('Card note folder')
			.setDesc(
				'Where this board creates card notes. Empty uses the folder from plugin settings, which defaults to the vault root.',
			)
			.addText((text) =>
				text
					.setPlaceholder('Cards')
					.setValue(this.config.cardContentDir ?? '')
					.onChange((value) => {
						const dir = value.trim();
						if (dir) this.config.cardContentDir = dir;
						else delete this.config.cardContentDir;
					}),
			);

		new Setting(contentEl).setName('Properties').setHeading();
		contentEl.createDiv({
			cls: 'setting-item-description',
			text: 'Property order here is the order of tokens on a card. Changing a definition never rewrites cards.',
		});
		const propsEl = contentEl.createDiv();
		const editor = new PropertyDefsEditor(this.app, propsEl, this.properties, (defs) => {
			this.properties = defs;
			this.renderImpact();
		});
		editor.render();

		new Setting(contentEl).setName('Tag colors').setHeading();
		const tagsEl = contentEl.createDiv();
		this.renderTags(tagsEl);

		this.impactEl = contentEl.createDiv({ cls: 'eb-pe-diags eb-impact' });
		this.renderImpact();

		new Setting(contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(this.options.cta ?? 'Save')
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

	// --- tag colors -----------------------------------------------------------

	private renderTags(el: HTMLElement): void {
		el.empty();
		el.addClass('eb-pe');
		if (this.tags.length === 0) el.createDiv({ cls: 'eb-pe-empty', text: 'No tag colors yet.' });

		this.tags.forEach((row, index) => {
			const line = el.createDiv({ cls: 'eb-pe-option' });
			const name = line.createEl('input', { type: 'text', cls: 'eb-pe-value' });
			name.value = row.tag;
			name.placeholder = 'Tag name';
			name.addEventListener('change', () => {
				row.tag = name.value.trim().replace(/^#/, '');
			});
			colorField(this.app, line, 'Background', row.color.bg, (value) => {
				if (value) row.color.bg = value;
				else delete row.color.bg;
				this.renderTags(el);
			});
			colorField(this.app, line, 'Text', row.color.fg, (value) => {
				if (value) row.color.fg = value;
				else delete row.color.fg;
				this.renderTags(el);
			});
			const remove = line.createEl('button', { cls: 'eb-pe-button', text: '✕' });
			remove.setAttribute('aria-label', 'Remove tag color');
			remove.addEventListener('click', () => {
				this.tags.splice(index, 1);
				this.renderTags(el);
			});
		});

		const actions = el.createDiv({ cls: 'eb-pe-actions' });
		const add = actions.createEl('button', { text: 'Add tag color' });
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
		return { ...this.config, properties: cloneDefs(this.properties), tagColors };
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
		el.createDiv({
			text: `${String(affected.length)} card value(s) no longer match their property type (${names}). Card text is left as written; those values stop being shown once the board is re-read.`,
		});
	}
}
