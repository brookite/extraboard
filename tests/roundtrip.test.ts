import { describe, it, expect } from 'vitest';
import { parseBoard, parseBody } from '../src/model/parse';
import { serializeBoard, serializeBody } from '../src/model/serialize';
import { serializeSettingsBlock } from '../src/model/boardSettings';
import type { Board, BoardConfig } from '../src/model/types';
import { newBoardConfig, newBoardText } from '../src/util/newBoard';

const bodyConfig: BoardConfig = {
	version: 1,
	views: [{ id: 'v1', name: 'Board', type: 'kanban' }],
	activeView: 'v1',
	properties: [
		{ name: 'status', type: 'string-list', strict: true, options: [{ value: 'Todo' }, { value: 'Doing' }, { value: 'Done' }] },
		{ name: 'priority', type: 'integer' },
		{ name: 'progress', type: 'percent' },
	],
	tagColors: {},
};

function boardFromBody(body: string, config: BoardConfig): Board {
	const { preamble, stacks } = parseBody(body, config);
	return { config, frontmatter: null, preamble, stacks, trailing: '' };
}

describe('body: canonical fixed point', () => {
	const canonical =
		'## To Do\n' +
		'- Buy milk @{status|Todo} #groceries\n' +
		'- Call Bob @{priority|2}\n' +
		'\n' +
		'## Doing %%collapsed%%\n' +
		'- Write spec @{status|Doing} @{progress|40} #work #urgent\n' +
		'### Later\n' +
		'- Deferred task\n' +
		'---\n' +
		'- After unnamed divider\n';

	it('serializeBody(parseBody(x)) === x', () => {
		expect(serializeBody(boardFromBody(canonical, bodyConfig))).toBe(canonical);
	});

	it('parses the expected structure', () => {
		const { stacks } = parseBody(canonical, bodyConfig);
		expect(stacks).toHaveLength(2);
		expect(stacks[0]!.name).toBe('To Do');
		expect(stacks[0]!.collapsed).toBe(false);
		expect(stacks[1]!.name).toBe('Doing');
		expect(stacks[1]!.collapsed).toBe(true);

		const items = stacks[1]!.items;
		expect(items.map((i) => i.kind)).toEqual(['card', 'divider', 'card', 'divider', 'card']);

		const first = items[0]!;
		expect(first.kind).toBe('card');
		if (first.kind === 'card') {
			expect(first.card.title).toBe('Write spec');
			expect(first.card.tags).toEqual(['work', 'urgent']);
			expect(first.card.properties).toEqual([
				{ name: 'status', type: 'string-list', value: ['Doing'] },
				{ name: 'progress', type: 'percent', value: 40 },
			]);
		}

		const namedDivider = items[1]!;
		expect(namedDivider.kind).toBe('divider');
		if (namedDivider.kind === 'divider') expect(namedDivider.divider.name).toBe('Later');

		const hr = items[3]!;
		expect(hr.kind).toBe('divider');
		if (hr.kind === 'divider') expect(hr.divider.name).toBeUndefined();
	});
});

describe('body: preamble handling', () => {
	it('preserves prose before the first stack', () => {
		const body = '# My Board\n\nintro text\n\n## S\n- card\n';
		const board = boardFromBody(body, bodyConfig);
		expect(board.preamble).toBe('# My Board\n\nintro text\n\n');
		expect(serializeBody(board)).toBe(body);
	});

	it('distinguishes a leading blank line from no preamble', () => {
		const withBlank = boardFromBody('\n## S\n- c\n', bodyConfig);
		expect(withBlank.preamble).toBe('\n');
		expect(serializeBody(withBlank)).toBe('\n## S\n- c\n');

		const noPreamble = boardFromBody('## S\n- c\n', bodyConfig);
		expect(noPreamble.preamble).toBe('');
		expect(serializeBody(noPreamble)).toBe('## S\n- c\n');
	});

	it('a file with no stacks is all preamble', () => {
		const body = 'just notes\nno board here\n';
		const board = boardFromBody(body, bodyConfig);
		expect(board.stacks).toHaveLength(0);
		expect(serializeBody(board)).toBe(body);
	});
});

