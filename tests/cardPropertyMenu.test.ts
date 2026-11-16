import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Menu } from 'obsidian';
import type { BoardConfig, Card } from '../src/model/types';
import { addCardPropertyMenus } from '../src/view/cardPropertyMenu';

const { FakeMenu, FakeItem } = vi.hoisted(() => {
	class FakeItem {
		title = '';
		disabled = false;
		submenu: FakeMenu | null = null;
		click = (): void => {};
		setTitle(title: string) { this.title = title; return this; }
		setIcon() { return this; }
		setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
		onClick(callback: () => void) { this.click = callback; return this; }
		setSubmenu(): FakeMenu | null { this.submenu = new FakeMenu(); return this.submenu; }
	}
	class FakeMenu {
		static shown: FakeMenu | null = null;
		items: FakeItem[] = [];
		hidden = false;
		addItem(fill: (item: FakeItem) => void) {
			const item = new FakeItem();
			fill(item);
			this.items.push(item);
			return this;
		}
		hide() { this.hidden = true; }
		showAtMouseEvent() { FakeMenu.shown = this; }
	}
	return { FakeMenu, FakeItem };
});

vi.mock('obsidian', () => ({ Menu: FakeMenu }));

const config: BoardConfig = {
	version: 1,
	views: [{ id: 'v', name: 'Board', type: 'kanban' }],
	activeView: 'v',
	properties: [{ name: 'priority', type: 'integer' }, { name: 'color', type: 'color' }],
	tagColors: {},
};
const card: Card = {
	title: 'Card', tags: ['work'], checklist: [], trailing: [],
	properties: [
		{ name: 'priority', type: 'integer', value: 0 },
		{ name: 'foreign', type: 'raw', value: ['kept'] },
	],
};

function build(properties = config.properties, values = card.properties) {
	const menu = new FakeMenu();
	const edit = vi.fn();
	const remove = vi.fn();
	addCardPropertyMenus(menu as unknown as Menu, {} as MouseEvent,
		{ ...config, properties }, { ...card, properties: values }, edit, remove);
	return { menu, edit, remove };
}

beforeEach(() => { FakeMenu.shown = null; });

describe('card property menus', () => {
	it('offers declared properties and foreign values once, including absent properties', () => {
		const { menu } = build();
		expect(menu.items[0]?.submenu?.items.map((item) => item.title))
			.toEqual(['priority', 'color', 'foreign']);
		expect(menu.items[1]?.submenu?.items.map((item) => item.title))
			.toEqual(['priority', 'foreign']);
	});

	it('closes the whole menu before opening the selected property', () => {
		const { menu, edit, remove } = build();
		const submenu = menu.items[0]?.submenu;
		submenu?.items[1]?.click();
		expect(edit).toHaveBeenCalledWith('color');
		expect(remove).not.toHaveBeenCalled();
		expect(menu.hidden && submenu?.hidden).toBe(true);
	});

	it('removes only the selected installed value', () => {
		const { menu, edit, remove } = build();
		menu.items[1]?.submenu?.items[1]?.click();
		expect(remove).toHaveBeenCalledExactlyOnceWith('foreign');
		expect(edit).not.toHaveBeenCalled();
	});

	it('disables empty menus without creating a submenu', () => {
		const { menu } = build([], []);
		expect(menu.items.every((item) => item.disabled && item.submenu === null)).toBe(true);
		expect(build(config.properties, []).menu.items[1]?.disabled).toBe(true);
	});

	it('offers the same actions through a separate menu without submenu support', () => {
		const stub = vi.spyOn(FakeItem.prototype, 'setSubmenu').mockReturnValue(null);
		try {
			const { menu, edit } = build();
			menu.items[0]?.click();
			const flat = FakeMenu.shown;
			expect(flat?.items.map((item) => item.title)).toEqual(['priority', 'color', 'foreign']);
			flat?.items[2]?.click();
			expect(edit).toHaveBeenCalledWith('foreign');
			expect(menu.hidden && flat?.hidden).toBe(true);
		} finally {
			stub.mockRestore();
		}
	});
});
