// The day modal: where a calendar is edited. Spec: docs/specs/calendar-view.md §5.
//
// A day cell is a summary; this is its opposite. Rows are the board's own
// `CardTile`, so the inline editor, the property badges, the checklist and the
// card menu all work exactly as they do on the Kanban side — plus the two
// badges a calendar needs, the card's **stack** and its **named divider**.

import { App, Modal } from 'obsidian';
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { occurrencesOn, placeCards, setCardDay } from '../model/calendar';
import { CalDate, compareDates } from '../model/dates';
import * as ops from '../model/ops';
import type { Board, PropertyType, ViewDef } from '../model/types';
import { cardEntryPos, type ExtraboardSettings } from '../settings';
import type { BoardApi } from '../view/api';
import { CardTile } from '../view/components/Card';
import { Icon } from '../view/components/Icon';
import { safeColor } from '../view/components/style';
import { currentLanguage, t } from '../i18n';
import { dateTimeFormat } from '../i18n/intl';
import { showDropdownMenu } from '../util/menu';

type CalendarDef = Extract<ViewDef, { type: 'calendar' }>;

export interface DayModalOptions {
	api: BoardApi;
	settings: ExtraboardSettings;
	view: CalendarDef;
	/** The day, or `null` for the "No date" tray (§4). */
	day: CalDate | null;
}

export function openDayModal(app: App, options: DayModalOptions): void {
	new DayModal(app, options).open();
}

/**
 * Always the full, absolute form — a modal heading identifying *which* day
 * this is has no use for "in 3 days" — so only the locale source moves onto
 * the plugin's own resolved language (i18n-and-dates.md §2), not whatever
 * Obsidian's app-wide locale happens to be.
 */
function dayTitle(day: CalDate | null): string {
	if (!day) return t('modal.day.noDate');
	const date = new Date(day.y, day.m - 1, day.d);
	return dateTimeFormat(currentLanguage(), {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	}).format(date);
}

/** The named divider a card sits under, if any (searching backwards). */
function dividerOf(board: Board, ref: ops.ItemRef): { index: number; name: string; color?: string } | null {
	const stack = board.stacks[ref.stack];
	if (!stack) return null;
	for (let i = ref.item - 1; i >= 0; i--) {
		const entry = stack.items[i];
		if (entry?.kind !== 'divider') continue;
		// An unnamed divider carries nothing to show, but it still ends the group
		// above it — the card belongs to no *named* group.
		return entry.divider.name ? { index: i, name: entry.divider.name, color: entry.divider.color } : null;
	}
	return null;
}

/** Named dividers of a stack, as the badge's menu offers them. */
function namedDividers(board: Board, stackIndex: number): { index: number; name: string }[] {
	const stack = board.stacks[stackIndex];
	if (!stack) return [];
	const out: { index: number; name: string }[] = [];
	stack.items.forEach((entry, i) => {
		if (entry.kind === 'divider' && entry.divider.name) out.push({ index: i, name: entry.divider.name });
	});
	return out;
}

/** Index just past the group that starts at `dividerIndex` (or the head group). */
function endOfGroup(board: Board, stackIndex: number, dividerIndex: number | null): number {
	const stack = board.stacks[stackIndex];
	if (!stack) return 0;
	let i = dividerIndex === null ? 0 : dividerIndex + 1;
	while (i < stack.items.length && stack.items[i]?.kind !== 'divider') i++;
	return i;
}

interface RowProps {
	board: Board;
	refItem: ops.ItemRef;
	api: BoardApi;
	settings: ExtraboardSettings;
}

function DayRow({ board, refItem, api, settings }: RowProps) {
	const stack = board.stacks[refItem.stack];
	const divider = dividerOf(board, refItem);
	const entry = stack?.items[refItem.item];
	if (!stack || entry?.kind !== 'card') return null;

	const chooseStack = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			board.stacks.forEach((target, i) => {
				menu.addItem((item) =>
					item
						.setTitle(target.name || t('modal.archive.untitled'))
						.setIcon('square-kanban')
						.setDisabled(i === refItem.stack)
						.onClick(() => {
							// The card lands at the end of the target stack — which means in
							// that stack's last group, so the divider badge recomputes itself
							// (§5.2). A completing stack completes it, like any other move.
							api.update((b) => ops.moveItem(b, refItem, i, null));
						}),
				);
			});
		});
	};

	const chooseDivider = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			const groups = namedDividers(board, refItem.stack);
			menu.addItem((item) =>
				item
					.setTitle(t('modal.day.noGroupOption'))
					.setIcon('minus')
					.setChecked(divider === null)
					.onClick(() => {
						api.update((b) => ops.moveItem(b, refItem, refItem.stack, endOfGroup(b, refItem.stack, null)));
					}),
			);
			for (const group of groups) {
				menu.addItem((item) =>
					item
						.setTitle(group.name)
						.setIcon('heading')
						.setChecked(divider?.index === group.index)
						.onClick(() => {
							api.update((b) =>
								ops.moveItem(b, refItem, refItem.stack, endOfGroup(b, refItem.stack, group.index)),
							);
						}),
				);
			}
		});
	};

	const dividerColor = safeColor(divider?.color);

	return (
		<div class="eb-day-row">
			<CardTile
				card={entry.card}
				stackIndex={refItem.stack}
				index={refItem.item}
				config={board.config}
				groupColor={ops.groupColor(stack, refItem.item)}
				api={api}
				settings={settings}
			/>
			<div class="eb-day-meta">
				<button type="button" class="eb-badge eb-day-stack" onClick={chooseStack}>
					<Icon name="square-kanban" />
					<span>{stack.name || t('modal.archive.untitled')}</span>
				</button>
				{divider ? (
					<button
						type="button"
						class="eb-badge eb-day-divider"
						style={dividerColor ? `--eb-divider-color: ${dividerColor}` : undefined}
						onClick={chooseDivider}
					>
						<Icon name="heading" />
						<span>{divider.name}</span>
					</button>
				) : namedDividers(board, refItem.stack).length > 0 ? (
					<button type="button" class="eb-badge eb-day-divider is-empty" onClick={chooseDivider}>
						<Icon name="heading" />
						<span>{t('modal.day.noGroup')}</span>
					</button>
				) : null}
			</div>
		</div>
	);
}

