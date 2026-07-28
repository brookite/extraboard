// The card's property values as editable badges under the inline editor.
// Spec: docs/specs/card-content-and-checklists.md §3.1.
//
// Every edit goes through an op like any other change — there is no confirm
// step and no dirty state to lose.

import { useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import { escapeValue, formatValue, parseValue } from '../../model/properties';
import { parseRecurrence } from '../../model/recurrence';
import type { BoardConfig, Card, PropertyDef, PropertyValue } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { dateTimeOptsFor, type DateTimeOpts } from '../../i18n/dates';
import { describeRecurrence } from '../../i18n/recurrenceText';
import { editRecurrence } from '../../ui/RecurrenceModal';
import { typeLabels } from '../../ui/PropertyDefsEditor';
import type { BoardApi } from '../api';
import { Icon } from './Icon';
import { safeColor } from './style';
import { t } from '../../i18n';
import { showDropdownMenu } from '../../util/menu';

/** Types edited as one text field; the rest have a control of their own. */
const TEXT_TYPES = new Set(['string', 'datetime', 'date-range']);
/** Types whose text is the raw token value, so `;` separates list elements. */
const LIST_TEXT_TYPES = new Set(['date-list', 'raw']);

interface Props {
	config: BoardConfig;
	card: Card;
	target: ops.ItemRef;
	api: BoardApi;
	/** Read for the date/recurrence formatting a badge label needs. */
	settings: ExtraboardSettings;
}

export function PropertyBadges({ config, card, target, api, settings }: Props) {
	// Name of the property whose editor is open; it need not be on the card yet.
	const [open, setOpen] = useState<string | null>(null);

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

	const addMenu = (evt: MouseEvent): void => {
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
						.onClick(() => setOpen(def.name)),
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
						onClick={() => setOpen(pv.name === openName ? null : pv.name)}
					/>
				))}
				<button
					type="button"
					class="eb-badge eb-badge-add"
					aria-label={t('propertyBadges.addProperty')}
					onClick={addMenu}
				>
					<Icon name="plus" />
				</button>
			</div>
			{openName !== null && (
				<ValueEditor
					name={openName}
					def={openDef}
					pv={openValue}
					api={api}
					onCommit={(pv) => commit(pv, openName)}
					onRemove={() => remove(openName)}
					onClose={() => setOpen(null)}
				/>
			)}
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

interface EditorProps {
	name: string;
	def: PropertyDef | undefined;
	pv: PropertyValue | undefined;
	api: BoardApi;
	onCommit: (pv: PropertyValue | null) => void;
	onRemove: () => void;
	onClose: () => void;
}

/**
 * The typed editor for one property. An undeclared property (no definition on
 * the board) is edited as raw text, so foreign tokens stay visible and
 * removable instead of silently invisible.
 */
