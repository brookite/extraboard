// Top-level Kanban render plus stack drag & drop. Spec: docs/specs/kanban-view.md.

import { useRef, useState } from 'preact/hooks';
import * as ops from '../model/ops';
import type { Board } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import type { BoardApi } from './api';
import { useSortable } from './useSortable';
import { Icon } from './components/Icon';
import { InlineEditor } from './components/InlineEditor';
import { StackColumn } from './components/Stack';

/**
 * "Archive card": a drop target under "Add stack" (archive.md §5.5). It is
 * always mounted — so Sortable knows about it before a drag starts — and only
 * *visible* while a card is in flight, which the body class `eb-dragging-card`
 * decides in CSS. The drop itself is handled by the source list's `onEnd`,
 * where `DropInfo.toArchive` says where the card landed; this instance only has
 * to accept it, and only from a card.
 */
function ArchiveTarget() {
	const ref = useRef<HTMLDivElement>(null);
	useSortable(
		ref,
		{
			group: {
				name: 'eb-items',
				pull: false,
				put: (_to, _from, item) => item.classList.contains('eb-card'),
			},
			sort: false,
		},
		() => {
			// Nothing is ever dragged *out* of the archive target.
		},
	);
	return (
		<div class="eb-archive-drop" ref={ref} data-archive="">
			<Icon name="archive" />
			<span>Archive card</span>
		</div>
	);
}

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
			<ArchiveTarget />
		</div>
	);
}

interface BoardProps {
	board: Board;
	api: BoardApi;
	settings: ExtraboardSettings;
}

export function KanbanView({ board, api, settings }: BoardProps) {
	const boardRef = useRef<HTMLDivElement>(null);

	useSortable(
		boardRef,
		{
			group: 'eb-stacks',
			draggable: '.eb-stack',
			// A dedicated grip, so the header stays clickable and the drag zone is
			// visible instead of guessed (kanban-view.md §6.4).
			handle: '.eb-stack-grip',
		},
		(drop) => {
			api.update((b) => ops.moveStack(b, drop.fromIndex, drop.before));
		},
	);

	return (
		<div class="eb-board" ref={boardRef} data-list={0}>
			{board.stacks.map((_, i) => (
				<StackColumn key={i} board={board} index={i} api={api} settings={settings} />
			))}
			<AddStack api={api} />
		</div>
	);
}
