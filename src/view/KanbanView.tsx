// Top-level Kanban render plus stack drag & drop. Spec: docs/specs/kanban-view.md.

import { useRef } from 'preact/hooks';
import * as ops from '../model/ops';
import type { Board } from '../model/types';
import type { ExtraboardSettings } from '../settings';
import { editStack } from '../ui/StackModal';
import type { BoardApi } from './api';
import { useSortable } from './useSortable';
import { Icon } from './components/Icon';
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

/**
 * A new stack is configured before it exists: the same form the stack menu's
 * "Edit stack" opens, so the completion flag is offered at creation
 * (stack-completion-and-divider-colors.md §3.3).
 */
export function addStack(api: BoardApi, at: ops.InsertPos = null, onAdded?: () => void): void {
	void editStack(api.app, { title: 'Add stack', cta: 'Add' }).then((fields) => {
		if (!fields) return;
		api.update((b) => ops.addStack(b, fields.name, at, fields.completes));
		onAdded?.();
	});
}

function AddStack({ api }: { api: BoardApi }) {
	return (
		<div class="eb-add-stack">
			<button type="button" class="eb-add-stack-button" onClick={() => addStack(api)}>
				<Icon name="plus" />
				<span>Add stack</span>
			</button>
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
