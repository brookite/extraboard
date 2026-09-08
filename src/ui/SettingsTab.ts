// Plugin settings tab (Settings → Community plugins → Extraboard).
// Spec: docs/specs/settings.md.

import {
	App,
	PluginSettingTab,
	Setting,
	normalizePath,
	type SettingDefinition,
	type SettingDefinitionItem,
} from 'obsidian';
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		const setting = (
			name: string,
			desc: string,
			render: (row: Setting, containerEl: HTMLElement) => void | (() => void),
			visible?: () => boolean,
		): SettingDefinition => ({
			name,
			desc,
			render: (row) => render(row, row.settingEl.parentElement ?? row.settingEl),
			...(visible && { visible }),
		});

		return [
			setting(t('settings.language.name'), t('settings.language.desc'), (row) =>
				this.renderLanguage(row),
			),
			{
				type: 'group',
				heading: t('settings.dates.heading'),
				items: [
					setting(t('settings.dateFormat.name'), '', (row) =>
						this.renderFormatControl(row, 'date'),
					),
					setting(
						t('settings.customPattern.name'),
						t('settings.customPattern.desc'),
						(row) => this.renderCustomPattern(row, 'date'),
						() => this.plugin.settings.dateFormat === 'custom',
					),
					setting(t('settings.timeFormat.name'), '', (row) =>
						this.renderFormatControl(row, 'time'),
					),
					setting(
						t('settings.customPattern.name'),
						t('settings.customPattern.desc'),
						(row) => this.renderCustomPattern(row, 'time'),
						() => this.plugin.settings.timeFormat === 'custom',
					),
					setting(t('settings.weekStart.name'), t('settings.weekStart.desc'), (row) =>
						this.renderWeekStart(row),
					),
					setting(
						t('settings.dateHighlights.heading'),
						t('settings.dateHighlights.desc'),
						(row, containerEl) => this.renderDateHighlights(row, containerEl),
					),
				],
			},
			setting(t('settings.cardNoteFolder.name'), t('settings.cardNoteFolder.desc'), (row) =>
				this.renderCardNoteFolder(row),
			),
			setting(t('settings.progressStyle.name'), t('settings.progressStyle.desc'), (row) =>
				this.renderProgressStyle(row),
			),
			setting(
				t('settings.showRawPropertyTokens.name'),
				t('settings.showRawPropertyTokens.desc'),
				(row) => this.renderShowRawPropertyTokens(row),
			),
			setting(
				t('settings.fillCardWithColor.name'),
				t('settings.fillCardWithColor.desc'),
				(row) => this.renderFillCardWithColor(row),
			),
			setting(
				t('settings.strikeDoneCards.name'),
				t('settings.strikeDoneCards.desc'),
				(row) => this.renderStrikeDoneCards(row),
			),
			setting(
				t('settings.allowDeleteWithoutArchive.name'),
				t('settings.allowDeleteWithoutArchive.desc'),
				(row) => this.renderAllowDeleteWithoutArchive(row),
			),
			setting(t('settings.addToTopOther.name'), t('settings.addToTopOther.desc'), (row) =>
				this.renderAddPosition(row, 'addToTopOther'),
			),
			setting(
				t('settings.addToTopCompleting.name'),
				t('settings.addToTopCompleting.desc'),
				(row) => this.renderAddPosition(row, 'addToTopCompleting'),
			),
			setting(t('settings.archiveLimit.name'), t('settings.archiveLimit.desc'), (row) =>
				this.renderArchiveLimit(row),
			),
			setting(
				t('settings.defaultProperties.heading'),
				t('settings.defaultProperties.desc'),
				(row, containerEl) => this.renderDefaultProperties(row, containerEl),
			),
			setting(
				t('settings.reduceBoardFileWrites.name'),
				t('settings.reduceBoardFileWrites.desc'),
				(row) => this.renderReduceBoardFileWrites(row),
			),
		];
	}

	/**
	 * Obsidian below 1.13 does not know about setting definitions and still calls
	 * `display()`. Keep the same renderers as a compatibility path while the
	 * manifest supports those versions.
	 */
	display(): void {
		this.renderLegacy();
	}

	private renderLegacy(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderLanguage(new Setting(containerEl));

		new Setting(containerEl).setName(t('settings.dates.heading')).setHeading();
		this.renderFormatSetting(containerEl, 'date');
		this.renderFormatSetting(containerEl, 'time');
		this.renderWeekStart(new Setting(containerEl));
		this.renderDateHighlights(new Setting(containerEl), containerEl);
		this.renderCardNoteFolder(new Setting(containerEl));
		this.renderProgressStyle(new Setting(containerEl));
		this.renderShowRawPropertyTokens(new Setting(containerEl));
		this.renderFillCardWithColor(new Setting(containerEl));
		this.renderStrikeDoneCards(new Setting(containerEl));
		this.renderAllowDeleteWithoutArchive(new Setting(containerEl));
		this.renderAddPosition(new Setting(containerEl), 'addToTopOther');
		this.renderAddPosition(new Setting(containerEl), 'addToTopCompleting');
		this.renderArchiveLimit(new Setting(containerEl));
		this.renderDefaultProperties(new Setting(containerEl), containerEl);
		this.renderReduceBoardFileWrites(new Setting(containerEl));
	}

	private rerender(): void {
		// `update()` exists only in Obsidian 1.13+. Older supported versions reach
		// this code through the imperative `display()` fallback.
		const update = Reflect.get(this, 'update') as (() => void) | undefined;
		if (typeof update === 'function') update.call(this);
		else this.renderLegacy();
	}

	private renderLanguage(setting: Setting): void {
		setting
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
						this.rerender();
					}),
			);
	}

	private renderCardNoteFolder(setting: Setting): void {
		setting
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
	}

	private renderProgressStyle(setting: Setting): void {
		setting
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
	}

	private renderShowRawPropertyTokens(setting: Setting): void {
		setting
			.setName(t('settings.showRawPropertyTokens.name'))
			.setDesc(t('settings.showRawPropertyTokens.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRawPropertyTokens).onChange((value) => {
					this.plugin.settings.showRawPropertyTokens = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);
	}

	private renderFillCardWithColor(setting: Setting): void {
		setting
			.setName(t('settings.fillCardWithColor.name'))
			.setDesc(t('settings.fillCardWithColor.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fillCardWithColor).onChange((value) => {
					this.plugin.settings.fillCardWithColor = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);
	}

	private renderStrikeDoneCards(setting: Setting): void {
		setting
			.setName(t('settings.strikeDoneCards.name'))
			.setDesc(t('settings.strikeDoneCards.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.strikeDoneCards).onChange((value) => {
					this.plugin.settings.strikeDoneCards = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);
	}

	private renderAllowDeleteWithoutArchive(setting: Setting): void {
		setting
			.setName(t('settings.allowDeleteWithoutArchive.name'))
			.setDesc(t('settings.allowDeleteWithoutArchive.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.allowDeleteWithoutArchive).onChange((value) => {
					this.plugin.settings.allowDeleteWithoutArchive = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);
	}

	private renderAddPosition(
		setting: Setting,
		key: 'addToTopOther' | 'addToTopCompleting',
	): void {
		const other = key === 'addToTopOther';
		setting
			.setName(t(other ? 'settings.addToTopOther.name' : 'settings.addToTopCompleting.name'))
			.setDesc(t(other ? 'settings.addToTopOther.desc' : 'settings.addToTopCompleting.desc'))
			.addDropdown((drop) =>
				drop
					.addOption('top', t('settings.addTo.top'))
					.addOption('end', t('settings.addTo.end'))
					.setValue(this.plugin.settings[key] ? 'top' : 'end')
					.onChange((value) => {
						this.plugin.settings[key] = value === 'top';
						void this.plugin.saveSettings();
					}),
			);
	}

	private renderArchiveLimit(setting: Setting): void {
		// A number, not a slider: the useful range spans four orders of magnitude,
		// and the value people care about is an exact one they typed.
		setting
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
	}

	private renderDefaultProperties(setting: Setting, containerEl: HTMLElement): () => void {
		setting
			.setName(t('settings.defaultProperties.heading'))
			.setDesc(t('settings.defaultProperties.desc'));
		const editorEl = containerEl.createDiv();
		const editor = new PropertyDefsEditor(
			this.app,
			editorEl,
			this.plugin.settings.defaultProperties,
			(defs) => {
				this.plugin.settings.defaultProperties = defs;
				void this.plugin.saveSettings();
			},
		);
		editor.render();
		return () => editorEl.remove();
	}

	private renderReduceBoardFileWrites(setting: Setting): void {
		setting
			.setName(t('settings.reduceBoardFileWrites.name'))
			.setDesc(t('settings.reduceBoardFileWrites.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.reduceBoardFileWrites).onChange((value) => {
					this.plugin.settings.reduceBoardFileWrites = value;
					void this.plugin.saveSettings();
				}),
			);
	}

	/**
	 * Which day a calendar's week grid starts on (i18n-and-dates.md §2.6). The
	 * weekday labels come from `Intl` in the current language rather than the
	 * string tables — the same names the grid's own header shows — capitalized
	 * because locales like Russian write them lower-case mid-sentence, which a
	 * dropdown item is not.
	 */
	private renderWeekStart(setting: Setting): void {
		const lang = currentLanguage();
		const options: Record<string, string> = { auto: t('settings.weekStart.auto') };
		for (let day = 0; day < 7; day++) {
			const name = weekdayName(day, lang);
			options[String(day)] = name.charAt(0).toUpperCase() + name.slice(1);
		}

		setting
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
	private renderDateHighlights(setting: Setting, containerEl: HTMLElement): () => void {
		setting
			.setName(t('settings.dateHighlights.heading'))
			.setDesc(t('settings.dateHighlights.desc'));

		const editorEl = containerEl.createDiv();
		const editor = new DateHighlightsEditor(
			this.app,
			editorEl,
			this.plugin.settings.dateHighlights,
			(rules) => {
				this.plugin.settings.dateHighlights = rules;
				void this.plugin.saveSettings();
				this.plugin.refreshBoards();
			},
		);
		editor.render();
		return () => editorEl.remove();
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
	 * (i18n-and-dates.md §2.5).
	 */
	private renderFormatSetting(containerEl: HTMLElement, kind: 'date' | 'time'): void {
		this.renderFormatControl(new Setting(containerEl), kind);
		const settingsKey = kind === 'date' ? 'dateFormat' : 'timeFormat';
		if (this.plugin.settings[settingsKey] === 'custom') {
			this.renderCustomPattern(new Setting(containerEl), kind);
		}
	}

	private renderFormatControl(setting: Setting, kind: 'date' | 'time'): void {
		const settingsKey = kind === 'date' ? 'dateFormat' : 'timeFormat';
		const patternKey = kind === 'date' ? 'datePattern' : 'timePattern';
		const mode = this.plugin.settings[settingsKey];

		setting
			.setName(kind === 'date' ? t('settings.dateFormat.name') : t('settings.timeFormat.name'))
			.setDesc(this.hintText(kind, mode, this.plugin.settings[patternKey]))
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
							this.rerender();
						}),
			);
	}

	private renderCustomPattern(setting: Setting, kind: 'date' | 'time'): void {
		const patternKey = kind === 'date' ? 'datePattern' : 'timePattern';
		setting
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
						// Keep the live example current without rebuilding the tab and
						// stealing focus from the pattern field.
						const previous = setting.settingEl.previousElementSibling;
						const hint = previous?.querySelector<HTMLElement>('.setting-item-description');
						hint?.setText(this.hintText(kind, 'custom', value));
					}),
			);
	}
}
