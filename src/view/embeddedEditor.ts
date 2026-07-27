// Obsidian's embeddable Markdown editor, reached through an **undocumented**
// API (docs/NOTICES.md, "Accepted API risks"). It is what gives a card `[[`,
// `#` and `:` completion; the public API has no embeddable editor.
//
// Every access is feature-detected and every failure returns `null`, so the
// caller falls back to the plain textarea of M4 — a card must always be
// editable. This module is the whole blast radius of an API change.

import type { App, TFile } from 'obsidian';

/** The slice of the internal editor component this plugin uses. */
interface InternalEditor {
	editorEl?: HTMLElement;
	containerEl?: HTMLElement;
	editor?: {
		getValue?(): string;
		focus?(): void;
		cm?: { contentDOM?: HTMLElement };
	};
	/** `true` in source mode, `false` in Live Preview — read off the owner. */
	sourceMode?: boolean;
	showSearch?(replace?: boolean): void;
	set?(value: string, clear?: boolean): void;
	destroy?(): void;
	unload?(): void;
}

/**
 * The editor's owner — Obsidian's `MarkdownFileInfo`. Three keys are enough to
 * *construct* the editor, but on focus it assigns `workspace.activeEditor = owner`,
 * and from then on core code reads the object as a full file info: the word-count
 * plugin calls `owner.editor.getSelection()` on every selection change, the
 * application menu reads `owner.editMode.sourceMode` on every file-open, the
 * mobile toolbar reads `owner.editor.hasFocus()`, and the toggle-preview /
 * search-and-replace commands call `owner.toggleMode()` / `owner.showSearch()`
 * with no type guard. Anything missing is an uncaught TypeError inside Obsidian.
 *
 * `file` stays `null`: the card's text lives in the board file, but claiming it
 * would put this editor into the CM undo-history cache under the board's path,
 * where the *next* card editor with a same-length text would inherit it.
 * `workspace.getActiveFile()` falls through to the board view either way.
 */
interface EditorOwner {
	app: App;
	file: TFile | null;
	hoverPopover: unknown;
	/** Both filled in once the editor exists — it is what they delegate to. */
	editor?: InternalEditor['editor'];
	editMode?: InternalEditor;
	onMarkdownScroll(): void;
	getMode(): string;
	toggleMode(): void;
	showSearch(replace?: boolean): void;
}

type EditorCtor = new (app: App, container: HTMLElement, owner: EditorOwner) => InternalEditor;

/** The Markdown embed component, used only to reach the editor's constructor. */
interface EmbedView {
	editable?: boolean;
	showEditor?(): void;
	editMode?: object;
	unload?(): void;
}

type EmbedCreator = (
	ctx: { app: App; containerEl: HTMLElement },
	file: TFile | null,
	subpath: string,
) => EmbedView | null;

interface EmbedRegistryApp {
	embedRegistry?: { embedByExtension?: Record<string, EmbedCreator | undefined> };
}

/** `undefined` = not looked up yet, `null` = unavailable on this version. */
let ctorCache: EditorCtor | null | undefined;

/**
 * The editor component is not exported anywhere, so it is reached through the
 * one place Obsidian instantiates it: a throwaway Markdown embed, whose edit
 * mode's prototype chain carries the constructor. The embed is unloaded again
 * immediately and the result is cached for the session.
 */
function resolveEditorCtor(app: App): EditorCtor | null {
	if (ctorCache !== undefined) return ctorCache;
	ctorCache = null;
	try {
		const create = (app as App & EmbedRegistryApp).embedRegistry?.embedByExtension?.md;
		if (typeof create !== 'function') return null;

		const host = createDiv();
		const embed = create({ app, containerEl: host }, null, '');
		if (!embed || typeof embed.showEditor !== 'function') return null;
		embed.editable = true;
		embed.showEditor();
		const editMode = embed.editMode;
		embed.unload?.();
		host.remove();
		if (!editMode) return null;

		const proto: unknown = Object.getPrototypeOf(Object.getPrototypeOf(editMode));
		const ctor = (proto as { constructor?: unknown } | null)?.constructor;
		if (typeof ctor === 'function') ctorCache = ctor as EditorCtor;
	} catch (err) {
		console.warn('Extraboard: embeddable Markdown editor unavailable', err);
		ctorCache = null;
	}
	return ctorCache;
}

/**
 * True while an editor suggestion popup is on screen. Its keys must win: our
 * key handler sits on the editor's content element, which sees the event
 * *before* the popup's document-level keymap does, so Enter and Escape are
 * handed over rather than intercepted while a completion is open.
 */
