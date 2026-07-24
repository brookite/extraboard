import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ExtraboardSettings } from './settings';

export default class ExtraboardPlugin extends Plugin {
	settings!: ExtraboardSettings;

	async onload() {
		await this.loadSettings();
		// The board view, commands, and settings tab are registered in later
		// milestones (see docs/MILESTONES.md). onload stays minimal for now.
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ExtraboardSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
