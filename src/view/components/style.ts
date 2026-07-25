// Small helpers to build inline styles from user-supplied colors.

export { safeColor } from '../../util/color';

export function styleFor(bg?: string, fg?: string): Record<string, string> {
	const style: Record<string, string> = {};
	if (bg) style.background = bg;
	if (fg) style.color = fg;
	return style;
}