function ValueEditor({ name, def, pv, api, onCommit, onRemove, onClose }: EditorProps) {
	const type = def?.type ?? 'raw';
	const current = pv ? formatValue(pv) : '';
	const typeLabel = type === 'raw' ? t('propertyDefs.type.raw') : typeLabels()[type];

	const commitText = (text: string): void => {
		const raw = text.trim();
		if (!raw && type !== 'string') {
			onCommit(null);
			return;
		}
		// `parseValue` is the same validator the file goes through, so a value
		// typed here behaves exactly as it would on disk.
		const escaped = LIST_TEXT_TYPES.has(type) ? raw : escapeValue(raw);
		onCommit(parseValue(name, escaped, def));
	};

	return (
		<div class="eb-value-editor">
			<div class="eb-value-editor-head">
				<span class="eb-value-editor-name">{name}</span>
				<span class="eb-value-editor-type">{typeLabel}</span>
			</div>

			{type === 'checkbox' ? (
				<label class="eb-value-row">
					<input
						type="checkbox"
						checked={pv?.type === 'checkbox' && pv.value}
						onChange={(e) => onCommit({ name, type: 'checkbox', value: e.currentTarget.checked })}
					/>
					<span>{name}</span>
				</label>
			) : type === 'color' ? (
				<button
					type="button"
					class="eb-value-color"
					onClick={() => {
						void (async () => {
							const next = await api.pickColor({
								title: name,
								value: pv?.type === 'color' ? pv.value : '',
								clearLabel: t('colorPicker.noColor'),
							});
							if (next === null) return;
							onCommit(next ? { name, type: 'color', value: next } : null);
						})();
					}}
				>
					<span class="eb-swatch" style={`background: ${safeColor(current) || 'transparent'}`} />
					{current || t('propertyBadges.pickAColor')}
				</button>
			) : type === 'string-list' ? (
				<StringListEditor name={name} def={def} pv={pv} onCommit={onCommit} />
			) : type === 'recurrence' ? (
				// A rule is not something to type by hand (recurrence.md §4).
				<button
					type="button"
					class="eb-value-rule"
					onClick={() => {
						void (async () => {
							const next = await editRecurrence(api.app, { name, value: current });
							if (next === null) return;
							onCommit(next ? { name, type: 'recurrence', raw: next } : null);
							onClose();
						})();
					}}
				>
					{current || t('propertyBadges.setRepetitionRule')}
				</button>
			) : (
				<input
					type={type === 'integer' || type === 'percent' ? 'number' : 'text'}
					class="eb-value-input"
					value={current}
					min={type === 'percent' ? 0 : undefined}
					max={type === 'percent' ? 100 : undefined}
					placeholder={
						LIST_TEXT_TYPES.has(type)
							? t('propertyBadges.valueListPlaceholder')
							: TEXT_TYPES.has(type)
								? t('propertyBadges.valuePlaceholder')
								: ''
					}
					autofocus
					onChange={(e) => commitText(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitText(e.currentTarget.value);
							onClose();
						} else if (e.key === 'Escape') {
							e.preventDefault();
							onClose();
						}
					}}
				/>
			)}

			<div class="eb-value-editor-actions">
				<button type="button" class="mod-warning" onClick={onRemove}>
					{t('propertyBadges.remove')}
				</button>
				<button type="button" onClick={onClose}>
					{t('propertyBadges.done')}
				</button>
			</div>
		</div>
	);
}

/**
 * `string-list`: a fixed set of options when the definition is strict, free
 * entry plus the declared options as suggestions otherwise.
 */
function StringListEditor({
	name,
	def,
	pv,
	onCommit,
}: {
	name: string;
	def: PropertyDef | undefined;
	pv: PropertyValue | undefined;
	onCommit: (pv: PropertyValue | null) => void;
}) {
	const selected = pv?.type === 'string-list' ? pv.value : [];
	const options = def?.options?.map((o) => o.value) ?? [];
	const extras = selected.filter((v) => !options.includes(v));

	const set = (values: string[]): void => {
		onCommit(values.length ? { name, type: 'string-list', value: values } : null);
	};
	const toggle = (value: string): void => {
		set(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
	};

	return (
		<div class="eb-value-list">
			{[...options, ...extras].map((value) => (
				<label class="eb-value-row" key={value}>
					<input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
					<span>{value}</span>
				</label>
			))}
			{def?.strict ? null : (
				<input
					type="text"
					class="eb-value-input"
					placeholder={t('propertyDefs.addValue')}
					onKeyDown={(e) => {
						if (e.key !== 'Enter') return;
						e.preventDefault();
						const value = e.currentTarget.value.trim();
						if (!value || selected.includes(value)) return;
						e.currentTarget.value = '';
						set([...selected, value]);
					}}
				/>
			)}
			{!options.length && def?.strict ? (
				<div class="eb-value-empty">{t('propertyBadges.noOptionsDeclared')}</div>
			) : null}
		</div>
	);
}
