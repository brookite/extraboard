// A card's content note is derived from its title, never stored separately.
// Spec: docs/specs/markdown-format.md §4.4, card-content-and-checklists.md §1.
// Pure; no `obsidian` imports.

export interface CardLink {
	/** Link target as written, without the `#fragment`. */
	path: string;
	/** `#heading` / `#^block` including the `#`; `''` when absent. */
	subpath: string;
	/** Text shown on the card: the alias, else the target's basename. */
	display: string;
	/** Full link text for `openLinkText` — `path` + `subpath`. */
	linktext: string;
	/** `[[wiki]]` vs `[alias](path.md)`. */
	wiki: boolean;
}

/** A link target that leaves the vault (`https:`, `mailto:`, `//host`). */
function isExternal(target: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('//');
}

/** Last path segment without a `.md` extension. */
export function basename(path: string): string {
	const last = path.slice(path.lastIndexOf('/') + 1);
	return last.endsWith('.md') ? last.slice(0, -3) : last;
}

/** Split a link target into its path and `#fragment` parts. */
function splitSubpath(target: string): { path: string; subpath: string } {
	// `^` may only start a block id, and a heading may not contain `#`, so the
	// first `#` is always the fragment boundary.
	const at = target.indexOf('#');
	if (at === -1) return { path: target, subpath: '' };
	return { path: target.slice(0, at), subpath: target.slice(at) };
}

function decode(target: string): string {
	try {
		return decodeURIComponent(target);
	} catch {
		return target;
	}
}

const WIKI_RE = /^\[\[([^[\]]*)\]\]$/;
const MD_RE = /^\[([^[\]]*)\]\(([^()]*)\)$/;

/**
 * The card's content note, or `null` when the title is not *exactly* one
 * internal link. A title that merely contains a link, an embed (`![[…]]`), an
 * external URL, or several links is an ordinary title with no content note.
 */
export function parseCardLink(title: string): CardLink | null {
	const text = title.trim();

	const wiki = WIKI_RE.exec(text);
	if (wiki) {
		const inner = wiki[1] ?? '';
		const bar = inner.indexOf('|');
		const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
		const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();
		if (!target || isExternal(target)) return null;
		const { path, subpath } = splitSubpath(target);
		if (!path) return null;
		return {
			path,
			subpath,
			display: alias || basename(path),
			linktext: target,
			wiki: true,
		};
	}

	const md = MD_RE.exec(text);
	if (md) {
		const alias = (md[1] ?? '').trim();
		const raw = (md[2] ?? '').trim();
		if (!raw || isExternal(raw)) return null;
		const { path, subpath } = splitSubpath(decode(raw));
		if (!path) return null;
		return {
			path,
			subpath,
			display: alias || basename(path),
			linktext: path + subpath,
			wiki: false,
		};
	}

	return null;
}

/** The title a linked card falls back to when its note is unlinked (§2). */
export function unlinkedTitle(title: string): string {
	return parseCardLink(title)?.display ?? title;
}

/** Characters Obsidian forbids in a file name, plus the link-syntax ones. */
const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;
const MAX_NAME = 100;

/**
 * The file name "Create note" derives from a card title: link syntax and path
 * separators replaced, whitespace collapsed, length capped, leading dots
 * dropped (they would hide the file). Never empty.
 */
export function noteFileName(title: string): string {
	const name = title
		.replace(FORBIDDEN, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.slice(0, MAX_NAME)
		.trim();
	// A title made only of forbidden characters replaces down to dashes, which
	// is a legal name but not one the user meant: nothing is left of it.
	return /^[-.\s]*$/.test(name) ? 'Untitled card' : name;
}
