// What this device has already shown, per board: the plugin's `boardState`.
// Spec: docs/specs/digest-and-reminders.md §9. Pure; no `obsidian` imports, so
// the bookkeeping is testable on its own.

import type { DigestKind } from '../model/digest';

export interface BoardState {
	/** The last period key shown, per digest kind. */
	digest?: Partial<Record<DigestKind, string>>;
	/** When each reminder was last checked, epoch ms, by reminder id. */
	reminded?: Record<string, number>;
	/**
	 * Modal sections the user collapsed or expanded, by `digest:<kind>:<section>`
	 * or `reminder:<comment>`; absent = the section's default.
	 */
	collapsed?: Record<string, boolean>;
}

export type BoardStates = Record<string, BoardState>;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A fresh, owned copy of whatever `data.json` held — never the defaults' object. */
export function readBoardStates(raw: unknown): BoardStates {
	if (!isRecord(raw)) return {};
	const out: BoardStates = {};
	for (const [path, value] of Object.entries(raw)) {
		if (!isRecord(value)) continue;
		const state: BoardState = {};
		if (isRecord(value.digest)) {
			const digest: Partial<Record<DigestKind, string>> = {};
			for (const kind of ['daily', 'weekly'] as const) {
				const key = value.digest[kind];
				if (typeof key === 'string') digest[kind] = key;
			}
			if (Object.keys(digest).length) state.digest = digest;
		}
		if (isRecord(value.reminded)) {
			const reminded: Record<string, number> = {};
			for (const [id, at] of Object.entries(value.reminded)) {
				if (typeof at === 'number' && Number.isFinite(at)) reminded[id] = at;
			}
			if (Object.keys(reminded).length) state.reminded = reminded;
		}
		if (isRecord(value.collapsed)) {
			const collapsed: Record<string, boolean> = {};
			for (const [key, flag] of Object.entries(value.collapsed)) {
				if (typeof flag === 'boolean') collapsed[key] = flag;
			}
			if (Object.keys(collapsed).length) state.collapsed = collapsed;
		}
		if (Object.keys(state).length) out[path] = state;
	}
	return out;
}

/** The state after a board file moved; unchanged (same object) when nothing did. */
export function renameBoardState(states: BoardStates, from: string, to: string): BoardStates {
	const state = states[from];
	if (!state || from === to) return states;
	const { [from]: _moved, ...rest } = states;
	return { ...rest, [to]: state };
}

/** The state without a deleted board's entry; the same object when it had none. */
export function deleteBoardState(states: BoardStates, path: string): BoardStates {
	if (!(path in states)) return states;
	const { [path]: _gone, ...rest } = states;
	return rest;
}

/**
 * The reminder state with only the ids the board still defines: a deleted
 * reminder's timestamp would otherwise live in `data.json` forever.
 */
export function pruneReminded(
	reminded: Record<string, number> | undefined,
	ids: readonly string[],
): Record<string, number> | undefined {
	if (!reminded) return undefined;
	const out: Record<string, number> = {};
	for (const id of ids) if (reminded[id] !== undefined) out[id] = reminded[id];
	return Object.keys(out).length ? out : undefined;
}

/** Collapse key of a digest section. */
export function digestSectionKey(kind: DigestKind, section: 'current' | 'done'): string {
	return `digest:${kind}:${section}`;
}

/** Collapse key of a reminder section. */
export function reminderSectionKey(comment: string): string {
	return `reminder:${comment}`;
}
