// The vault's tag index, reached through `metadataCache.getTags()` — present
// since forever but **undocumented** (`obsidian.d.ts` 1.12.3 does not declare
// it), so it is read through a structural type and every failure degrades to an
// empty list (docs/NOTICES.md, "Accepted API risks").

import type { App } from 'obsidian';

/** `{ '#tag': useCount }`, tags spelled as the vault first saw them. */
interface TagIndex {
	getTags?(): Record<string, number>;
}

/**
 * Tags used anywhere in the vault, most-used first and without their `#`. The
 * whole index: the tag picker filters and virtualizes it itself, so nothing is
 * dropped before the user has had a chance to search for it.
 */
export function vaultTags(app: App): string[] {
	let index: Record<string, number>;
	try {
		const cache = app.metadataCache as App['metadataCache'] & TagIndex;
		if (typeof cache.getTags !== 'function') return [];
		index = cache.getTags();
	} catch (err) {
		console.warn('Extraboard: vault tag index unavailable', err);
		return [];
	}
	return Object.entries(index)
		.sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
		.map(([tag]) => tag.replace(/^#/, ''))
		.filter(Boolean);
}
