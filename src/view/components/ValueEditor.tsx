// The typed editor for one property value, as it appears under the card's
// badge row — and, on a phone, as the body of a modal instead (mobile.md §7.1).
// Spec: docs/specs/card-content-and-checklists.md §3.1.
//
// Split out of `PropertyBadges` so the modal can mount the very same editor:
// one implementation, two hosts, no second rendering of dates to keep in step.

import { useRef } from 'preact/hooks';
import { escapeValue, formatValue, parseValue } from '../../model/properties';
import type { PropertyDef, PropertyValue } from '../../model/types';
import type { ExtraboardSettings } from '../../settings';
import { editRecurrence } from '../../ui/RecurrenceModal';
import { typeLabels } from '../../ui/PropertyDefsEditor';
import type { BoardApi } from '../api';
import { safeColor } from './style';
import { t } from '../../i18n';
import { DateValueEditor, type DateEditorHandle } from './DateValueEditor';

/** Types edited as one text field; the rest have a control of their own. */
const TEXT_TYPES = new Set(['string']);
/** Types whose text is the raw token value, so `;` separates list elements. */
const LIST_TEXT_TYPES = new Set(['raw']);

/**
 * The types whose editor is a **panel** rather than a control: a calendar, or a
 * list of options to tick. Those are the ones tall enough to push the card out
 * of view when they open under the badge row, so on a phone they open as a
 * modal instead (mobile.md §7.1). An undeclared property has no definition and
 * so is never one of them.
 */
export const PANEL_TYPES: ReadonlySet<PropertyDef['type']> = new Set<PropertyDef['type']>([
	'datetime',
	'date-range',
	'date-list',
	'string-list',
]);

export interface EditorProps {
	name: string;
	def: PropertyDef | undefined;
	pv: PropertyValue | undefined;
	api: BoardApi;
	settings: ExtraboardSettings;
	onCommit: (pv: PropertyValue | null) => void;
	onRemove: () => void;
	onClose: () => void;
}

/**
 * The typed editor for one property. An undeclared property (no definition on
 * the board) is edited as raw text, so foreign tokens stay visible and
 * removable instead of silently invisible.
 */
export function ValueEditor({ name, def, pv, api, settings, onCommit, onRemove, onClose }: EditorProps) {
	const type = def?.type ?? 'raw';
	// What the date editor leaves here for this panel's own buttons: **Done**
	// saves a selection that has nothing else to save it, and **Remove** tells
	// the editor to stop guarding the entry it took out of the list
	// (2026-08-01-v0.3.1-date-editor.md §2.1).
	const dateEditor = useRef<DateEditorHandle | null>(null);
	dateEditor.current = null;
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
			) : type === 'datetime' || type === 'date-range' || type === 'date-list' ? (
				<DateValueEditor
					name={name}
					type={type}
					def={def}
					pv={pv}
					api={api}
					settings={settings}
					onCommit={onCommit}
					handleRef={dateEditor}
				/>
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
				<button
					type="button"
					class="mod-warning"
					onClick={() => {
						dateEditor.current?.forget();
						onRemove();
					}}
				>
					{t('propertyBadges.remove')}
				</button>
				<button
					type="button"
					onClick={() => {
						dateEditor.current?.commit?.();
						onClose();
					}}
				>
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
