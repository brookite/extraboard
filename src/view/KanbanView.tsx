// Top-level Kanban render plus stack drag & drop. Spec: docs/specs/kanban-view.md.

import { useRef, useState } from 'preact/hooks';
import * as ops from '../model/ops';
import type { Board } from '../model/types';
import type { BoardApi } from './api';
import { useSortable } from './useSortable';
import { Icon } from './components/Icon';
import { InlineEditor } from './components/InlineEditor';
import { StackColumn } from './components/Stack';

function AddStack({ api }: { api: BoardApi }) {
	const [adding, setAdding] = useState(false);
	return (
		<div class="eb-add-stack">
			{adding ? (
				<InlineEditor
					placeholder="Stack name"
					onSubmit={(name) => {
						setAdding(false);
						api.update((b) => ops.addStack(b, name));
					}}
					onCancel={() => setAdding(false)}
				/>
			) : (
				<button type="button" class="eb-add-stack-button" onClick={() => setAdding(true)}>
					<Icon name="plus" />
					<span>Add stack</span>
				</button>
			)}
		</div>
	);
}

export function KanbanView({ board, api }: { board: Board; api: BoardApi }) {
	const boardRef = useRef<HTMLDivElement>(null);

	useSortable(
		boardRef,
		{
			group: 'eb-stacks',
			draggable: '.eb-stack',
			handle: '.eb-stack-header',
			filter: 'input, textarea, button, .eb-stack-name',
		},
		(drop) => {
			api.update((b) => ops.moveStack(b, drop.fromIndex, drop.before));
		},
	);

	return (
		<div class="eb-board" ref={boardRef} data-list={0}>
			{board.stacks.map((_, i) => (
				<StackColumn key={i} board={board} index={i} api={api} />
			))}
			<AddStack api={api} />
		</div>
	);
}