describe('body: normalization then idempotence for messy input', () => {
	it('reorders tokens/tags and collapses spacing, then is stable', () => {
		const messy = '## S\n- Task #tag @{priority|3}   extra\n';
		const once = serializeBody(boardFromBody(messy, bodyConfig));
		expect(once).toBe('## S\n- Task extra @{priority|3} #tag\n');
		const twice = serializeBody(boardFromBody(once, bodyConfig));
		expect(twice).toBe(once);
	});

	it('drops an invalid strict value on normalization', () => {
		const input = '## S\n- Card @{status|Nope}\n';
		const once = serializeBody(boardFromBody(input, bodyConfig));
		expect(once).toBe('## S\n- Card\n');
	});
});

describe('full file: frontmatter + settings block + body round-trip', () => {
	const input =
		'---\n' +
		'aliases:\n' +
		'  - Project Board\n' +
		'extraboard: "Board"\n' +
		'# a trailing comment\n' +
		'---\n' +
		'```extraboard-settings\n' +
		JSON.stringify(
			{
				version: 1,
				views: [{ id: 'v1', name: 'Board', type: 'kanban' }],
				properties: [{ name: 'priority', type: 'integer' }],
			},
			null,
			2,
		) +
		'\n```\n' +
		'## Backlog\n' +
		'- Item one @{priority|1} #a\n';

	it('is a fixed point (idempotent)', () => {
		const once = serializeBoard(parseBoard(input));
		const twice = serializeBoard(parseBoard(once));
		expect(twice).toBe(once);
	});

	it('preserves foreign frontmatter keys and comments', () => {
		const once = serializeBoard(parseBoard(input));
		expect(once).toContain('aliases:');
		expect(once).toContain('Project Board');
		expect(once).toContain('# a trailing comment');
	});

	it('reads config and marks the file as a board', () => {
		const board = parseBoard(input);
		expect(board.config.views).toEqual([{ id: 'v1', name: 'Board', type: 'kanban' }]);
		expect(board.config.properties).toEqual([{ name: 'priority', type: 'integer' }]);
		expect(board.stacks).toHaveLength(1);
		expect(board.stacks[0]!.name).toBe('Backlog');
	});

	it('normalizes CRLF to LF', () => {
		const crlf = input.replace(/\n/g, '\r\n');
		expect(serializeBoard(parseBoard(crlf))).not.toContain('\r');
	});

	it('writes settings as compact JSON without escaping Unicode', () => {
		const config: BoardConfig = {
			...bodyConfig,
			cardContentDir: 'Карточки',
			properties: [{ name: 'важность', type: 'integer' }],
		};

		expect(serializeSettingsBlock(config)).toBe(
			'```extraboard-settings\n' +
			'{"version":1,"views":[{"id":"v1","name":"Board","type":"kanban"}],"cardContentDir":"Карточки","properties":[{"name":"важность","type":"integer"}]}\n' +
			'```\n',
		);
	});
});

describe('a freshly created board file', () => {
	const text = newBoardText(newBoardConfig([{ name: 'priority', type: 'integer' }]));

	it('carries the marker and a settings block, and is a fixed point', () => {
		expect(text.startsWith('---\nextraboard: "Board"\n---\n```extraboard-settings\n')).toBe(true);
		expect(serializeBoard(parseBoard(text))).toBe(text);
	});

	it('reads back the configuration it was created with', () => {
		expect(parseBoard(text).config.properties).toEqual([{ name: 'priority', type: 'integer' }]);
		expect(parseBoard(text).stacks.map((s) => s.name)).toEqual(['To do', 'In progress', 'Done']);
	});
});
