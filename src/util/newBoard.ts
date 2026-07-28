// Content of a freshly created board file.

import { serializeSettingsBlock } from '../model/boardSettings';
import { serializeFrontmatter, withBoardMarker } from '../model/frontmatter';
import type { BoardConfig, PropertyDef } from '../model/types';
import { defaultBoardConfig } from '../model/types';
import { activeViewOf } from '../model/views';

// The leading blank line separates the settings block from the first stack; it
// is ordinary preamble, so it round-trips like any other body text.
const NEW_BOARD_BODY = '\n## To do\n\n## In progress\n\n## Done\n';

/**
 * Configuration a new board starts from: the plugin's `defaultProperties`
 * (settings.md) are a starting point the creation dialog can adjust, and the
 * board owns its copy from then on.
 */
export function newBoardConfig(properties: PropertyDef[]): BoardConfig {
	return { ...defaultBoardConfig(), properties };
}

/** File content of a new board with the given configuration. */
export function newBoardText(config: BoardConfig): string {
	return serializeFrontmatter(
		withBoardMarker(null, activeViewOf(config).name),
		serializeSettingsBlock(config) + NEW_BOARD_BODY,
	);
}

export const NEW_BOARD_BASENAME = 'Untitled board';
