import { groupsOf, type Section } from './sections';
import type { Board, ListGroupBy } from './types';

export interface ListGroup {
	id: string;
	section: Section;
}

/** Stack names survive column moves. An occurrence number separates duplicate names. */
export function listGroups(board: Board, mode: ListGroupBy, order?: readonly string[]): ListGroup[] {
	const seen = new Map<string, number>();
	const groups = groupsOf(board, mode).map((section) => {
		const { key, name } = section;
		if (key.kind !== 'stack') return { id: name, section };
		const occurrence = seen.get(name) ?? 0;
		seen.set(name, occurrence + 1);
		return { id: JSON.stringify([name, occurrence]), section };
	});
	if (!order?.length) return groups;

	const rank = new Map(order.map((id, index) => [id, index]));
	return groups.sort((left, right) => {
		if (left.section.movable !== right.section.movable) return left.section.movable ? 1 : -1;
		return (rank.get(left.id) ?? order.length) - (rank.get(right.id) ?? order.length);
	});
}

/** Keep ranks for groups that are temporarily absent, such as unused tags. */
export function moveListGroup(
	groups: readonly ListGroup[],
	order: readonly string[] | undefined,
	id: string,
	before: string | null,
): string[] {
	const movableIds = groups.filter((group) => group.section.movable).map((group) => group.id);
	const next = [...new Set([...(order ?? []), ...movableIds])].filter((key) => key !== id);
	const target = before === null ? -1 : next.indexOf(before);
	next.splice(target === -1 ? next.length : target, 0, id);
	return next;
}
