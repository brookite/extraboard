// Board file text for fixtures: the frontmatter marker plus a canonical
// `extraboard-settings` block, so a test only has to spell out its body. The
// settings go through `toConfig` first, which makes the head exactly what
// `serializeBoard` writes — fixtures stay round-trip fixed points.

import { serializeSettingsBlock, toConfig } from '../src/model/boardSettings';

/** Head of a board file — frontmatter + settings block — without a trailing newline. */
export function boardHead(settings: Record<string, unknown> = {}): string {
	const block = serializeSettingsBlock(toConfig({ version: 1, ...settings }));
	return `---\nextraboard: true\n---\n${block}`.replace(/\n$/, '');
}
