// Plugin settings tab (Settings → Community plugins → Extraboard).
// Spec: docs/specs/settings.md.

import { App, PluginSettingTab, Setting, normalizePath } from 'obsidian';
import type ExtraboardPlugin from '../main';
import type { ProgressStyle } from '../model/types';
import { PropertyDefsEditor } from './PropertyDefsEditor';

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
			.setName('Card note folder')
			.setDesc(
				'Where card notes are created for boards that do not set a folder of their own. Empty uses the vault root.',
			)
			.addText((text) =>
				text
					.setPlaceholder('Vault root')
					.setValue(this.plugin.settings.cardNoteFolder)
					.onChange((value) => {
						const dir = value.trim();
						// Vault-relative and normalized: the plugin never writes outside the vault.
						this.plugin.settings.cardNoteFolder = dir ? normalizePath(dir) : '';
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Progress style')
			.setDesc(
				'Shape of the checklist count on cards and of percent properties. A board can override this in its own settings.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ ring: 'Ring', fraction: 'Fraction (3/7)', percent: 'Percent (43%)' })
					.setValue(this.plugin.settings.progressStyle)
					.onChange((value) => {
						this.plugin.settings.progressStyle = value as ProgressStyle;
						void this.plugin.saveSettings();
						this.plugin.refreshBoards();
					}),
			);

		new Setting(containerEl)
			.setName('Show raw property tokens')
			.setDesc(
				'Keep @{property|value} in the card editor text instead of editing properties as badges below it. Tags always stay inline.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showRawPropertyTokens).onChange((value) => {
					this.plugin.settings.showRawPropertyTokens = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);

		new Setting(containerEl)
			.setName('Fill cards with color')
			.setDesc(
				'A card with a color property is tinted, not just striped along its left edge. Display only — it never changes a board file.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.fillCardWithColor).onChange((value) => {
					this.plugin.settings.fillCardWithColor = value;
					void this.plugin.saveSettings();
					this.plugin.refreshBoards();
				}),
			);

		new Setting(containerEl).setName('Default properties').setHeading();
		containerEl.createDiv({
			cls: 'setting-item-description',
			text: 'Properties written into every new board. Editing them never touches boards that already exist — use Board settings for those.',
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
}
