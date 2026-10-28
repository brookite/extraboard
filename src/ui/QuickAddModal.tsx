// The quick-add dialog: write one card — text, properties, tags — and pick the
// stack and named section it goes into. Spec: docs/specs/quick-add-card.md.
//
// The card is a draft on a scratch board (model/quickAdd.ts) behind a draft
// `BoardApi`, so the inline editor's own badge row, tag picker and value
// editors edit it unchanged. Only **Add** touches the real board, through the
// target's `commit`.

import { App, Component, Modal, Notice, Platform, type HoverParent } from 'obsidian';
import { render } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import {
	addQuickCard,
	draftCard,
	draftOf,
	finalCard,
	initialDestination,
	isEmptyCard,
	namedSectionsOf,
	rememberOf,
	withStack,
	type Draft,
	type QuickDestination,
	type RememberedDestination,
} from '../model/quickAdd';
import type { Board } from '../model/types';
import { cardEntryPos, type ExtraboardSettings } from '../settings';
import { showDropdownMenu } from '../util/menu';
import { confirmDestructive, searchTag, type BoardApi } from '../view/api';
import { RichField, type CardField } from '../view/CardEditor';
import { Icon } from '../view/components/Icon';
import { PropertyBadges } from '../view/components/PropertyBadges';
import { pickColor } from './ColorPicker';
import { keyboardAwareModal } from './keyboardInset';
import { t } from '../i18n';

/** The board a card is being added to, and the way to write it. */
export interface QuickAddTarget {
	/** The board as it stood when the dialog opened: config, stacks, tags. */
	board: Board;
	/** The board's display name and path (links resolve relative to it). */
	name: string;
	path: string;
	/**
	 * Apply the op to the board **as it stands at that moment** (§5). Resolves
	 * `false` when nothing could be written.
	 */
	commit(mutate: (board: Board) => Board): Promise<boolean>;
	/** Say so when the card was added: the board is not on screen to show it. */
	notify: boolean;
}

/** The last destination per board file, for this session (§3). */
const remembered = new Map<string, RememberedDestination>();

export function openQuickAddModal(app: App, settings: ExtraboardSettings, target: QuickAddTarget): void {
	new QuickAddModal(app, settings, target).open();
}

class QuickAddModal extends Modal {
	/** Lifecycle owner for whatever Obsidian renders inside the dialog. */
	private readonly component = new Component();

	constructor(
		app: App,
		private readonly settings: ExtraboardSettings,
		private readonly target: QuickAddTarget,
	) {
		super(app);
	}

	override onOpen(): void {
		keyboardAwareModal(this);
		this.modalEl.addClass('eb-preact-modal', 'eb-quick-add-modal');
		this.titleEl.setText(t('quickAdd.title'));
		this.component.load();
		render(
			<QuickAdd
				app={this.app}
				settings={this.settings}
				target={this.target}
				component={this.component}
				close={() => this.close()}
			/>,
			this.contentEl,
		);
	}

	override onClose(): void {
		render(null, this.contentEl);
		this.contentEl.empty();
		this.component.unload();
	}
}

interface Props {
	app: App;
	settings: ExtraboardSettings;
	target: QuickAddTarget;
	component: Component;
	close: () => void;
}

