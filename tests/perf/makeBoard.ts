// Generates the large board M10 Part B is measured against.
// Plan: docs/plans/m10-perf.md §1. Not a shipped artifact — a fixture generator.
//
//   npm run perf:fixture -- ".testvault/Large board.md"
//
// It builds the board **through the model's own ops and serializer**, never by
// writing Markdown by hand: the fixture is then canonical by construction, and a
// format change can never leave a silently malformed board to measure against.
// The result is re-parsed and checked for the fixed point before it is written.

import { writeFileSync } from 'node:fs';
import { parseBoard } from '../../src/model/parse';
import { serializeBoard } from '../../src/model/serialize';
import * as ops from '../../src/model/ops';
import type { Board } from '../../src/model/types';
import type { ChecklistItem } from '../../src/model/checklist';
import { addDays, dayKey, today } from '../../src/model/dates';

const STACKS = 12;
const CARDS_PER_STACK = 50;
/** Cards that end up in the archive: enough for it to weigh something, so
 * "opening a board does not cost what its archive weighs" stays measurable. */
const ARCHIVED = 60;
/** A divider every N cards, so groups (and their inherited colors) are exercised. */
const DIVIDER_EVERY = 12;

const STACK_NAMES = [
	'Inbox',
	'Triage',
	'Ready',
	'In progress',
	'Blocked',
	'In review',
	'QA',
	'Staging',
	'Docs',
	'Release',
	'Follow-up',
	'Done',
];

