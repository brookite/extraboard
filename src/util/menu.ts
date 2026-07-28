// Two things Obsidian's menus do that `obsidian.d.ts` (1.12.3) does not declare:
// submenus and an item's own element. Both are reached through one cast here,
// so the plugin's whole untyped surface is a single file to revisit when the
// typings catch up — and a single place a runtime guard has to live.

import { Menu, type MenuItem } from 'obsidian';
import { MenuToggleController } from './menuToggle';

interface UntypedMenuItem {
	setSubmenu?: () => Menu;
	dom?: HTMLElement;
}

const dropdowns = new MenuToggleController<Menu>();

/**
 * Toggle a plugin-owned dropdown anchored to its button rather than to the
 * click's changing pointer coordinates. A repeated click closes it; a click on
 * another dropdown trigger replaces it.
 */
export function showDropdownMenu(event: MouseEvent, fill: (menu: Menu) => void): void {
	const trigger = event.currentTarget;
	if (!trigger || typeof trigger !== 'object') return;
	const menu = dropdowns.toggle(trigger, () => new Menu());
	if (!menu) return;
	fill(menu);

	const element = trigger as HTMLElement;
	if (typeof element.getBoundingClientRect !== 'function') {
		menu.showAtMouseEvent(event);
		return;
	}
	const rect = element.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, element.ownerDocument);
}

/**
 * The item's submenu, or `null` on an Obsidian that has none — the API is newer
 * than the plugin's `minAppVersion`, so a caller must have a flat fallback
 * rather than build a menu nobody can open.
 */
export function submenuOf(item: MenuItem): Menu | null {
	const untyped = item as MenuItem & UntypedMenuItem;
	return typeof untyped.setSubmenu === 'function' ? untyped.setSubmenu() : null;
}

/**
 * Add a class to a menu item, for the colors `setWarning`'s red is not. A no-op
 * where the element is out of reach: styling is never worth a crash.
 */
export function styleMenuItem(item: MenuItem, cls: string): void {
	(item as MenuItem & UntypedMenuItem).dom?.addClass(cls);
}
