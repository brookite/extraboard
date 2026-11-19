import type { OccurrenceSource } from '../model/calendar';
import type { BoardConfig } from '../model/types';
import { safeColor } from '../util/color';

/** One outline can represent a merged occurrence only if its accents agree. */
export function occurrenceAccent(
	config: BoardConfig,
	sources: readonly OccurrenceSource[],
): string | undefined {
	let accent: string | undefined;
	for (const { property } of sources) {
		const color = safeColor(config.properties.find((def) => def.name === property)?.accent);
		if (!color) continue;
		const value = color.startsWith('#') ? color.toLowerCase() : color;
		if (accent && accent !== value) return undefined;
		accent = value;
	}
	return accent;
}
