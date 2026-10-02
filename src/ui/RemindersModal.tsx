// The reminders modal: one section per reminder comment.
// Spec: docs/specs/digest-and-reminders.md §4.5, §5.

import type { App } from 'obsidian';
import { useState } from 'preact/hooks';
import { today as todayOf } from '../model/dates';
import type { FilterNode } from '../model/filter';
import { reminderSections, type ReminderRun } from '../model/reminders';
import { placesOf } from '../model/sections';
import type { SortRule } from '../model/sort';
import type { ExtraboardSettings } from '../settings';
import { reminderSectionKey } from '../schedule/state';
import type { BoardApi } from '../view/api';
import { SectionHeader, SectionRows } from '../view/components/SectionList';
import { t } from '../i18n';
import { ModalToolbar, type CollapseStore } from './DigestModal';
import { openPreactModal } from './PreactModal';

export interface RemindersModalOptions {
	api: BoardApi;
	settings: ExtraboardSettings;
	/**
	 * The reminders as the check evaluated them, each with its trigger interval.
	 * Kept fixed, so a re-render re-reads the cards but not the clock: what
	 * was due when the modal opened stays the question it answers.
	 */
	runs: ReminderRun[];
	boardName: string;
	collapse: CollapseStore;
	openBoard?: () => void;
	onClose?: () => void;
}

function RemindersBody({ options, close }: { options: RemindersModalOptions; close: () => void }) {
	const { api, settings, runs, collapse } = options;
	const [view, setView] = useState<{ filter?: FilterNode; sorts?: SortRule[] }>({});
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const board = api.getBoard();
	if (!board) return null;

	const ctx = { config: board.config, today: todayOf(), where: placesOf(board) };
	const sections = reminderSections(board, runs, ctx, view);

	const isCollapsed = (key: string): boolean => collapsed[key] ?? collapse.get(key) ?? false;
	const toggle = (key: string): void => {
		const next = !isCollapsed(key);
		setCollapsed((all) => ({ ...all, [key]: next }));
		collapse.set(key, next);
	};

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
			/>
			{sections.length === 0 ? <div class="eb-list-empty">{t('reminder.nothing')}</div> : null}
			{sections.map((section) => {
				const key = reminderSectionKey(section.comment);
				const shut = isCollapsed(key);
				return (
					<div key={key} class={`eb-section${shut ? ' is-collapsed' : ''}`}>
						<SectionHeader
							title={section.comment || t('reminder.defaultSection')}
							count={String(section.refs.length)}
							collapsed={shut}
							onToggle={() => toggle(key)}
						/>
						{shut ? null : <SectionRows board={board} refs={section.refs} api={api} settings={settings} />}
					</div>
				);
			})}
		</div>
	);
}

export function openRemindersModal(app: App, options: RemindersModalOptions): void {
	openPreactModal(app, {
		title: t('reminder.title', { board: options.boardName }),
		cls: 'eb-digest-modal',
		body: (close) => <RemindersBody options={options} close={close} />,
		subscribe: (rerender) => options.api.onChange(rerender),
		onClose: options.onClose,
	});
}
