// Filters and sorting in one place. Spec: docs/specs/filters-and-sorting.md §4, §6.
//
// The draft is edited here and applied in one go: a condition is half-typed for
// most of its life, and writing every keystroke into the board file would mean
// a save per character. "Apply" is therefore the commit, and dismissing the
// modal changes nothing — the opposite of every other board edit, and the
// reason this one has buttons at all.

import { App, Modal } from 'obsidian';
import { render } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
	FilterGroup,
	FilterNode,
	NodePath,
	countConditions,
	emptyGroup,
	insertInto,
	isEmptyFilter,
	moveNode,
	removeAt,
	replaceNode,
} from '../model/filter';
import type { SortRule } from '../model/sort';
import { tagsOf } from '../model/sectionView';
import type { Board, BoardConfig } from '../model/types';
import { GroupNode, groupOrdinals } from '../view/components/FilterTree';
import { SortList } from '../view/components/SortList';
import type { DropInfo } from '../view/useSortable';
import { t } from '../i18n';
import { keyboardAwareModal } from './keyboardInset';

export interface FilterSortResult {
	filter: FilterNode | null;
	sorts: SortRule[];
}

export interface FilterSortModalOptions {
	board: Board;
	filter?: FilterNode;
	sorts?: SortRule[];
	/** The whole result at once — one edit, one save. */
	onApply(result: FilterSortResult): void;
}

export function openFilterSortModal(app: App, options: FilterSortModalOptions): void {
	new FilterSortModal(app, options).open();
}

/** Whatever the view holds, as the root group the builder edits. */
function rootOf(filter: FilterNode | undefined): FilterGroup {
	if (!filter) return emptyGroup('and');
	if (filter.kind === 'group') return filter;
	return { kind: 'group', op: 'and', children: [filter] };
}

function Editor({
	app,
	config,
	tags,
	initial,
	onApply,
	onCancel,
}: {
	app: App;
	config: BoardConfig;
	tags: string[];
	initial: { filter?: FilterNode; sorts?: SortRule[] };
	onApply: (result: FilterSortResult) => void;
	onCancel: () => void;
}) {
	const [tab, setTab] = useState<'filters' | 'sorts'>('filters');
	const [root, setRoot] = useState<FilterGroup>(() => rootOf(initial.filter));
	const [sorts, setSorts] = useState<SortRule[]>(() => (initial.sorts ?? []).map((r) => ({ ...r })));

	const { ordinals, paths } = useMemo(() => groupOrdinals(root), [root]);

	const asGroup = (node: FilterNode): FilterGroup =>
		node.kind === 'group' ? node : { kind: 'group', op: 'and', children: [node] };

	const change = (path: NodePath, next: FilterNode): void => {
		setRoot(asGroup(replaceNode(root, path, next)));
	};
	const remove = (path: NodePath): void => {
		setRoot(asGroup(removeAt(root, path)));
	};
	const add = (path: NodePath, node: FilterNode): void => {
		setRoot(asGroup(insertInto(root, path, node)));
	};

	/**
	 * A drop speaks in ordinals; both ends are turned back into paths before the
	 * model is asked for anything — the same shape the list view's own drop
	 * handler has.
	 */
	const onDrop = (info: DropInfo): void => {
		const fromGroup = paths[info.fromList];
		const toGroup = paths[info.toList];
		if (!fromGroup || !toGroup) return;
		setRoot(asGroup(moveNode(root, [...fromGroup, info.fromIndex], toGroup, info.before)));
	};

	const count = countConditions(root);

	return (
		<div class="eb-filter-modal-body">
			<div class="eb-filter-tabs">
				<button
					type="button"
					class={tab === 'filters' ? 'is-active' : ''}
					onClick={() => setTab('filters')}
				>
					{t('filter.filtersTab')}
					{count > 0 ? <span class="eb-filter-count">{count}</span> : null}
				</button>
				<button
					type="button"
					class={tab === 'sorts' ? 'is-active' : ''}
					onClick={() => setTab('sorts')}
				>
					{t('filter.sortTab')}
					{sorts.length > 0 ? <span class="eb-filter-count">{sorts.length}</span> : null}
				</button>
				{tab === 'filters' ? (
					// The top-level operator sits in the corner, above the tree it
					// governs: it is a property of the whole filter, not of a row (§4.1).
					<label class="eb-filter-root-op">
						<span>{t('filter.match')}</span>
						<select
							class="dropdown"
							value={root.op}
							onChange={(e) =>
								setRoot({ ...root, op: (e.target as HTMLSelectElement).value as FilterGroup['op'] })
							}
						>
							{(['and', 'or', 'not'] as const).map((op) => (
								<option key={op} value={op}>
									{t(`filter.join.${op}`)}
								</option>
							))}
						</select>
					</label>
				) : null}
			</div>

			{tab === 'filters' ? (
				<GroupNode
					app={app}
					config={config}
					tags={tags}
					root={root}
					group={root}
					path={[]}
					index={0}
					ordinals={ordinals}
					onChange={change}
					onRemove={remove}
					onAdd={add}
					onDrop={onDrop}
				/>
			) : (
				<SortList config={config} sorts={sorts} onChange={setSorts} />
			)}

			<div class="modal-button-container">
				<button type="button" onClick={onCancel}>
					{t('common.cancel')}
				</button>
				<button
					type="button"
					class="mod-cta"
					onClick={() => onApply({ filter: isEmptyFilter(root) ? null : root, sorts })}
				>
					{t('filter.apply')}
				</button>
			</div>
		</div>
	);
}

class FilterSortModal extends Modal {
	constructor(
		app: App,
		private readonly options: FilterSortModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		keyboardAwareModal(this);
		this.modalEl.addClass('eb-filter-modal');
		this.titleEl.setText(t('filter.title'));
		const { board } = this.options;
		// Every tag on the board, so a tag condition suggests instead of asking the
		// user to remember (§3.3).
		const refs = board.stacks.flatMap((stack, s) =>
			stack.items.map((_, i) => ({ stack: s, item: i })),
		);
		render(
			<Editor
				app={this.app}
				config={board.config}
				tags={tagsOf(board, refs)}
				initial={{ filter: this.options.filter, sorts: this.options.sorts }}
				onApply={(result) => {
					this.options.onApply(result);
					this.close();
				}}
				onCancel={() => this.close()}
			/>,
			this.contentEl,
		);
	}

	override onClose(): void {
		render(null, this.contentEl);
		this.contentEl.empty();
	}
}