interface ComposerProps {
	board: Board;
	api: BoardApi;
	view: CalendarDef;
	day: CalDate;
	propertyType: PropertyType;
	stackIndex: number;
	settings: ExtraboardSettings;
	onStack: (index: number) => void;
}

/** Creates a card already dated to this day, in a stack chosen here (§5.3). */
function Composer({ board, api, view, day, propertyType, stackIndex, settings, onStack }: ComposerProps) {
	const [text, setText] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);
	const stack = board.stacks[stackIndex] ?? board.stacks[0];
	if (!stack) return null;

	const submit = (): void => {
		const title = text.trim();
		if (!title) return;
		setText('');
		// One edit: a created card is never left dateless in the file.
		api.update((b) => {
			const target = Math.min(stackIndex, b.stacks.length - 1);
			const at = cardEntryPos(b.stacks[target], b.config, settings);
			const withCard = ops.addCard(b, target, title, at);
			const items = withCard.stacks[target]?.items.length ?? 0;
			const ref = { stack: target, item: at === 0 ? 0 : items - 1 };
			return setCardDay(withCard, ref, view.dateProperty, propertyType, day);
		});
		inputRef.current?.focus();
	};

	const chooseStack = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			board.stacks.forEach((target, i) => {
				menu.addItem((item) =>
					item
						.setTitle(target.name || t('modal.archive.untitled'))
						.setIcon('square-kanban')
						.setChecked(i === stackIndex)
						.onClick(() => onStack(i)),
				);
			});
		});
	};

	return (
		<div class="eb-day-composer">
			<input
				ref={inputRef}
				type="text"
				placeholder={t('modal.day.addCardPlaceholder')}
				value={text}
				onInput={(e) => setText((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key !== 'Enter') return;
					e.preventDefault();
					submit();
				}}
			/>
			<button type="button" class="eb-badge eb-day-stack" onClick={chooseStack}>
				<Icon name="square-kanban" />
				<span>{stack.name || t('modal.archive.untitled')}</span>
			</button>
			<button type="button" class="mod-cta" onClick={submit}>
				{t('modal.day.add')}
			</button>
		</div>
	);
}

class DayModal extends Modal {
	private unsubscribe?: () => void;
	private composerStack = 0;

	constructor(
		app: App,
		private readonly options: DayModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass('eb-day-modal');
		this.titleEl.setText(dayTitle(this.options.day));
		// Every edit in a row goes through the board, which lives outside this
		// tree — so the modal re-renders from it rather than holding its own copy.
		this.unsubscribe = this.options.api.onChange(() => this.render());
		this.render();
	}

	override onClose(): void {
		this.unsubscribe?.();
		render(null, this.contentEl);
		this.contentEl.empty();
	}

	private render(): void {
		const { api, settings, view, day } = this.options;
		const board = api.getBoard();
		if (!board) return;

		// A day modal only ever asks about one day, so that is the window a
		// recurrence is expanded over (recurrence.md §3).
		const { occurrences, undated } = placeCards(
			board,
			view.dateProperty,
			day ? { from: day, to: day } : undefined,
		);
		const refs = day
			? occurrencesOn(occurrences, day)
					.slice()
					.sort((a, b) => compareDates(a.start, b.start) || a.ref.stack - b.ref.stack || a.ref.item - b.ref.item)
					.map((o) => o.ref)
			: undated;

		const def = board.config.properties.find((p) => p.name === view.dateProperty);
		const propertyType: PropertyType = def?.type ?? 'datetime';
		// De-duplicate: a date-list card can occur twice on the same day.
		const seen = new Set<string>();
		const unique = refs.filter((ref) => {
			const key = `${String(ref.stack)}:${String(ref.item)}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		render(
			<>
				{unique.length === 0 ? (
					<div class="eb-day-empty">
						{day ? t('modal.day.noCardsToday') : t('modal.day.everyCardDated')}
					</div>
				) : (
					<div class="eb-day-list">
						{unique.map((ref) => (
							<DayRow
								key={`${String(ref.stack)}-${String(ref.item)}`}
								board={board}
								refItem={ref}
								api={api}
								settings={settings}
							/>
						))}
					</div>
				)}
				{day && board.stacks.length > 0 ? (
					<Composer
						board={board}
						api={api}
						view={view}
						day={day}
						propertyType={propertyType}
						stackIndex={Math.min(this.composerStack, board.stacks.length - 1)}
						settings={settings}
						onStack={(index) => {
							this.composerStack = index;
							this.render();
						}}
					/>
				) : null}
			</>,
			this.contentEl,
		);
	}
}
