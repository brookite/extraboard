import { describe, expect, it } from 'vitest';
import { hideMenuTree, MenuToggleController, type ToggleableMenu } from '../src/util/menuToggle';

class FakeMenu implements ToggleableMenu {
	hidden = false;
	private callbacks: Array<() => void> = [];

	hide(): void {
		this.hidden = true;
		for (const callback of this.callbacks) callback();
	}

	onHide(callback: () => void): void {
		this.callbacks.push(callback);
	}
}

describe('MenuToggleController', () => {
	it('opens on the first click and closes on a second click of the same trigger', () => {
		const controller = new MenuToggleController(() => 0);
		const trigger = {};
		const first = new FakeMenu();

		expect(controller.toggle(trigger, () => first)).toBe(first);
		expect(controller.toggle(trigger, () => new FakeMenu())).toBeNull();
		expect(first.hidden).toBe(true);

		const third = new FakeMenu();
		expect(controller.toggle(trigger, () => third)).toBe(third);
	});

	it('does not reopen when Obsidian hides the menu before the repeated click arrives', () => {
		let now = 10;
		const controller = new MenuToggleController(() => now);
		const trigger = {};
		const first = new FakeMenu();
		expect(controller.toggle(trigger, () => first)).toBe(first);

		// Obsidian's document-level pointer handler runs before the button click.
		now = 20;
		first.hide();
		now = 21;
		expect(controller.toggle(trigger, () => new FakeMenu())).toBeNull();

		now = 400;
		const third = new FakeMenu();
		expect(controller.toggle(trigger, () => third)).toBe(third);
	});

	it('switches directly to a different trigger', () => {
		const controller = new MenuToggleController(() => 0);
		const first = new FakeMenu();
		const second = new FakeMenu();

		controller.toggle({}, () => first);
		expect(controller.toggle({}, () => second)).toBe(second);
		expect(first.hidden).toBe(true);
	});
});

describe('hideMenuTree', () => {
	it('closes every distinct menu in a submenu chain', () => {
		const root = new FakeMenu();
		const child = new FakeMenu();

		hideMenuTree(child, root, child);

		expect(child.hidden).toBe(true);
		expect(root.hidden).toBe(true);
	});
});
