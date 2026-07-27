// Plugin settings tab (Settings → Community plugins → Extraboard).
// Spec: docs/specs/settings.md.

import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ExtraboardPlugin from '../main';
import type { ProgressStyle } from '../model/types';
import type { Lang } from '../i18n';
import { currentLanguage, setLanguage, t } from '../i18n';
import { formatDatePart, formatTimePart, type DateFormatMode, type DateTimeOpts } from '../i18n/dates';
import { today } from '../model/dates';
import { PropertyDefsEditor } from './PropertyDefsEditor';

function nowMinutes(): number {
	const d = new Date();
	return d.getHours() * 60 + d.getMinutes();
}

function modeLabel(mode: DateFormatMode): string {
	switch (mode) {
		case 'system':
			return t('settings.formatMode.system.label');
		case 'built-in':
			return t('settings.formatMode.builtIn.label');
		case 'relative':
			return t('settings.formatMode.relative.label');
		case 'custom':
			return t('settings.formatMode.custom.label');
	}
}

function modeDesc(mode: DateFormatMode): string {
	switch (mode) {
		case 'system':
			return t('settings.formatMode.system.desc');
		case 'built-in':
			return t('settings.formatMode.builtIn.desc');
		case 'relative':
			return t('settings.formatMode.relative.desc');
		case 'custom':
			return t('settings.formatMode.custom.desc');
	}
}

export class ExtraboardSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ExtraboardPlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Declarative settings (Obsidian 1.13+) replace `display()` entirely when
	 * they return anything, and `defaultProperties` is a nested, typed editor
	 * that the descriptors cannot express. Returning an empty list keeps the
	 * custom tab below on every supported version (`minAppVersion` is 1.4.0)
	 * while still implementing the newer API surface. See NOTICES.
	 */
	getSettingDefinitions(): never[] {
		return [];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.language.name'))
			.setDesc(t('settings.language.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						auto: t('settings.language.auto'),
						en: t('settings.language.en'),
						ru: t('settings.language.ru'),
					})
					.setValue(this.plugin.settings.language)
					.onChange((value) => {
						this.plugin.settings.language = value as Lang | 'auto';
						void this.plugin.saveSettings();
						setLanguage(this.plugin.settings.language);
						this.plugin.refreshBoards();
						this.display();
					}),
			);

		new Setting(containerEl).setName(t('settings.dates.heading')).setHeading();
		this.renderFormatSetting(containerEl, 'date');
		this.renderFormatSetting(containerEl, 'time');

		new Setting(containerEl)
			.setName(t('settings.cardNoteFolder.name'))
			.setDesc(t('settings.cardNoteFolder.desc'))
			.addText((text) =>
				text
					.setPlaceholder(t('settings.cardNoteFolder.placeholder'))
					.setValue(this.plugin.settings.cardNoteFolder)
					.onChange((value) => {
						const dir = value.trim();
						// Vault-relative and normalized: the plugin never writes outside the vault.
						this.plugin.settings.cardNoteFolder = dir ? normalizePath(dir) : '';
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.progressStyle.name'))
			.setDesc(t('settings.progressStyle.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						ring: t('settings.progressStyle.ring'),
						fraction: t('settings.progressStyle.fraction'),
						percent: t('settings.progressStyle.percent'),
					})
					.setValue(this.plugin.settings.progressStyle)
					.onChange((value) => {
						this.plugin.settings.progressStyle = value as ProgressStyle;
						void this.plugin.saveSettings();
						this.plugin.refreshBoards();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.showRawPropertyTokens.name'))
			.setDesc(t('settings.showRawPropertyTokens.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRawPropertyTokens).onChange((value) => {
					this.plugin.settings.showRawPropertyTokens = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);

		new Setting(containerEl)
			.setName(t('settings.fillCardWithColor.name'))
			.setDesc(t('settings.fillCardWithColor.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fillCardWithColor).onChange((value) => {
					this.plugin.settings.fillCardWithColor = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);

		new Setting(containerEl)
			.setName(t('settings.allowDeleteWithoutArchive.name'))
			.setDesc(t('settings.allowDeleteWithoutArchive.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDeleteWithoutArchive).onChange((value) => {
					this.plugin.settings.allowDeleteWithoutArchive = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);

		new Setting(containerEl).setName(t('settings.defaultProperties.heading')).setHeading();
		containerEl.createDiv({
			cls: 'setting-item-description',
			text: t('settings.defaultProperties.desc'),
		});

		const editor = new PropertyDefsEditor(
			this.app,
			containerEl.createDiv(),
			this.plugin.settings.defaultProperties,
			(defs) => {
				this.plugin.settings.defaultProperties = defs;
				void this.plugin.saveSettings();
			},
		);
		editor.render();
	}

	/** The example a preview shows: the date/time part only, the other left at `built-in`. */
	private preview(kind: 'date' | 'time', mode: DateFormatMode, pattern: string): string {
		const opts: DateTimeOpts = {
			dateFormat: kind === 'date' ? mode : 'built-in',
			timeFormat: kind === 'time' ? mode : 'built-in',
			datePattern: kind === 'date' ? pattern : undefined,
			timePattern: kind === 'time' ? pattern : undefined,
			lang: currentLanguage(),
		};
		return kind === 'date' ? formatDatePart(today(), opts) : formatTimePart(nowMinutes(), opts);
	}

	private hintText(kind: 'date' | 'time', mode: DateFormatMode, pattern: string): string {
		return t('settings.formatHint', {
			desc: modeDesc(mode),
			example: this.preview(kind, mode, pattern),
		});
	}

	/**
	 * `dateFormat`/`timeFormat`: a combobox with hint text explaining the choice
	 * and a live preview, plus the `custom` pattern field it reveals
	 * (i18n-and-dates.md §2.5). The pattern field updates only the hint text in
	 * place, never the whole tab, so typing a pattern does not lose focus.
	 */
	private renderFormatSetting(containerEl: HTMLElement, kind: 'date' | 'time'): void {
		const settingsKey = kind === 'date' ? 'dateFormat' : 'timeFormat';
		const patternKey = kind === 'date' ? 'datePattern' : 'timePattern';
		const mode = this.plugin.settings[settingsKey];

		new Setting(containerEl)
			.setName(kind === 'date' ? t('settings.dateFormat.name') : t('settings.timeFormat.name'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						system: modeLabel('system'),
						'built-in': modeLabel('built-in'),
						relative: modeLabel('relative'),
						custom: modeLabel('custom'),
					})
					.setValue(mode)
					.onChange((value) => {
						this.plugin.settings[settingsKey] = value as DateFormatMode;
						void this.plugin.saveSettings();
						this.plugin.refreshBoards();
						this.display();
					}),
			);

		const hint = containerEl.createDiv({ cls: 'setting-item-description eb-format-hint' });
		hint.setText(this.hintText(kind, mode, this.plugin.settings[patternKey]));

		if (mode === 'custom') {
			new Setting(containerEl)
				.setName(t('settings.customPattern.name'))
				.setDesc(t('settings.customPattern.desc'))
				.addText((text) =>
					text
						.setPlaceholder(kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm')
						.setValue(this.plugin.settings[patternKey])
						.onChange((value) => {
							this.plugin.settings[patternKey] = value;
							void this.plugin.saveSettings();
							this.plugin.refreshBoards();
							hint.setText(this.hintText(kind, mode, value));
						}),
				);
		}
	}
}
