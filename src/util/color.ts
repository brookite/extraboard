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

/** A resolved color: opaque `#rrggbb` plus the alpha that was taken off it. */
export interface ResolvedColor {
	/** Lower-case `#rrggbb`, what `<input type="color">` accepts. */
	hex: string;
	/** 0–1. `1` for every color that carries no alpha. */
	alpha: number;
}

const clamp255 = (n: number): string =>
	Math.max(0, Math.min(255, Math.round(n)))
		.toString(16)
		.padStart(2, '0');

/**
 * Split any CSS color into an opaque hex and its alpha. Resolved through the
 * browser (so named colors, `rgba(…)` and `var(--…)` all work), using `host`
 * for the lookup context; `null` when the value is not a color at all.
 *
 * The two callers want opposite halves of this — the native input wants the hex
 * with the alpha stripped, the opacity slider wants the alpha — so it is
 * resolved once and split, rather than probed twice.
 */
export function resolveColor(value: string | undefined, host: HTMLElement): ResolvedColor | null {
	const safe = safeColor(value);
	if (safe === null) return null;
	if (/^#[0-9a-f]{6}$/i.test(safe)) return { hex: safe.toLowerCase(), alpha: 1 };
	if (/^#[0-9a-f]{8}$/i.test(safe)) {
		return {
			hex: safe.slice(0, 7).toLowerCase(),
			alpha: Number.parseInt(safe.slice(7), 16) / 255,
		};
	}

	const probe = host.ownerDocument.createElement('span');
	probe.className = 'eb-color-probe';
	probe.style.color = safe;
	host.appendChild(probe);
	const computed = getComputedStyle(probe).color;
	probe.remove();

	const parts = /^rgba?\(([^)]+)\)$/.exec(computed)?.[1]?.split(/[\s,/]+/);
	if (!parts || parts.length < 3) return null;
	const alpha = parts.length > 3 ? Number(parts[3]) : 1;
	return {
		hex: `#${clamp255(Number(parts[0]))}${clamp255(Number(parts[1]))}${clamp255(Number(parts[2]))}`,
		alpha: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
	};
}

/**
 * Best-effort `#rrggbb` for any CSS color, because the native color input
 * accepts nothing else. Alpha is dropped — see {@link resolveColor} to keep it.
 */
export function toHexColor(value: string | undefined, host: HTMLElement): string | null {
	return resolveColor(value, host)?.hex ?? null;
}

/**
 * `#rrggbb` + alpha → the value we store. Eight-digit hex rather than `rgba()`:
 * it is the same notation the opaque case already uses, so a color stays one
 * token the user can read, retype and paste. A fully opaque color keeps its
 * six-digit form so nothing that was already written gains a redundant `ff`.
 */
export function withAlpha(hex: string, alpha: number): string {
	const a = Math.max(0, Math.min(1, alpha));
	if (a >= 1) return hex;
	return `${hex}${clamp255(a * 255)}`;
}

/**
 * Black or white, whichever reads better on `hex` (`#rrggbb`). WCAG relative
 * luminance, compared against the point where white and black text reach the
 * same contrast ratio; a value that is not a plain six-digit hex is treated as
 * a light background, the safer guess for Obsidian's default themes.
 */
export function contrastText(hex: string): '#000000' | '#ffffff' {
	const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
	if (digits === undefined) return '#000000';
	const packed = Number.parseInt(digits, 16);
	const linear = (byte: number): number => {
		const c = byte / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	const luminance =
		0.2126 * linear((packed >> 16) & 0xff) +
		0.7152 * linear((packed >> 8) & 0xff) +
		0.0722 * linear(packed & 0xff);
	return luminance > 0.179 ? '#000000' : '#ffffff';
}

const readableCache = new Map<string, string | undefined>();

/**
 * `contrastText` for any CSS color, including `var(--…)`: the value is resolved
 * through the DOM probe once and memoized, because this runs per badge on every
 * board render. `undefined` when the color cannot be resolved — the badge then
 * keeps the theme's own text color.
 */
export function readableOn(color: string, host: HTMLElement): string | undefined {
	if (readableCache.has(color)) return readableCache.get(color);
	const hex = toHexColor(color, host);
	const text = hex === null ? undefined : contrastText(hex);
	readableCache.set(color, text);
	return text;
}

/**
 * Drop the memoized text colors. A theme switch can change what `var(--…)`
 * resolves to, so the plugin clears the cache on `css-change`.
 */
export function clearReadableCache(): void {
	readableCache.clear();
}
