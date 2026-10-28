// Pick a board file from the vault — the first step of "Add card" when it is
// run outside a board. Spec: docs/specs/quick-add-card.md §2.

import { FuzzySuggestModal, type App, type TFile } from 'obsidian';
import { t } from '../i18n';

export class BoardSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly boards: TFile[],
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t('quickAdd.chooseBoard'));
	}

	getItems(): TFile[] {
		return this.boards;
	}

	getItemText(file: TFile): string {
		return file.path.replace(/\.md$/, '');
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
