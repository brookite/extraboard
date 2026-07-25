// Color helpers shared by the board view and the settings UI.
// Colors are stored verbatim (any CSS color), so everything that renders one
// has to guard it, and everything that hands one to `<input type="color">` has
// to reduce it to `#rrggbb` first.

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

/**
 * Best-effort `#rrggbb` for any CSS color, because the native color input
 * accepts nothing else. Resolved through the browser (so named colors and
 * `var(--…)` work), using `host` for the lookup context; `null` when the value
 * is not a color at all.
 */
export function toHexColor(value: string | undefined, host: HTMLElement): string | null {
	const safe = safeColor(value);
	if (safe === null) return null;
	if (/^#[0-9a-f]{6}$/i.test(safe)) return safe.toLowerCase();

	const probe = host.ownerDocument.createElement('span');
	probe.className = 'eb-color-probe';
	probe.style.color = safe;
	host.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();

	const parts = /^rgba?\(([^)]+)\)$/.exec(computed)?.[1]?.split(/[\s,/]+/);
	if (!parts || parts.length < 3) return null;
	const channel = (raw: string): string =>
		Math.max(0, Math.min(255, Math.round(Number(raw))))
			.toString(16)
			.padStart(2, '0');
	return `#${channel(parts[0]!)}${channel(parts[1]!)}${channel(parts[2]!)}`;
}
