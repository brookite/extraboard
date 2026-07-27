/*
 * The M10 Part B measurement harness. Plan: docs/plans/m10-perf.md §1.
 * Not a shipped artifact and not imported by anything: it is pasted into
 * Obsidian's developer console (Ctrl/Cmd+Shift+I) with the large board open.
 *
 * Why a console script rather than instrumentation in the plugin: the numbers
 * are wanted a handful of times, and `performance.mark` calls compiled into
 * `main.js` would be dead weight in every user's bundle — which is the very
 * cost §6 is about.
 *
 * How to run
 * ----------
 *   1. npm run perf:fixture -- ".testvault/Large board.md"   (once)
 *   2. Open that board in Obsidian, on the Kanban view.
 *   3. Paste this whole file into the console and press Enter.
 *   4. For the mobile column: app.emulateMobile(true), reload the app, repeat.
 *
 * It reports the median of N runs for the three numbers the plan asks for.
 * Note that "one edit" really does write the file — run it on the fixture, not
 * on a board you care about.
 */

(async () => {
	const RUNS = 7;
	const VIEW_TYPE = 'extraboard-board';

	const leaf = app.workspace.getLeavesOfType(VIEW_TYPE)[0];
	const view = leaf?.view;
	if (!view || !view.board) {
		console.error('Extraboard perf: open a board in the board view first.');
		return;
	}

	/** Resolves after the frame the mutation was painted in. */
	const painted = () =>
		new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(resolve));
		});

	async function time(fn) {
		const started = performance.now();
		fn();
		await painted();
		return performance.now() - started;
	}

	const median = (values) => {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	};

	/**
	 * Re-parse into the **live** tree: `setViewData` → `parseBoard` → diff → paint.
	 * Preact reuses the mounted DOM here, so this is what an external change to
	 * the file costs — *not* what opening a board costs. It was labelled "open"
	 * in the first readings and that was wrong; see `coldOpen`.
	 */
	const reparse = async () => {
		const data = view.data;
		return time(() => {
			view.setViewData(data, true);
		});
	};

	/**
	 * A genuine cold open: `clear()` unmounts the Preact tree, so the following
	 * `setViewData` parses *and* builds every node from scratch — the DOM, the
	 * Sortable instances, the Markdown renders. This is the number that answers
	 * "what does opening this board cost", and the one the first readings missed.
	 */
	const coldOpen = async () => {
		const data = view.data;
		return time(() => {
			view.clear();
			view.setViewData(data, true);
		});
	};

	/**
	 * One edit: `applyEdit` → re-serialize → re-render, for a single card title.
	 * The mutation is written out here rather than taken from `ops` (which is not
	 * on `window`) and deliberately mirrors what ops do — every object the edit
	 * did not touch keeps its identity, which is the precondition `memo` rests
	 * on. An edit that rebuilt the board would measure the wrong thing.
	 */
	const edit = async (n) => {
		const board = view.board;
		const stacks = board.stacks.slice();
		const items = stacks[0].items.slice();
		const at = items.findIndex((item) => item.kind === 'card');
		items[at] = { kind: 'card', card: { ...items[at].card, title: `perf run ${n}` } };
		stacks[0] = { ...stacks[0], items };
		return time(() => {
			view.applyEdit(() => ({ ...board, stacks }));
		});
	};

	/**
	 * View switch, including the calendar's placement pass.
	 *
	 * `nextView` cycles, so consecutive runs alternate direction — and the two
	 * directions do not cost the same thing at all (mounting a calendar grid vs.
	 * mounting a stack row). Averaging them produces a median that describes
	 * neither, so each sample is tagged with the view it switched *to* and the
	 * two are reported separately. This is the harness's own correction, made
	 * after the first mobile readings came back bimodal.
	 */
	const activeType = () => {
		const config = view.board.config;
		const active = config.views.find((v) => v.id === config.activeView) ?? config.views[0];
		return active?.type ?? '?';
	};

	const switchView = async () => {
		if (view.board.config.views.length < 2) {
			console.warn('Extraboard perf: the board has one view; skipping the switch measurement.');
			return null;
		}
		const from = activeType();
		const ms = await time(() => {
			view.nextView();
		});
		return { to: activeType(), from, ms };
	};

	const row = (label, samples) => ({
		measurement: label,
		runs: samples.length,
		median: samples.length ? Number(median(samples).toFixed(1)) : 'skipped',
		min: samples.length ? Number(Math.min(...samples).toFixed(1)) : '',
		max: samples.length ? Number(Math.max(...samples).toFixed(1)) : '',
	});

	const collect = async (label, run) => {
		const samples = [];
		for (let i = 0; i < RUNS; i++) samples.push(await run(i));
		return row(label, samples);
	};

	/** One row per direction, since they are different work (see `switchView`). */
	const collectSwitch = async () => {
		const byTarget = new Map();
		// One extra run: with the directions split, RUNS samples would leave the
		// two buckets uneven by one.
		for (let i = 0; i < RUNS + 1; i++) {
			const sample = await switchView();
			if (!sample) return [row('view switch', [])];
			const list = byTarget.get(sample.to) ?? [];
			list.push(sample.ms);
			byTarget.set(sample.to, list);
		}
		return [...byTarget].map(([to, samples]) => row(`view switch → ${to}`, samples));
	};

	const cards = view.board.stacks.reduce(
		(n, stack) => n + stack.items.filter((item) => item.kind === 'card').length,
		0,
	);

	const rows = [];
	rows.push(await collect('cold open (unmount + parse + mount)', coldOpen));
	rows.push(await collect('reparse (parse + diff, live tree)', reparse));
	rows.push(await collect('one edit (serialize + render)', edit));
	rows.push(...(await collectSwitch()));

	console.log(
		`Extraboard perf — ${view.file?.basename ?? '?'}: ${view.board.stacks.length} stacks, ` +
			`${cards} cards, mobile=${app.isMobile === true}, ms (runs per row)`,
	);
	console.table(rows);
})();
