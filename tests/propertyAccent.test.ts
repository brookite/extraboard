// A property's badge accent (`PropertyDef.accent`): it survives the settings
// block untouched, because the color is stored verbatim and guarded only where
// it is rendered (view/components/PropertyBadge.tsx).

import { describe, expect, it } from 'vitest';
import { parseBoardSettings, serializeSettingsBlock } from '../src/model/boardSettings';

/** A board body whose settings block carries `settings`, followed by a stack. */
function bodyOf(settings: Record<string, unknown>): string {
	return '```extraboard-settings\n' + JSON.stringify(settings, null, 2) + '\n```\n\n## Todo\n';
}

const defs = [
	{ name: 'due', type: 'datetime', accent: '#e93147' },
	{ name: 'done', type: 'datetime', accent: 'var(--color-green)' },
	{ name: 'notes', type: 'string' },
];

describe('property accent in the settings block', () => {
	it('reads an accent of any CSS notation, and leaves a property without one alone', () => {
		const { config } = parseBoardSettings(bodyOf({ version: 1, properties: defs }));
		expect(config.properties).toEqual(defs);
	});

	it('writes it back unchanged', () => {
		const { config } = parseBoardSettings(bodyOf({ version: 1, properties: defs }));
		const round = parseBoardSettings(serializeSettingsBlock(config));
		expect(round.config.properties).toEqual(config.properties);
	});

	it('treats an empty accent as no accent rather than a color to render', () => {
		const { config } = parseBoardSettings(
			bodyOf({ version: 1, properties: [{ name: 'due', type: 'datetime', accent: '' }] }),
		);
		expect(config.properties[0]?.accent).toBeUndefined();
		expect(serializeSettingsBlock(config)).not.toContain('accent');
	});
});
