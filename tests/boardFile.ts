// Board file text for fixtures: the frontmatter marker plus a canonical
// `extraboard-settings` block, so a test only has to spell out its body. The
// settings go through `toConfig` first, which makes the head exactly what
// `serializeBoard` writes — fixtures stay round-trip fixed points.

import { serializeSettingsBlock, toConfig } from '../src/model/boardSettings';
import { withBoardMarker } from '../src/model/frontmatter';
import { activeViewOf } from '../src/model/views';

/** Head of a board file — frontmatter + settings block — without a trailing newline. */
export function boardHead(settings: Record<string, unknown> = {}): string {
	const config = toConfig({ version: 1, ...settings });
	const block = serializeSettingsBlock(config);
	return `---\n${withBoardMarker(null, activeViewOf(config).name)}---\n${block}`.replace(/\n$/, '');
}
