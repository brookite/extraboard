// Small helpers to build inline styles from user-supplied colors.

export function styleFor(bg?: string, fg?: string): Record<string, string> {
	const style: Record<string, string> = {};
	if (bg) style.background = bg;
	if (fg) style.color = fg;
	return style;
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Colors come from the board file, so they are validated before being written
 * into an inline style: anything the browser does not accept as a color (such
 * as a value smuggling extra declarations) is ignored rather than rendered.
 */
export function safeColor(value: string | undefined): string | null {
	const v = value?.trim();
	if (!v) return null;
	if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
		return CSS.supports('color', v) ? v : null;
	}
	return HEX_RE.test(v) ? v : null;
}