function QuickAdd({ app, settings, target, component, close }: Props) {
	const board = target.board;
	const showRaw = settings.showRawPropertyTokens;
	const rootRef = useRef<HTMLDivElement>(null);
	const field = useRef<CardField | null>(null);
	const [draft, setDraft] = useState<Draft>(() => draftOf(board));
	const [dest, setDest] = useState<QuickDestination>(() =>
		initialDestination(board, remembered.get(target.path)),
	);
	// Bumped to mount a fresh, empty field after "Add another".
	const [round, setRound] = useState(0);
	// Read by the draft api, whose identity must outlive every render: the value
	// editors and the tag picker hold on to it.
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const listeners = useRef(new Set<() => void>());

	const api = useMemo<BoardApi>(() => {
		const hoverParent: HoverParent = { hoverPopover: null };
		return {
			app,
			hoverParent,
			component,
			sourcePath: () => target.path,
			update: (mutate) => {
				const current = draftRef.current;
				const next = mutate(current.board);
				if (next === current.board) return;
				draftRef.current = { ...current, board: next };
				setDraft(draftRef.current);
				for (const listener of listeners.current) listener();
			},
			getBoard: () => draftRef.current.board,
			confirm: (title, message, cta) => confirmDestructive(app, title, message, cta),
			searchTag: (tag) => searchTag(app, tag),
			pickColor: (options) => pickColor(app, options),
			// The draft has no note to create and no views to manage.
			createCardNote: () => undefined,
			manageViews: () => undefined,
			onChange: (listener) => {
				listeners.current.add(listener);
				return () => listeners.current.delete(listener);
			},
		};
	}, [app, component, target.path]);

	const card = draftCard(draft);
	const sections = namedSectionsOf(board, dest.stack);

	/** Add the card; `again` keeps the dialog open, emptied, for the next one. */
	const add = async (again: boolean): Promise<void> => {
		const text = field.current?.getValue() ?? '';
		const made = finalCard(draftRef.current, text, showRaw);
		if (!made || isEmptyCard(made)) {
			field.current?.setValue(text);
			return;
		}
		const where = rememberOf(board, dest);
		if (where) remembered.set(target.path, where);
		const ok = await target.commit((b) => {
			// Resolved again by name: the board may have changed since it opened.
			const at = where ? initialDestination(b, where) : dest;
			const top = cardEntryPos(b.stacks[at.stack], b.config, settings) === 0;
			return addQuickCard(b, at, made, top);
		});
		if (!ok) return;
		if (target.notify) new Notice(t('quickAdd.added', { board: target.name }));
		if (!again) {
			close();
			return;
		}
		const fresh = draftOf(board);
		draftRef.current = fresh;
		setDraft(fresh);
		setRound((r) => r + 1);
	};

	const onKey = (evt: KeyboardEvent): boolean => {
		if (evt.key !== 'Enter' || evt.shiftKey) return false;
		const mod = Platform.isMacOS ? evt.metaKey : evt.ctrlKey;
		void add(mod);
		return true;
	};

	const chooseStack = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			board.stacks.forEach((_stack, i) => {
				menu.addItem((item) =>
					item
						.setTitle(stackName(board, i))
						.setIcon('square-kanban')
						.setChecked(i === dest.stack)
						.onClick(() => setDest(withStack(board, dest, i))),
				);
			});
		});
	};

	const chooseSection = (event: MouseEvent): void => {
		showDropdownMenu(event, (menu) => {
			menu.addItem((item) =>
				item
					.setTitle(t('list.noSection'))
					.setIcon('minus')
					.setChecked(dest.section === null)
					.onClick(() => setDest({ ...dest, section: null })),
			);
			for (const name of sections) {
				menu.addItem((item) =>
					item
						.setTitle(name)
						.setIcon('heading')
						.setChecked(name === dest.section)
						.onClick(() => setDest({ ...dest, section: name })),
				);
			}
		});
	};

	const modKey = Platform.isMacOS ? '⌘' : 'Ctrl';

	return (
		<div class="eb-quick-add" ref={rootRef}>
			<div class="eb-quick-add-board">
				<Icon name="square-kanban" class="eb-button-icon" />
				<span>{target.name}</span>
			</div>
			<div class="eb-card-editor eb-quick-add-editor">
				<RichField
					key={round}
					app={app}
					value=""
					placeholder={showRaw ? t('cardEditor.placeholderRaw') : t('cardEditor.placeholder')}
					scope={rootRef}
					submitOnBlur={false}
					onKey={onKey}
					onReady={(mounted) => {
						field.current = mounted;
					}}
					onRelease={(released) => {
						if (field.current === released) field.current = null;
					}}
					onSubmit={() => void add(false)}
					onCommit={() => undefined}
					onCancel={close}
				/>
				{card ? (
					<PropertyBadges
						config={board.config}
						card={card}
						target={draft.ref}
						api={api}
						settings={settings}
						field={field}
					/>
				) : null}
			</div>
			{Platform.isMobile ? null : (
				<div class="eb-quick-add-hint">{t('quickAdd.hint', { mod: modKey })}</div>
			)}
			<div class="eb-quick-add-dest">
				<PickChip
					icon="square-kanban"
					label={stackName(board, dest.stack)}
					aria={t('quickAdd.stack')}
					onClick={chooseStack}
				/>
				{sections.length ? (
					<PickChip
						icon={dest.section ? 'heading' : 'minus'}
						label={dest.section ?? t('list.noSection')}
						aria={t('quickAdd.section')}
						onClick={chooseSection}
					/>
				) : null}
			</div>
			<div class="modal-button-container eb-quick-add-buttons">
				<button type="button" onClick={close}>
					{t('common.cancel')}
				</button>
				<button type="button" onClick={() => void add(true)}>
					{t('quickAdd.addAnother')}
				</button>
				<button type="button" class="mod-cta" onClick={() => void add(false)}>
					{t('quickAdd.add')}
				</button>
			</div>
		</div>
	);
}

/** A stack's label as every picker writes it. */
function stackName(board: Board, index: number): string {
	return board.stacks[index]?.name || t('modal.archive.untitled');
}

/** One destination chip, in the list view's pick style (list-view.md §4.2). */
function PickChip({
	icon,
	label,
	aria,
	onClick,
}: {
	icon: string;
	label: string;
	aria: string;
	onClick: (event: MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			class="eb-badge eb-list-stack is-pick eb-quick-add-chip"
			aria-label={`${aria}: ${label}`}
			title={`${aria}: ${label}`}
			onClick={onClick}
		>
			<Icon name={icon} class="eb-button-icon" />
			<span>{label}</span>
			<Icon name="chevron-down" class="eb-button-icon" />
		</button>
	);
}
