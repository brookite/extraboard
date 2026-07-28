// Board frontmatter: the `extraboard` marker, whose value records the active
// view name. The block is kept as raw text and read by hand — the configuration lives in the
// `extraboard-settings` code block (`boardSettings.ts`), so there is no reason
// to pull a YAML parser in to read one boolean, and never reformatting the text
// is what preserves foreign keys and comments.
// Spec: docs/specs/markdown-format.md §2. Pure; no `obsidian` imports.

/** Format the marker as a YAML string scalar, regardless of characters in a view name. */
export function boardMarker(viewName: string): string {
	return `extraboard: ${JSON.stringify(viewName)}`;
}

export interface SplitFile {
	/** Text between the `---` delimiters, verbatim; "" when the block is empty. */
	frontmatter: string;
	body: string;
}

/**
 * Split leading frontmatter from the body. Returns null if the text does not
 * begin with a `---` delimited block.
 */
export function splitFrontmatter(text: string): SplitFile | null {
	const firstNl = text.indexOf('\n');
	if (firstNl === -1) return null;
	if (text.slice(0, firstNl).replace(/\r$/, '') !== '---') return null;

	let searchStart = firstNl + 1;
	for (;;) {
		const nl = text.indexOf('\n', searchStart);
		const lineEnd = nl === -1 ? text.length : nl;
		const line = text.slice(searchStart, lineEnd).replace(/\r$/, '');
		if (line === '---') {
			return {
				frontmatter: text.slice(firstNl + 1, searchStart),
				body: nl === -1 ? '' : text.slice(nl + 1),
			};
		}
		if (nl === -1) return null; // no closing delimiter
		searchStart = nl + 1;
	}
}

/**
 * The marker has to be a top-level key, so it is matched at column 0: YAML
 * indents everything nested (including block scalar content), which is what
 * keeps a `extraboard:` line inside some other key from counting. Its value is
 * deliberately irrelevant for detection.
 */
const MARKER_RE = /^extraboard[ \t]*:.*\r?$/m;

/** True iff the frontmatter block declares the top-level board marker. */
export function hasBoardMarker(frontmatter: string): boolean {
	return MARKER_RE.test(frontmatter);
}

/**
 * The block with the marker set to the active view name, foreign keys untouched.
 * This also migrates the former `extraboard: true` marker on the next save.
 */
export function withBoardMarker(frontmatter: string | null, viewName: string): string {
	const marker = boardMarker(viewName);
	if (frontmatter === null) return `${marker}\n`;
	return hasBoardMarker(frontmatter)
		? frontmatter.replace(MARKER_RE, marker)
		: `${marker}\n${frontmatter}`;
}

/** Reassemble a frontmatter block + body into full file text. */
export function serializeFrontmatter(frontmatter: string, body: string): string {
	return `---\n${frontmatter}---\n${body}`;
}

/** True iff this file text is a board. Board detection for callers that only have text. */
export function isBoardText(text: string): boolean {
	const split = splitFrontmatter(text.replace(/\r\n/g, '\n'));
	return split !== null && hasBoardMarker(split.frontmatter);
}
