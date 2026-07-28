/**
 * The minimal surface needed from Obsidian's `Menu`, kept pure so the toggle
 * protocol can be tested without an Obsidian runtime.
 */
export interface ToggleableMenu {
	hide(): unknown;
	onHide(callback: () => void): void;
}

interface OpenMenu<M extends ToggleableMenu> {
	trigger: object;
	menu: M;
}

interface RecentClose {
	trigger: object;
	at: number;
}

const REPEAT_CLICK_WINDOW_MS = 250;

/**
 * Owns one dropdown at a time and makes its trigger a real toggle.
 *
 * Obsidian closes a menu from a document-level pointer handler before the
 * button's `click` handler runs. `recent` bridges that pointerdown→click gap:
 * the click that caused the close is consumed instead of opening a fresh menu.
 */
export class MenuToggleController<M extends ToggleableMenu = ToggleableMenu> {
	private active: OpenMenu<M> | null = null;
	private recent: RecentClose | null = null;

	constructor(private readonly now: () => number = () => performance.now()) {}

	toggle(trigger: object, create: () => M): M | null {
		const at = this.now();
		if (this.active?.trigger === trigger) {
			const menu = this.active.menu;
			this.active = null;
			menu.hide();
			// This hide happened inside the button's own click handler, so there
			// is no later click from the same gesture left to consume.
			this.recent = null;
			return null;
		}

		if (
			this.recent?.trigger === trigger &&
			at - this.recent.at >= 0 &&
			at - this.recent.at <= REPEAT_CLICK_WINDOW_MS
		) {
			this.recent = null;
			return null;
		}

		if (this.active) {
			const previous = this.active;
			this.active = null;
			previous.menu.hide();
		}

		const menu = create();
		this.active = { trigger, menu };
		menu.onHide(() => {
			if (this.active?.menu === menu) this.active = null;
			this.recent = { trigger, at: this.now() };
		});
		return menu;
	}
}
