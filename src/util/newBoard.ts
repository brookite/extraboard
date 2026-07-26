// Content of a freshly created board file.

import { configToDoc, serializeFrontmatter } from '../model/frontmatter';
import type { BoardConfig, PropertyDef } from '../model/types';
import { defaultBoardConfig } from '../model/types';

const NEW_BOARD_BODY = '## To do\n\n## In progress\n\n## Done\n';

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
	return serializeFrontmatter(configToDoc(config), NEW_BOARD_BODY);
}

export const NEW_BOARD_BASENAME = 'Untitled board';
