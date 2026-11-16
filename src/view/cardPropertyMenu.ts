import { Menu } from 'obsidian';
import { t } from '../i18n';
import type { BoardConfig, Card } from '../model/types';
import { submenuOf } from '../util/menu';
import { hideMenuTree } from '../util/menuToggle';

/** Property shortcuts shared by every view that renders a card. */
export function addCardPropertyMenus(
	menu: Menu,
	event: MouseEvent,
	config: BoardConfig,
	card: Card,
	onEdit: (name: string) => void,
	onRemove: (name: string) => void,
): void {
	const editable = [...new Set([
		...config.properties.map((def) => def.name),
		...card.properties.map((pv) => pv.name),
	])];
	const add = (title: string, icon: string, names: string[], select: (name: string) => void): void => {
		menu.addItem((item) => {
			item.setTitle(title).setIcon(icon).setDisabled(names.length === 0);
			if (!names.length) return;
			const fill = (target: Menu): void => {
				for (const name of names) {
					target.addItem((child) => child.setTitle(name).onClick(() => {
						hideMenuTree(target, menu);
						select(name);
					}));
				}
			};
			const submenu = submenuOf(item);
			if (submenu) fill(submenu);
			else item.onClick(() => {
				const flat = new Menu();
				fill(flat);
				flat.showAtMouseEvent(event);
			});
		});
	};
	add(t('card.editProperty'), 'list-plus', editable, onEdit);
	add(t('card.removePropertyValue'), 'eraser', card.properties.map((pv) => pv.name), onRemove);
}
