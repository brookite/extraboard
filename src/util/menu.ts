// Two things Obsidian's menus do that `obsidian.d.ts` (1.12.3) does not declare:
// submenus and an item's own element. Both are reached through one cast here,
// so the plugin's whole untyped surface is a single file to revisit when the
// typings catch up — and a single place a runtime guard has to live.

import type { Menu, MenuItem } from 'obsidian';

interface UntypedMenuItem {
	setSubmenu?: () => Menu;
	dom?: HTMLElement;
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
