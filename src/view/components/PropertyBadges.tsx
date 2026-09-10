// The card's property values as editable badges under the inline editor.
// Spec: docs/specs/card-content-and-checklists.md §3.1.
//
// Every edit goes through an op like any other change — there is no confirm
// step and no dirty state to lose.
//
// On a phone the two panels that are tall enough to move the board — the tag
// picker and a date property's calendar — open as modals instead of under the
// badge row (mobile.md §7.1). The panel itself is the same component either
// way; only its host changes.

import { Platform } from 'obsidian';
import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { formatValue } from '../../model/properties';
import { parseRecurrence } from '../../model/recurrence';
import type { BoardConfig, Card, PropertyDef, PropertyValue } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { dateTimeOptsFor, type DateTimeOpts } from '../../i18n/dates';
import { describeRecurrence } from '../../i18n/recurrenceText';
import { openTagPickerModal, openValueEditorModal } from '../../ui/CardPanelModals';
import type { BoardApi } from '../api';
import type { CardField } from '../CardEditor';
import { Icon } from './Icon';
import { safeColor } from './style';
import { t } from '../../i18n';
import { showDropdownMenu } from '../../util/menu';
import { TagPicker } from './TagPicker';
import { DATE_TYPES, ValueEditor } from './ValueEditor';

interface Props {
	config: BoardConfig;
	card: Card;
	target: ops.ItemRef;
	api: BoardApi;
	/** Read for the date/recurrence formatting a badge label needs. */
	settings: ExtraboardSettings;
	/**
	 * The card's text field, when one is mounted. Tags are part of that text, so
	 * the tag button edits it directly — an op would be overwritten by the field
	 * the moment it commits (model/tags.ts).
	 */
	field?: RefObject<CardField | null>;
}

export function PropertyBadges({ config, card, target, api, settings, field }: Props) {
	// Name of the property whose editor is open; it need not be on the card yet.
	const [open, setOpen] = useState<string | null>(null);
	// The tag picker (§3.1.1) takes the same slot below the row, so the two are
	// one state: opening either closes the other.
	const [tagsOpen, setTagsOpen] = useState(false);

	const defFor = (name: string): PropertyDef | undefined =>
		config.properties.find((d) => d.name === name);
	const valueFor = (name: string): PropertyValue | undefined =>
		card.properties.find((pv) => pv.name === name);

	const commit = (pv: PropertyValue | null, name: string): void => {
		if (pv) api.update((b) => ops.setCardProperty(b, target, pv));
		// An emptied field means "absent", the same rule the token grammar uses.
		else api.update((b) => ops.removeCardProperty(b, target, name));
	};

	const remove = (name: string): void => {
		setOpen(null);
		api.update((b) => ops.removeCardProperty(b, target, name));
	};

	/**
	 * Open one property's editor. A calendar is the one editor tall enough to
	 * shove the card out of view when the phone opens it under the badge row, so
	 * there it becomes a modal (mobile.md §7.1) and no inline slot is claimed.
	 */
	const openProperty = (name: string): void => {
		setTagsOpen(false);
		const def = defFor(name);
		if (Platform.isMobile && def && DATE_TYPES.has(def.type)) {
			setOpen(null);
			openValueEditorModal(api.app, {
				name,
				def,
				target,
				api,
				settings,
				onCommit: (pv) => commit(pv, name),
				onRemove: () => remove(name),
			});
			return;
		}
		setOpen(name === open ? null : name);
	};

	/** The tag picker: under the row on a desktop, a modal on a phone (§7.1). */
	const toggleTags = (): void => {
		setOpen(null);
		if (!field) return;
		if (Platform.isMobile) {
			setTagsOpen(false);
			openTagPickerModal(api.app, { field, api });
			return;
		}
		setTagsOpen(!tagsOpen);
	};

	const addMenu = (evt: MouseEvent): void => {
		setTagsOpen(false);
		const missing = config.properties.filter((d) => !valueFor(d.name));
		showDropdownMenu(evt, (menu) => {
			if (!missing.length) {
				menu.addItem((item) => item.setTitle(t('propertyBadges.noOtherProperties')).setDisabled(true));
			}
			for (const def of missing) {
				menu.addItem((item) =>
					item
						.setTitle(def.name)
						.setIcon('plus')
						.onClick(() => openProperty(def.name)),
				);
			}
		});
	};

	const openName = open;
	const openDef = openName === null ? undefined : defFor(openName);
	const openValue = openName === null ? undefined : valueFor(openName);

	return (
		<div class="eb-card-editor-props">
			<div class="eb-badge-row">
				{card.properties.map((pv) => (
					<BadgeButton
						key={pv.name}
						pv={pv}
						opts={dateTimeOptsFor(settings)}
						active={pv.name === openName}
						onClick={() => openProperty(pv.name)}
					/>
				))}
				<button
					key="add-property"
					type="button"
					class="eb-badge eb-badge-add"
					aria-label={t('propertyBadges.addProperty')}
					title={t('propertyBadges.addProperty')}
					onClick={addMenu}
				>
					<Icon name="list-plus" class="eb-button-icon" />
				</button>
				{field ? (
					<button
						key="add-tag"
						type="button"
						class={`eb-badge eb-badge-add${tagsOpen ? ' is-active' : ''}`}
						aria-label={t('propertyBadges.addTag')}
						aria-pressed={tagsOpen}
						title={t('propertyBadges.addTag')}
						onClick={toggleTags}
					>
						<Icon name="tag" class="eb-button-icon" />
					</button>
				) : null}
			</div>
			{openName !== null && (
				<ValueEditor
					key={openName}
					name={openName}
					def={openDef}
					pv={openValue}
					api={api}
					settings={settings}
					onCommit={(pv) => commit(pv, openName)}
					onRemove={() => remove(openName)}
					onClose={() => setOpen(null)}
				/>
			)}
			{tagsOpen && field ? (
				<TagPicker field={field} api={api} onClose={() => setTagsOpen(false)} />
			) : null}
		</div>
	);
}

