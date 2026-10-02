// The daily / weekly digest modal. Spec: docs/specs/digest-and-reminders.md §3, §5.
//
// It reads the board through its view's `BoardApi` on every render, as the day
// modal does, so a card edited from a row redraws here and on the board alike.

import type { App } from 'obsidian';
import { useState } from 'preact/hooks';
import { today as todayOf } from '../model/dates';
import { digestSections, periodWindow, type DigestDef, type DigestKind } from '../model/digest';
import { countConditions, isEmptyFilter, type FilterNode } from '../model/filter';
import { placesOf } from '../model/sections';
import type { SortRule } from '../model/sort';
import type { ExtraboardSettings } from '../settings';
import { digestSectionKey } from '../schedule/state';
import type { BoardApi } from '../view/api';
import { Icon } from '../view/components/Icon';
import { SectionHeader, SectionRows } from '../view/components/SectionList';
import { currentLanguage, t } from '../i18n';
import { dateTimeFormat } from '../i18n/intl';
import { openFilterSortModal } from './FilterSortModal';
import { openPreactModal } from './PreactModal';

/** Section collapse, remembered per board on this device. */
export interface CollapseStore {
	get(key: string): boolean | undefined;
	set(key: string, collapsed: boolean): void;
}

export interface DigestModalOptions {
	api: BoardApi;
	settings: ExtraboardSettings;
	kind: DigestKind;
	/** The definition as of opening; a live one on the board wins. */
	def: DigestDef;
	/** Resolved first day of the week (0 = Sunday). */
	weekStart: number;
	boardName: string;
	collapse: CollapseStore;
	/** Reveal the board's tab; absent when it is already the active one. */
	openBoard?: () => void;
	onClose?: () => void;
}

/** The period's dates as the modal's subtitle: one day, or the week's range. */
function periodLabel(kind: DigestKind, weekStart: number): string {
	const window = periodWindow(kind, todayOf(), weekStart);
	const fmt = dateTimeFormat(currentLanguage(), { day: 'numeric', month: 'long' });
	const date = (d: { y: number; m: number; d: number }) => new Date(d.y, d.m - 1, d.d);
	if (kind === 'daily') {
		return dateTimeFormat(currentLanguage(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
			date(window.from),
		);
	}
	return `${fmt.format(date(window.from))} – ${fmt.format(date(window.to))}`;
}

/** The toolbar every board modal of this kind shares: session filter, open board. */
export function ModalToolbar({
	api,
	filter,
	sorts,
	onApply,
	openBoard,
	period,
}: {
	api: BoardApi;
	filter?: FilterNode;
	sorts?: SortRule[];
	onApply: (filter: FilterNode | undefined, sorts: SortRule[] | undefined) => void;
	openBoard?: () => void;
	period?: string;
}) {
	const filtered = !isEmptyFilter(filter);
	const edit = (): void => {
		const board = api.getBoard();
		if (!board) return;
		openFilterSortModal(api.app, {
			board,
			...(filter && { filter }),
			...(sorts && { sorts }),
			onApply: (result) =>
				onApply(result.filter ?? undefined, result.sorts.length ? result.sorts : undefined),
		});
	};
	return (
		<div class="eb-list-toolbar eb-digest-toolbar">
			{period ? <span class="eb-digest-period">{period}</span> : null}
			<button
				type="button"
				class={`eb-badge eb-list-filter${filtered || sorts?.length ? ' is-active' : ''}`}
				title={t('digest.sessionFilterHint')}
				onClick={edit}
			>
				<Icon name="filter" class="eb-button-icon" />
				<span>
					{filtered ? t('filter.conditions', { count: countConditions(filter) }) : t('digest.filterAndSort')}
				</span>
			</button>
			{openBoard ? (
				<button type="button" class="eb-badge eb-list-filter" onClick={openBoard}>
					<Icon name="square-kanban" class="eb-button-icon" />
					<span>{t('digest.openBoard')}</span>
				</button>
			) : null}
		</div>
	);
}

function DigestBody({ options, close }: { options: DigestModalOptions; close: () => void }) {
	const { api, settings, kind, weekStart, collapse } = options;
	const board = api.getBoard();
	const def = board?.config.digest?.[kind] ?? options.def;
	// Session-only (§5): starts from the definition, never written back.
	const [view, setView] = useState<{ filter?: FilterNode; sorts?: SortRule[] }>(() => ({
		...(def.filter && { filter: def.filter }),
		...(def.sorts && { sorts: def.sorts }),
	}));
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	if (!board) return null;

	const ctx = { config: board.config, today: todayOf(), weekStart, where: placesOf(board) };
	const { current, previous } = digestSections(board, kind, def, ctx, view);

	const isCollapsed = (section: 'current' | 'done'): boolean => {
		const key = digestSectionKey(kind, section);
		return collapsed[key] ?? collapse.get(key) ?? section === 'done';
	};
	const toggle = (section: 'current' | 'done'): void => {
		const key = digestSectionKey(kind, section);
		const next = !isCollapsed(section);
		setCollapsed((all) => ({ ...all, [key]: next }));
		collapse.set(key, next);
	};

	const currentTitle = kind === 'daily' ? t('digest.today') : t('digest.thisWeek');
	const doneTitle = kind === 'daily' ? t('digest.doneYesterday') : t('digest.doneLastWeek');

	return (
		<div class="eb-digest">
			<ModalToolbar
				api={api}
				filter={view.filter}
				sorts={view.sorts}
				onApply={(filter, sorts) => setView({ ...(filter && { filter }), ...(sorts && { sorts }) })}
				openBoard={
					options.openBoard &&
					(() => {
						options.openBoard?.();
						close();
					})
				}
				period={periodLabel(kind, weekStart)}
			/>
			<div class={`eb-section${isCollapsed('current') ? ' is-collapsed' : ''}`}>
				<SectionHeader
					title={currentTitle}
					count={String(current.length)}
					collapsed={isCollapsed('current')}
					onToggle={() => toggle('current')}
				/>
				{isCollapsed('current') ? null : current.length ? (
					<SectionRows board={board} refs={current} api={api} settings={settings} />
				) : (
					<div class="eb-section-body eb-digest-empty">{t('digest.nothing')}</div>
				)}
			</div>
			{previous.total > 0 ? (
				<div class={`eb-section${isCollapsed('done') ? ' is-collapsed' : ''}`}>
					<SectionHeader
						title={doneTitle}
						count={`${String(previous.done.length)}/${String(previous.total)}`}
						collapsed={isCollapsed('done')}
						onToggle={() => toggle('done')}
					/>
					{isCollapsed('done') ? null : previous.done.length ? (
						<SectionRows board={board} refs={previous.done} api={api} settings={settings} />
					) : (
						<div class="eb-section-body eb-digest-empty">{t('digest.noneDone')}</div>
					)}
				</div>
			) : null}
		</div>
	);
}

export function openDigestModal(app: App, options: DigestModalOptions): void {
	openPreactModal(app, {
		title: t(options.kind === 'daily' ? 'digest.dailyTitle' : 'digest.weeklyTitle', {
			board: options.boardName,
		}),
		cls: 'eb-digest-modal',
		body: (close) => <DigestBody options={options} close={close} />,
		subscribe: (rerender) => options.api.onChange(rerender),
		onClose: options.onClose,
	});
}