const STATUSES = ['Todo', 'In progress', 'In review', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const ASSIGNEES = ['Alex', 'Blair', 'Kim', 'Sam', 'Robin'];
const TAGS = ['feature', 'bug', 'chore', 'urgent', 'backend/api', 'frontend'];
const COLORS = ['#0ea5e9', '#8b5cf6', '#16a34a', '#f97316', '#ef4444'];

/** The `extraboard` node, written once; everything below it is built by ops. */
const FRONTMATTER = `---
extraboard:
  version: 1
  views:
    - id: v1
      name: Board
      type: kanban
    - id: v2
      name: Calendar
      type: calendar
      dateProperty: due
      mode: month
  properties:
    - name: status
      type: string-list
      strict: true
      options:
        - value: Todo
          bg: "#64748b"
          fg: "#ffffff"
        - value: In progress
          bg: "#2563eb"
          fg: "#ffffff"
        - value: In review
          bg: "#d97706"
          fg: "#ffffff"
        - value: Done
          bg: "#16a34a"
          fg: "#ffffff"
    - name: priority
      type: string-list
      strict: false
    - name: assignee
      type: string
    - name: progress
      type: percent
    - name: points
      type: integer
    - name: done
      type: checkbox
    - name: accent
      type: color
    - name: due
      type: datetime
    - name: sprint
      type: date-range
    - name: repeat
      type: recurrence
    - name: dates
      type: date-list
  dateHighlights:
    - when: before
      amount: 2
      unit: day
      color: "#f59e0b"
    - when: after
      amount: 0
      unit: day
      color: "#ef4444"
  tagColors:
    urgent:
      bg: "#ef4444"
      fg: "#ffffff"
    bug:
      bg: "#dc2626"
      fg: "#ffffff"
---
`;

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!;

/**
 * One card's raw text, the same string the composer would be given. Every
 * property type the board declares appears somewhere, because the render cost
 * being measured is mostly badges.
 */
function cardText(stack: number, i: number): string {
	const base = today();
	const due = addDays(base, (i % 40) - 10);
	const parts = [`${pick(STACK_NAMES, stack)} task ${String(i + 1)}`];
	parts.push(`@{status|${pick(STATUSES, stack + i)}}`);
	parts.push(`@{priority|${pick(PRIORITIES, i)}}`);
	if (i % 2 === 0) parts.push(`@{assignee|${pick(ASSIGNEES, i)}}`);
	if (i % 3 === 0) parts.push(`@{progress|${String((i * 7) % 101)}}`);
	if (i % 5 === 0) parts.push(`@{points|${String((i % 8) + 1)}}`);
	if (i % 7 === 0) parts.push(`@{done|${i % 14 === 0 ? 'true' : 'false'}}`);
	if (i % 11 === 0) parts.push(`@{accent|${pick(COLORS, i)}}`);

	// The date family, which is what the highlight rules and the calendar read.
	if (i % 4 === 0) {
		parts.push(`@{due|${dayKey(due)} ${String(9 + (i % 8)).padStart(2, '0')}:00}`);
	} else if (i % 4 === 1) {
		parts.push(`@{due|${dayKey(due)}}`);
	} else if (i % 4 === 2) {
		parts.push(`@{sprint|${dayKey(due)} → ${dayKey(addDays(due, 4))}}`);
	} else if (i % 8 === 3) {
		parts.push(`@{repeat|every week on Mon, Thu from ${dayKey(due)}}`);
	} else {
		parts.push(`@{dates|${dayKey(due)}; ${dayKey(addDays(due, 3))}}`);
	}

	parts.push(`#${pick(TAGS, i)}`);
	if (i % 6 === 0) parts.push(`#${pick(TAGS, i + 3)}`);
	return parts.join(' ');
}

/** A three-level checklist, so the progress indicator has something to count. */
function checklistFor(i: number): ChecklistItem[] {
	return [
		{
			marker: i % 2 === 0 ? 'x' : ' ',
			text: 'Prepare',
			children: [
				{ marker: 'x', text: 'Gather the inputs', children: [] },
				{ marker: ' ', text: 'Confirm the scope', children: [] },
			],
		},
		{ marker: i % 3 === 0 ? 'x' : ' ', text: 'Do the work', children: [] },
		{ marker: ' ', text: 'Hand over', children: [] },
	];
}

function buildStack(board: Board, stack: number): Board {
	let next = ops.addStack(board, STACK_NAMES[stack] ?? `Stack ${String(stack + 1)}`, null, stack === STACKS - 1);
	for (let i = 0; i < CARDS_PER_STACK; i++) {
		// A named, colored divider heads every group: the band is part of what a
		// stack costs to draw.
		if (i > 0 && i % DIVIDER_EVERY === 0) {
			next = ops.addDivider(next, stack, `Group ${String(i / DIVIDER_EVERY)}`, null);
			const at = next.stacks[stack]!.items.length - 1;
			next = ops.setDividerColor(next, { stack, item: at }, pick(COLORS, i + stack));
		}
		next = ops.addCard(next, stack, cardText(stack, i), null);
		if (i % 3 !== 0) continue;
		const item = next.stacks[stack]!.items.length - 1;
		next = ops.updateChecklist(next, { stack, item }, () => checklistFor(i));
	}
	return next;
}

/**
 * The archive is filled the way the plugin fills it: a scratch stack whose
 * deletion archives every card in it (archive.md §5.6), so the origin markers
 * are real rather than invented.
 */
function fillArchive(board: Board): Board {
	let next = ops.addStack(board, 'Retired', null, false);
	const stack = next.stacks.length - 1;
	for (let i = 0; i < ARCHIVED; i++) {
		next = ops.addCard(next, stack, cardText(stack, i), null);
	}
	return ops.deleteStack(next, stack, {});
}

function main(): void {
	const target = process.argv[2] ?? '.testvault/Large board.md';
	let board = parseBoard(FRONTMATTER);
	for (let s = 0; s < STACKS; s++) board = buildStack(board, s);
	board = fillArchive(board);

	const text = serializeBoard(board);
	// The fixture must be a fixed point of the round trip, or every measurement
	// taken against it is measuring a file the plugin would rewrite on open.
	const again = serializeBoard(parseBoard(text));
	if (again !== text) throw new Error('generated board is not a round-trip fixed point');

	writeFileSync(target, text, 'utf8');
	const cards = board.stacks.reduce(
		(n, stack) => n + stack.items.filter((item) => item.kind === 'card').length,
		0,
	);
	console.log(
		`Wrote ${target}: ${String(board.stacks.length)} stacks, ${String(cards)} cards, ` +
			`${String(ARCHIVED)} archived, ${String(Math.round(text.length / 1024))} KB`,
	);
}

main();