/**
 * A `recurrence` value reads as the same compact sentence the card's badge shows
 * (recurrence.md §5) rather than as the stored English phrase, which is far too
 * long for a chip. The phrase itself stays one hover away, in the title.
 */
function badgeText(pv: PropertyValue, opts: DateTimeOpts): string {
	if (pv.type !== 'recurrence') return formatValue(pv);
	const rule = parseRecurrence(pv.raw);
	return rule ? describeRecurrence(rule, opts, { compact: true }) : pv.raw;
}

function badgeLabel(pv: PropertyValue, opts: DateTimeOpts): string {
	const text = badgeText(pv, opts);
	return text ? `${pv.name}: ${text}` : pv.name;
}

/** The full story behind a shortened label, or nothing when it is not shortened. */
function badgeTooltip(pv: PropertyValue, opts: DateTimeOpts): string | undefined {
	if (pv.type !== 'recurrence') return undefined;
	const rule = parseRecurrence(pv.raw);
	// The raw phrase first: while editing, what the file holds is the fact that
	// matters, and the sentence below it is the reading of that fact.
	return rule ? `${pv.raw}\n${describeRecurrence(rule, opts)}` : pv.raw;
}

function BadgeButton({
	pv,
	opts,
	active,
	onClick,
}: {
	pv: PropertyValue;
	opts: DateTimeOpts;
	active: boolean;
	onClick: () => void;
}) {
	const color = pv.type === 'color' ? safeColor(pv.value) : '';
	const classes = ['eb-badge', 'eb-badge-edit', active ? 'is-active' : '', pv.type === 'raw' ? 'eb-badge-muted' : '']
		.filter(Boolean)
		.join(' ');
	return (
		<button type="button" class={classes} title={badgeTooltip(pv, opts)} onClick={onClick}>
			{color ? <span class="eb-swatch" style={`background: ${color}`} /> : null}
			{pv.type === 'recurrence' ? <Icon name="repeat" class="eb-badge-icon" /> : null}
			<span class="eb-badge-text">{badgeLabel(pv, opts)}</span>
		</button>
	);
}
