// Heading markers: the `%%…%%` inline comments a stack or divider heading may
// carry. Spec: docs/specs/markdown-format.md §3.1,
// stack-completion-and-divider-colors.md §1. Pure; no `obsidian`.
//
// One module owns the escaping rule, so the archive's `%%from|…%%` marker
// (archive.ts) and the divider's `%%color|…%%` marker cannot drift apart.

/**
 * A marker value is escaped (`%` -> `\%`, `\` -> `\\`) so the closing `%%` can
 * never be ambiguous: `hsl(30 100% 50%)` is a color a user can pick.
 */
export function escapeMarker(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%');
}

export function unescapeMarker(raw: string): string {
	return raw.replace(/\\([\s\S])/g, '$1');
}

/**
 * Matches an escaped marker value: an escape is always consumed as a unit, and
 * a bare `%` cannot appear at all — that is what makes the closing `%%`
 * unambiguous, and what stops a value from swallowing the marker after it.
 */
export const MARKER_VALUE = '(?:\\\\[\\s\\S]|[^\\\\%])*?';

/** Markers a heading line can carry, in the order they are written back (§1.1). */
export interface HeadingMarkers {
	/** `%%completes%%` — a stack completes the cards entering it (§3). */
	completes: boolean;
	/** `%%color|…%%` — a named divider's color, verbatim (§4). */
	color?: string;
	/** `%%collapsed%%` — written last, so a collapse toggle reorders nothing. */
	collapsed: boolean;
}

/** Which heading carries the markers: they differ in what they may hold (§1.1). */
export type HeadingKind = 'stack' | 'divider';

// One trailing marker: recognized ones are stripped, anything else stays in the
// name. Non-greedy value + `$` anchor, so the token is taken from the end.
// `%%completes%%` only means something on a stack and `%%color|…%%` only on a
// divider, so each heading recognizes its own pair — on the other one the token
// is ordinary text and survives verbatim.
// Group 1 is the text before the marker, group 2 is `collapsed`, and group 3 is
// the kind's own marker: `completes` on a stack, the color value on a divider.
const TRAILING_RE: Record<HeadingKind, RegExp> = {
	stack: /^(.*?)\s*%%(?:(collapsed)|(completes))%%\s*$/,
	divider: new RegExp(`^(.*?)\\s*%%(?:(collapsed)|color\\|(${MARKER_VALUE}))%%\\s*$`),
};

/**
 * Split the recognized markers off a heading's text. They may appear in any
 * order and repeat; the remaining text (trimmed) is the stack/divider name.
 */
export function stripMarkers(
	text: string,
	kind: HeadingKind,
): { text: string; markers: HeadingMarkers } {
	const markers: HeadingMarkers = { completes: false, collapsed: false };
	const re = TRAILING_RE[kind];
	let rest = text;
	for (;;) {
		const m = re.exec(rest);
		if (!m) break;
		if (m[2] !== undefined) markers.collapsed = true;
		else if (kind === 'stack') markers.completes = true;
		else {
			const color = unescapeMarker(m[3] ?? '').trim();
			// An empty value means "no color" (§1.2) and is simply dropped. The last
			// marker read is the outermost one, so an earlier color wins.
			if (color) markers.color = color;
		}
		rest = m[1] ?? '';
	}
	return { text: rest.trim(), markers };
}

/** A heading line's text: the name followed by its markers in canonical order. */
export function withMarkers(name: string, markers: Partial<HeadingMarkers>): string {
	const parts = [name];
	if (markers.completes) parts.push('%%completes%%');
	if (markers.color) parts.push(`%%color|${escapeMarker(markers.color)}%%`);
	if (markers.collapsed) parts.push('%%collapsed%%');
	return parts.filter(Boolean).join(' ');
}
