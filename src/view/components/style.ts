// Small helper to build an inline style object from optional badge colors.

export function styleFor(bg?: string, fg?: string): Record<string, string> {
	const style: Record<string, string> = {};
	if (bg) style.background = bg;
	if (fg) style.color = fg;
	return style;
}
