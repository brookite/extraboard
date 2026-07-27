/*
 * Startup measurement for M10 Part B §6. Plan: docs/plans/m10-perf.md.
 * A sibling of `measure.js`: pasted into Obsidian's developer console
 * (Ctrl/Cmd+Shift+I). Nothing needs to be open — it reloads the plugin itself.
 *
 * Why the plugin is not instrumented instead: `performance.mark` calls compiled
 * into `main.js` would be dead weight in every user's bundle, which is the very
 * cost this step is about.
 *
 * What it separates, and why the split is the point. "Startup" is three
 * different things, and the standing constraint (../../docs/NOTICES.md,
 * "Board startup cost") is about all of them:
 *
 *   1. **read**    — pulling main.js off disk (or out of the OS cache).
 *   2. **compile** — the engine parsing it. This is what the bundle *size*
 *                    buys us, and it is paid before any deferral can help.
 *   3. **onload**  — our own lifecycle: loadSettings (a vault read),
 *                    registerView, the setViewState patch, commands, ribbon.
 *
 * The plan expects (3) to be negligible by inspection and wants the number
 * rather than the assumption — and §1's "open" row is the standing warning
 * that an unexamined number can measure something else entirely.
 *
 * How to run
 * ----------
 *   1. Paste this whole file into the console and press Enter.
 *   2. For the mobile column: app.emulateMobile(true), reload, repeat.
 *
 * It disables and re-enables the plugin RUNS times. Open boards close and
 * reopen as Markdown along the way; that is expected, and it is why this runs
 * against a scratch vault rather than one you care about.
 */

(async () => {
	const RUNS = 7;
	const ID = 'extraboard';

	const plugins = app.plugins;
	const instance = plugins.plugins[ID];
	if (!instance) {
		console.error(`Extraboard perf: plugin "${ID}" is not enabled.`);
		return;
	}

	/*
	 * The manifest's own `dir`, never `${configDir}/plugins/${ID}`: a plugin's
	 * folder name is whatever it was installed (or symlinked) as and does not
	 * have to match its id — in this repo's own test vault the folder is
	 * `kanban` while the id is `extraboard`, which is exactly how the guess was
	 * caught. `dir` is vault-relative, which is what the adapter wants.
	 */
	const dir = app.plugins.manifests[ID]?.dir;
	const mainPath = dir ? `${dir}/main.js` : null;

	/*
	 * Isolating `onload` needs a hook that survives a reload, and the obvious
	 * one does not: re-enabling re-evaluates main.js, so the plugin *class* is
	 * a fresh object every cycle and a patch on its prototype is lost. What
	 * does survive is Obsidian's own `Component.prototype.load` — the plugin
	 * class inherits it, and that prototype is part of the app, not of the
	 * bundle being reloaded. So: walk up from the live instance to whichever
	 * prototype actually owns `load`, wrap it there, and filter by manifest id
	 * so every other component's load is left alone.
	 */
	let componentProto = Object.getPrototypeOf(instance);
	while (componentProto && !Object.getOwnPropertyDescriptor(componentProto, 'load')) {
		componentProto = Object.getPrototypeOf(componentProto);
	}
	if (!componentProto) {
		console.error('Extraboard perf: could not find Component.prototype.load to hook.');
		return;
	}

	const originalLoad = componentProto.load;
	let onloadMs = null;
	componentProto.load = function patchedLoad(...args) {
		if (this?.manifest?.id !== ID) return originalLoad.apply(this, args);
		const started = performance.now();
		const result = originalLoad.apply(this, args);
		// `load()` awaits our async onload, so the number is only right once the
		// returned promise settles.
		return Promise.resolve(result).then((value) => {
			onloadMs = performance.now() - started;
			return value;
		});
	};

	const median = (values) => {
		const sorted = [...values].sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	};

	const row = (label, samples) => ({
		measurement: label,
		runs: samples.length,
		median: samples.length ? Number(median(samples).toFixed(1)) : 'skipped',
		min: samples.length ? Number(Math.min(...samples).toFixed(1)) : '',
		max: samples.length ? Number(Math.max(...samples).toFixed(1)) : '',
	});

	const enables = [];
	const onloads = [];
	const reads = [];
	const compiles = [];

	let source = '';

	try {
		for (let i = 0; i < RUNS; i++) {
			await plugins.disablePlugin(ID);

			// (1) read and (2) compile. Both are skipped rather than fatal if the
			// file cannot be found: `onload` is the row this script exists for,
			// and losing the whole run to a path problem is what the first
			// version did.
			if (mainPath !== null) {
				try {
					// Measured outside the enable so the two are not confused; the
					// enable below reads the same file again, which is the honest
					// shape of a real startup anyway.
					const readStarted = performance.now();
					source = await app.vault.adapter.read(mainPath);
					reads.push(performance.now() - readStarted);

					// `new Function` over the same source, without running it. V8
					// compiles function bodies lazily, so this is the parse plus the
					// top-level compile — a floor for what the engine pays, not the
					// whole of it. It is still the number that moves when the bundle
					// grows or shrinks, which is what §6 wants it for.
					const compileStarted = performance.now();
					// eslint-disable-next-line no-new-func
					new Function('module', 'exports', 'require', source);
					compiles.push(performance.now() - compileStarted);
				} catch (err) {
					console.warn(`Extraboard perf: could not read ${mainPath}; skipping those rows.`, err);
				}
			}

			// (3) the real thing: read + evaluate + our onload.
			onloadMs = null;
			const enableStarted = performance.now();
			await plugins.enablePlugin(ID);
			enables.push(performance.now() - enableStarted);
			if (onloadMs !== null) onloads.push(onloadMs);
		}
	} finally {
		componentProto.load = originalLoad;
		if (!plugins.plugins[ID]) await plugins.enablePlugin(ID);
	}

	const size = source ? `main.js ${(source.length / 1024).toFixed(1)} KB` : `main.js not read`;
	console.log(
		`Extraboard startup — ${size}, dir=${dir ?? '?'}, ` +
			`mobile=${app.isMobile === true}, ms (runs per row)`,
	);
	console.table([
		row('enablePlugin (read + eval + onload)', enables),
		row('our onload alone', onloads),
		row('read main.js', reads),
		row('compile main.js (new Function)', compiles),
	]);
})();
