// Plugin settings tab (Settings → Community plugins → Extraboard).
// Spec: docs/specs/settings.md.

import { App, PluginSettingTab, Setting } from 'obsidian';
import type ExtraboardPlugin from '../main';
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