function suggestionOpen(): boolean {
	const el = document.querySelector('.suggestion-container');
	return el instanceof HTMLElement && el.isConnected && el.getBoundingClientRect().height > 0;
}

export interface EmbeddedEditorOptions {
	value: string;
	/**
	 * Focus may leave the field and stay inside the editor — the property badges
	 * live there. Blur then commits without closing; only focus leaving this
	 * element entirely counts as "done". Defaults to the mount container.
	 */
	scope?: HTMLElement;
	/** Enter (without Shift, with no completion open) commits and closes. */
	onSubmit(text: string): void;
	/** Blur inside `scope`: save the text, keep the field open. */
	onCommit?(text: string): void;
	onCancel(): void;
}

export interface EmbeddedEditorHandle {
	getValue(): string;
	focus(): void;
	destroy(): void;
}

/** Mount the editor into `container`, or return `null` when it is unavailable. */
export function createEmbeddedEditor(
	app: App,
	container: HTMLElement,
	options: EmbeddedEditorOptions,
): EmbeddedEditorHandle | null {
	const Ctor = resolveEditorCtor(app);
	if (!Ctor) return null;

	// The owner is built before the editor, because the editor's constructor takes
	// it; the two keys that can only point back at the editor are filled in after.
	let mounted: InternalEditor | null = null;
	const owner: EditorOwner = {
		app,
		file: null,
		hoverPopover: null,
		// A board is not a Markdown view: there is nothing to scroll, the editor
		// is always in source mode, and there is no reading view to toggle to.
		onMarkdownScroll: () => undefined,
		getMode: () => 'source',
		toggleMode: () => undefined,
		showSearch: (replace) => mounted?.showSearch?.(replace),
	};

	let instance: InternalEditor;
	try {
		instance = new Ctor(app, container, owner);
	} catch (err) {
		console.warn('Extraboard: could not create the embedded editor', err);
		return null;
	}
	mounted = instance;
	owner.editor = instance.editor;
	owner.editMode = instance;

	const setValue = instance.set?.bind(instance);
	const getValue = instance.editor?.getValue?.bind(instance.editor);
	const content = instance.editor?.cm?.contentDOM;
	if (!setValue || !getValue || !content) {
		destroy(instance);
		return null;
	}

	setValue(options.value, true);

	let closed = false;
	const finish = (commit: boolean): void => {
		if (closed) return;
		closed = true;
		if (commit) options.onSubmit(getValue());
		else options.onCancel();
	};

	const onKeyDown = (evt: KeyboardEvent): void => {
		if (evt.isComposing || suggestionOpen()) return;
		if (evt.key === 'Enter' && !evt.shiftKey) {
			evt.preventDefault();
			finish(true);
		} else if (evt.key === 'Escape') {
			evt.preventDefault();
			finish(false);
		}
	};

	const scope = options.scope ?? container;
	const onBlur = (): void => {
		// Deferred: clicking a completion moves focus briefly, and the click must
		// not be read as "the user left the card".
		window.setTimeout(() => {
			if (closed || suggestionOpen()) return;
			if (container.contains(document.activeElement)) return;
			// Still inside the editor (a property badge): save, but stay open.
			if (scope.contains(document.activeElement)) {
				options.onCommit?.(getValue());
				return;
			}
			finish(true);
		}, 0);
	};

	content.addEventListener('keydown', onKeyDown);
	content.addEventListener('blur', onBlur);

	return {
		getValue,
		focus: () => instance.editor?.focus?.(),
		destroy: () => {
			closed = true;
			content.removeEventListener('keydown', onKeyDown);
			content.removeEventListener('blur', onBlur);
			releaseOwner(app, owner);
			destroy(instance);
		},
	};
}

/**
 * Obsidian points `workspace.activeEditor` at the owner when the editor takes
 * focus and never clears it by itself. A destroyed card editor left there would
 * aim every editor-scoped command at a dead CodeMirror, so the pointer is
 * dropped while it is still ours — the getter then falls back to the active
 * Markdown view on its own.
 */
function releaseOwner(app: App, owner: EditorOwner): void {
	const workspace: { activeEditor?: unknown } = app.workspace;
	if (workspace.activeEditor === owner) workspace.activeEditor = null;
}

function destroy(instance: InternalEditor): void {
	try {
		if (typeof instance.destroy === 'function') instance.destroy();
		else instance.unload?.();
	} catch (err) {
		console.warn('Extraboard: failed to destroy the embedded editor', err);
	}
}
