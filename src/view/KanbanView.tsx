// Top-level read-only Kanban render. Spec: docs/specs/kanban-view.md.

import type { Board } from '../model/types';
import { StackColumn } from './components/Stack';

export function KanbanView({ board }: { board: Board }) {
	if (board.stacks.length === 0) {
		return <div class="eb-empty">This board has no stacks yet.</div>;
	}
	return (
		<div class="eb-board">
			{board.stacks.map((stack, i) => (
				<StackColumn key={i} stack={stack} config={board.config} />
			))}
		</div>
	);
}
