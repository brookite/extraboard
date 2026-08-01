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
	/** Offset of the link's first character in the title. */
	start: number;
	/** Offset just past the link's last character in the title. */
	end: number;
	/** True when the title is nothing but this link (bar whitespace). */
	whole: boolean;
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

/** What a match yields before it is placed in the title. */
type LinkParts = Omit<CardLink, 'start' | 'end' | 'whole'>;

function fromWiki(inner: string): LinkParts | null {
	const bar = inner.indexOf('|');
	const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
	const alias = bar === -1 ? '' : inner.slice(bar + 1).trim();
	if (!target || isExternal(target)) return null;
	const { path, subpath } = splitSubpath(target);
	if (!path) return null;
	return { path, subpath, display: alias || basename(path), linktext: target, wiki: true };
}

function fromMarkdown(text: string, target: string): LinkParts | null {
	const alias = text.trim();
	const raw = target.trim();
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

// The wikilink alternative comes first so `[[Note]](x)` reads as a wikilink,
// the way Obsidian reads it. A leading `!` is captured rather than excluded, so
// an embed is *skipped* and the scan carries on to the next link.
const LINK_RE = /(!?)\[\[([^[\]]*)\]\]|(!?)\[([^[\]]*)\]\(([^()]*)\)/g;

/**
 * The card's content note: the **first internal link in the title**, or `null`
 * when it has none. A title may carry text around the link and further links —
 * only the first one binds the note, so a card is never rewritten into nested
 * link syntax. Embeds (`![[…]]`) and external URLs are skipped, not accepted.
 */
export function parseCardLink(title: string): CardLink | null {
	LINK_RE.lastIndex = 0;
	for (let m = LINK_RE.exec(title); m; m = LINK_RE.exec(title)) {
		if (m[1] === '!' || m[3] === '!') continue;
		const parts = m[2] === undefined ? fromMarkdown(m[4] ?? '', m[5] ?? '') : fromWiki(m[2]);
		if (!parts) continue;
		const start = m.index;
		const end = start + m[0].length;
		return {
			...parts,
			start,
			end,
			whole: !title.slice(0, start).trim() && !title.slice(end).trim(),
		};
	}
	return null;
}

/**
 * Every internal link in a piece of text, as written — the whole scan, where
 * `parseCardLink` stops at the first one. Embeds and external URLs are skipped
 * the same way. Used by the `linked to` filter, which asks about a card's text
 * properties as well as its title (filters-and-sorting.md §3).
 */
export function linksIn(text: string): string[] {
	LINK_RE.lastIndex = 0;
	const out: string[] = [];
	for (let m = LINK_RE.exec(text); m; m = LINK_RE.exec(text)) {
		if (m[1] === '!' || m[3] === '!') continue;
		const parts = m[2] === undefined ? fromMarkdown(m[4] ?? '', m[5] ?? '') : fromWiki(m[2]);
		if (parts) out.push(parts.linktext);
	}
	return out;
}

/**
 * A link target reduced to what two of them can be compared by: no `.md`, no
 * `#heading` or `^block`, case-folded. The model has no metadata cache, so this
 * is deliberately textual — a full path matches a full path, and a bare name
 * matches the last segment of one (filters-and-sorting.md §3.4).
 */
export function normalizeLink(target: string): string {
	const { path } = splitSubpath(target.trim());
	const clean = path.endsWith('.md') ? path.slice(0, -3) : path;
	return clean.toLowerCase();
}

/** True iff two link targets name the same note, by path or by basename. */
export function sameLinkTarget(a: string, b: string): boolean {
	const left = normalizeLink(a);
	const right = normalizeLink(b);
	if (!left || !right) return false;
	if (left === right) return true;
	return basename(left) === basename(right);
}

/**
 * The title a linked card falls back to when its note is unlinked (§2): the
 * content link replaced by its display text, the rest of the title kept.
 */
export function unlinkedTitle(title: string): string {
	const link = parseCardLink(title);
	if (!link) return title;
	return (title.slice(0, link.start) + link.display + title.slice(link.end)).trim();
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
