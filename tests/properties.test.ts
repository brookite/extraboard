import { describe, it, expect } from 'vitest';
import { parseBoardSettings, serializeSettingsBlock } from '../src/model/boardSettings';
import {
	escapeValue,
	unescapeValue,
	parseValue,
	formatValue,
	formatToken,
	validatePropertyDefs,
} from '../src/model/properties';
import type { PropertyDef } from '../src/model/types';

describe('escape/unescape', () => {
	it('round-trips special characters', () => {
		const raw = 'a;b|c}d\\e';
		expect(unescapeValue(escapeValue(raw))).toBe(raw);
	});
	it('escapes only the four special characters', () => {
		expect(escapeValue('a;b|c}d\\e')).toBe('a\\;b\\|c\\}d\\\\e');
	});
});

describe('parseValue by type', () => {
	const def = (p: Partial<PropertyDef> & { type: PropertyDef['type'] }): PropertyDef =>
		({ name: 'p', ...p });

	it('integer: valid parses, invalid drops', () => {
		expect(parseValue('p', '42', def({ type: 'integer' }))).toEqual({ name: 'p', type: 'integer', value: 42 });
		expect(parseValue('p', '-7', def({ type: 'integer' }))).toEqual({ name: 'p', type: 'integer', value: -7 });
		expect(parseValue('p', '1.5', def({ type: 'integer' }))).toBeNull();
		expect(parseValue('p', 'abc', def({ type: 'integer' }))).toBeNull();
	});

	it('percent: clamps to 0..100', () => {
		expect(parseValue('p', '150', def({ type: 'percent' }))).toEqual({ name: 'p', type: 'percent', value: 100 });
		expect(parseValue('p', '-5', def({ type: 'percent' }))).toEqual({ name: 'p', type: 'percent', value: 0 });
		expect(parseValue('p', '33', def({ type: 'percent' }))).toEqual({ name: 'p', type: 'percent', value: 33 });
	});

	it('checkbox: truthy tokens', () => {
		for (const t of ['true', 'YES', 'x', '1']) {
			expect(parseValue('p', t, def({ type: 'checkbox' }))).toEqual({ name: 'p', type: 'checkbox', value: true });
		}
		expect(parseValue('p', 'no', def({ type: 'checkbox' }))).toEqual({ name: 'p', type: 'checkbox', value: false });
	});

	it('string-list: splits, trims, drops empties', () => {
		expect(parseValue('p', 'a; b ;;c', def({ type: 'string-list' }))).toEqual({
			name: 'p', type: 'string-list', value: ['a', 'b', 'c'],
		});
	});

	it('string-list strict: filters to options', () => {
		const d = def({ type: 'string-list', strict: true, options: [{ value: 'Todo' }, { value: 'Done' }] });
		expect(parseValue('p', 'Todo; Nope; Done', d)).toEqual({ name: 'p', type: 'string-list', value: ['Todo', 'Done'] });
		expect(parseValue('p', 'Nope', d)).toBeNull();
	});

	it('string keeps empty; other types treat empty as absent', () => {
		expect(parseValue('p', '', def({ type: 'string' }))).toEqual({ name: 'p', type: 'string', value: '' });
		expect(parseValue('p', '', def({ type: 'color' }))).toBeNull();
		expect(parseValue('p', '', def({ type: 'checkbox' }))).toBeNull();
	});

	it('undeclared property becomes raw list', () => {
		expect(parseValue('p', 'x; y', undefined)).toEqual({ name: 'p', type: 'raw', value: ['x', 'y'] });
	});

	it('date family preserves raw text', () => {
		expect(parseValue('p', '2026-07-24', def({ type: 'datetime' }))).toEqual({ name: 'p', type: 'datetime', raw: '2026-07-24' });
	});
});

describe('formatValue round-trips through parseValue', () => {
	it('string-list canonical separator', () => {
		const pv = parseValue('p', 'a;b;c', { name: 'p', type: 'string-list' })!;
		expect(formatValue(pv)).toBe('a; b; c');
	});
	it('escaped list element survives', () => {
		const pv = parseValue('p', 'a\\;b; c', { name: 'p', type: 'string-list' })!;
		expect(pv).toEqual({ name: 'p', type: 'string-list', value: ['a;b', 'c'] });
		expect(formatValue(pv)).toBe('a\\;b; c');
	});
	it('formatToken wraps correctly', () => {
		const pv = parseValue('status', 'Doing', { name: 'status', type: 'string' })!;
		expect(formatToken(pv)).toBe('@{status|Doing}');
	});
});

describe('validatePropertyDefs', () => {
	// Since M5 only `color` is a singleton: the card checkbox is a task marker,
	// so `checkbox` is an ordinary named boolean badge (properties.md).
	it('flags a second color and misplaced options', () => {
		const diags = validatePropertyDefs([
			{ name: 'c1', type: 'color' },
			{ name: 'c2', type: 'color' },
			{ name: 'f1', type: 'checkbox' },
			{ name: 'f2', type: 'checkbox' },
			{ name: 'bad', type: 'integer', strict: true },
		]);
		expect(diags.length).toBe(2);
	});
	it('flags a timespan setting only where the time itself is off', () => {
		expect(
			validatePropertyDefs([{ name: 'due', type: 'datetime', time: 'none', timespan: true }]),
		).toEqual([{ kind: 'timespanNeedsTime', name: 'due' }]);
		// An absent `time` is `optional`, so a timespan setting is meaningful.
		expect(validatePropertyDefs([{ name: 'due', type: 'datetime', timespan: false }])).toEqual([]);
	});
	it('accepts a valid config', () => {
		expect(validatePropertyDefs([
			{ name: 'status', type: 'string-list', strict: true, options: [{ value: 'A' }] },
			{ name: 'due', type: 'datetime', time: 'optional' },
			{ name: 'slot', type: 'date-list', time: 'required', timespan: false },
			{ name: 'flag', type: 'checkbox' },
		])).toEqual([]);
	});
});

// `PropertyDef.timespan` (properties.md §time): absent is "allowed", so only an
// explicit `false` is stored — and it has to survive the settings block.
describe('the timespan setting in the settings block', () => {
	const bodyOf = (settings: Record<string, unknown>): string =>
		'```extraboard-settings\n' + JSON.stringify(settings, null, 2) + '\n```\n\n## Todo\n';

	it('reads an explicit false and leaves a property that says nothing alone', () => {
		const defs = [
			{ name: 'due', type: 'datetime', time: 'optional', timespan: false },
			{ name: 'slot', type: 'datetime', time: 'optional' },
		];
		const { config } = parseBoardSettings(bodyOf({ version: 1, properties: defs }));
		expect(config.properties).toEqual(defs);
		expect(config.properties[1]?.timespan).toBeUndefined();
	});

	it('writes it back unchanged', () => {
		const defs = [{ name: 'due', type: 'datetime', time: 'required', timespan: false }];
		const { config } = parseBoardSettings(bodyOf({ version: 1, properties: defs }));
		const round = parseBoardSettings(serializeSettingsBlock(config));
		expect(round.config.properties).toEqual(defs);
	});
});
