// Plugin settings tab (Settings → Community plugins → Extraboard).
// Spec: docs/specs/settings.md.

import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ExtraboardPlugin from '../main';
import type { ProgressStyle } from '../model/types';
import type { Lang } from '../i18n';
import { currentLanguage, setLanguage, t } from '../i18n';
import {
	formatDatePart,
	formatTimePart,
	weekdayName,
	type DateFormatMode,
	type DateTimeOpts,
	type WeekStart,
} from '../i18n/dates';
import { today } from '../model/dates';
import { ARCHIVE_LIMIT_MAX, ARCHIVE_LIMIT_MIN, DEFAULT_SETTINGS } from '../settings';
import { PropertyDefsEditor } from './PropertyDefsEditor';
import { DateHighlightsEditor } from './DateHighlightsEditor';
import { FolderSuggest } from './FolderSuggest';

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
	 * custom tab below on every supported version (`minAppVersion` is 1.4.10)
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
		this.renderWeekStart(containerEl);
		this.renderDateHighlights(containerEl);

		new Setting(containerEl)
			.setName(t('settings.cardNoteFolder.name'))
			.setDesc(t('settings.cardNoteFolder.desc'))
			.addText((text) => {
				const save = (value: string) => {
					const dir = value.trim();
					// Vault-relative and normalized: the plugin never writes outside the vault.
					this.plugin.settings.cardNoteFolder = dir ? normalizePath(dir) : '';
					void this.plugin.saveSettings();
				};
				text
					.setPlaceholder(t('settings.cardNoteFolder.placeholder'))
					.setValue(this.plugin.settings.cardNoteFolder)
					.onChange(save);
				// Picking a suggestion sets the input programmatically, which does
				// not fire `onChange` — hence the same `save` passed along.
				new FolderSuggest(this.app, text.inputEl, save);
			});

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

		// A number, not a slider: the useful range spans four orders of magnitude,
		// and the value people care about is an exact one they typed.
		new Setting(containerEl)
			.setName(t('settings.archiveLimit.name'))
			.setDesc(t('settings.archiveLimit.desc'))
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(ARCHIVE_LIMIT_MIN);
				text.inputEl.max = String(ARCHIVE_LIMIT_MAX);
				text.setValue(String(this.plugin.settings.archiveLimit)).onChange((value) => {
					const parsed = Number.parseInt(value, 10);
					// An unparseable or out-of-range entry falls back to the default
					// rather than to a bound: nothing is trimmed by a typo.
					this.plugin.settings.archiveLimit = Number.isFinite(parsed)
						? Math.min(ARCHIVE_LIMIT_MAX, Math.max(ARCHIVE_LIMIT_MIN, parsed))
						: DEFAULT_SETTINGS.archiveLimit;
					void this.plugin.saveSettings();
				});
				// Show the clamp: the field must not keep displaying a value the
				// plugin has already rejected.
				text.inputEl.addEventListener('blur', () => {
					text.setValue(String(this.plugin.settings.archiveLimit));
				});
			});

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

	/**
	 * Which day a calendar's week grid starts on (i18n-and-dates.md §2.6). The
	 * weekday labels come from `Intl` in the current language rather than the
	 * string tables — the same names the grid's own header shows — capitalized
	 * because locales like Russian write them lower-case mid-sentence, which a
	 * dropdown item is not.
	 */
	private renderWeekStart(containerEl: HTMLElement): void {
		const lang = currentLanguage();
		const options: Record<string, string> = { auto: t('settings.weekStart.auto') };
		for (let day = 0; day < 7; day++) {
			const name = weekdayName(day, lang);
			options[String(day)] = name.charAt(0).toUpperCase() + name.slice(1);
		}

		new Setting(containerEl)
			.setName(t('settings.weekStart.name'))
			.setDesc(t('settings.weekStart.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(String(this.plugin.settings.weekStart))
					.onChange((value) => {
						this.plugin.settings.weekStart = (value === 'auto' ? 'auto' : Number(value)) as WeekStart;
						void this.plugin.saveSettings();
						this.plugin.refreshBoards();
					}),
			);
	}

	/**
	 * The plugin-wide highlight rules (i18n-and-dates.md §3.2). A board may
	 * replace the whole list in its own settings, so nothing here is per-board.
	 */
	private renderDateHighlights(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.dateHighlights.heading'))
			.setDesc(t('settings.dateHighlights.desc'));

		const editor = new DateHighlightsEditor(
			this.app,
			containerEl.createDiv(),
			this.plugin.settings.dateHighlights,
			(rules) => {
				this.plugin.settings.dateHighlights = rules;
				void this.plugin.saveSettings();
				this.plugin.refreshBoards();
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
