// The condition builder: a tree of groups and conditions, dragged with the same
// Sortable plumbing the board uses. Spec: docs/specs/filters-and-sorting.md §4.
//
// Nodes are addressed by path, and a drag speaks in *ordinals*: every group gets
// a number during the render, its children container carries it as `data-list`,
// and the drop handler turns the pair back into paths. That is what lets one
// numeric protocol (`view/useSortable.ts`) carry a tree.

import { useRef } from 'preact/hooks';
import type { App } from 'obsidian';
import {
	FilterCondition,
	FilterGroup,
	FilterNode,
	NodePath,
	emptyGroup,
	nextCondition,
} from '../../model/filter';
import { editorFor, needsSecondValue, defaultOp, OPS_BY_KIND, supportsOp } from '../../model/filterOps';
import { FieldRef, fieldId, fieldKind } from '../../model/fieldValue';
import type { BoardConfig } from '../../model/types';
import { FileSuggest } from '../../ui/FileSuggest';
import { useSortable, type DropInfo } from '../useSortable';
import { Icon } from './Icon';
import { t } from '../../i18n';

export interface FieldOption {
	field: FieldRef;
	id: string;
	label: string;
}

/** Every field a filter or a sort can name: the card's own, then the board's. */
export function fieldOptions(config: BoardConfig): FieldOption[] {
	const builtins: FieldOption[] = (['title', 'tags', 'done', 'note'] as const).map((id) => ({
		field: { kind: 'builtin', id },
		id: `@${id}`,
		label: t(`filter.field.${id}`),
	}));
	const properties: FieldOption[] = config.properties.map((def) => ({
		field: { kind: 'property', name: def.name },
		id: def.name,
		label: def.name,
	}));
	return [...builtins, ...properties];
}

export function fieldLabel(field: FieldRef, config: BoardConfig): string {
	if (field.kind === 'builtin') return t(`filter.field.${field.id}`);
	return config.properties.some((p) => p.name === field.name)
		? field.name
		: t('filter.missingField', { name: field.name });
}

/** The operand a row shows, and how it is typed. */
function ValueEditor({
	app,
	config,
	condition,
	tags,
	second,
	onChange,
}: {
	app: App;
	config: BoardConfig;
	condition: FilterCondition;
	tags: string[];
	/** Edit `value2` — the upper bound of `between`. */
	second?: boolean;
	onChange: (value: string) => void;
}) {
	const suggestRef = useRef<HTMLInputElement>(null);
	const field = condition.field;
	const kind = fieldKind(config, field);
	const def =
		field.kind === 'property' ? config.properties.find((p) => p.name === field.name) : undefined;
	const options =
		field.kind === 'builtin' && field.id === 'tags'
			? tags
			: (def?.options ?? []).map((option) => option.value);
	const editor = editorFor(kind, condition.op, options.length > 0);
	const value = (second ? condition.value2 : condition.value) ?? '';

	if (editor === 'none') return null;

	if (editor === 'option') {
		return (
			<select
				class="eb-filter-value dropdown"
				value={value}
				onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
			>
				<option value="">{t('filter.anyValue')}</option>
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		);
	}

	if (editor === 'file') {
		return (
			<input
				class="eb-filter-value"
				type="text"
				ref={(el) => {
					// Mounted once per field: the suggester attaches to the element and
					// lives as long as it does.
					if (el && el !== suggestRef.current) {
						suggestRef.current = el;
						new FileSuggest(app, el, onChange);
					}
				}}
				placeholder={t('filter.notePlaceholder')}
				value={value}
				onInput={(e) => onChange((e.target as HTMLInputElement).value)}
			/>
		);
	}

	return (
		<input
			class="eb-filter-value"
			type={editor === 'date' ? 'date' : editor === 'number' ? 'number' : 'text'}
			value={value}
			placeholder={t('filter.valuePlaceholder')}
			onInput={(e) => onChange((e.target as HTMLInputElement).value)}
		/>
	);
}

interface TreeProps {
	app: App;
	config: BoardConfig;
	/** Every tag the board uses — the suggestions a tag condition offers. */
	tags: string[];
	root: FilterGroup;
	/** Ordinal of each group, by path key; the drag protocol's coordinate. */
	ordinals: Map<string, number>;
	onChange: (path: NodePath, next: FilterNode) => void;
	onRemove: (path: NodePath) => void;
	onAdd: (path: NodePath, node: FilterNode) => void;
	onDrop: (info: DropInfo) => void;
}

function ConditionRow({
	app,
	config,
	tags,
	condition,
	path,
	index,
	onChange,
	onRemove,
}: {
	app: App;
	config: BoardConfig;
	tags: string[];
	condition: FilterCondition;
	path: NodePath;
	index: number;
	onChange: (path: NodePath, next: FilterNode) => void;
	onRemove: (path: NodePath) => void;
}) {
	const kind = fieldKind(config, condition.field);
	const ops = OPS_BY_KIND[kind];

	const pickField = (id: string): void => {
		const option = fieldOptions(config).find((entry) => entry.id === id);
		if (!option) return;
		const nextKind = fieldKind(config, option.field);
		// Keep the operator when the new field still understands it; otherwise the
		// row falls back to that kind's first one rather than to nothing.
		const op = supportsOp(nextKind, condition.op) ? condition.op : defaultOp(nextKind);
		onChange(path, { ...condition, field: option.field, op });
	};

	return (
		<div class="eb-filter-node eb-filter-condition" data-index={index}>
			<span class="eb-filter-grip" aria-hidden="true">
				<Icon name="grip-vertical" />
			</span>
			<select
				class="eb-filter-field dropdown"
				value={fieldId(condition.field)}
				onChange={(e) => pickField((e.target as HTMLSelectElement).value)}
			>
				{fieldOptions(config).map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
			<select
				class="eb-filter-op dropdown"
				value={condition.op}
				onChange={(e) =>
					onChange(path, {
						...condition,
						op: (e.target as HTMLSelectElement).value as FilterCondition['op'],
					})
				}
			>
				{ops.map((op) => (
					<option key={op} value={op}>
						{t(`filter.op.${op}`)}
					</option>
				))}
			</select>
			<ValueEditor
				app={app}
				config={config}
				condition={condition}
				tags={tags}
				onChange={(value) => onChange(path, { ...condition, value })}
			/>
			{needsSecondValue(condition.op) ? (
				<>
					<span class="eb-filter-and">{t('filter.and')}</span>
					<ValueEditor
						app={app}
						config={config}
						condition={condition}
						tags={tags}
						second
						onChange={(value2) => onChange(path, { ...condition, value2 })}
					/>
				</>
			) : null}
			<button
				type="button"
				class="eb-icon-button"
				aria-label={t('filter.removeCondition')}
				onClick={() => onRemove(path)}
			>
				<Icon name="x" />
			</button>
		</div>
	);
}

export function GroupNode({
	group,
	path,
	index,
	root,
	...rest
}: TreeProps & { group: FilterGroup; path: NodePath; index: number; root: FilterGroup }) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const isRoot = path.length === 0;
	useSortable(
		bodyRef,
		{ group: 'eb-filter-nodes', draggable: '.eb-filter-node', handle: '.eb-filter-grip' },
		rest.onDrop,
	);

	return (
		<div class={`eb-filter-group${isRoot ? ' is-root' : ''} eb-filter-node`} data-index={index}>
			{isRoot ? null : (
				<div class="eb-filter-group-head">
					<span class="eb-filter-grip" aria-hidden="true">
						<Icon name="grip-vertical" />
					</span>
					<select
						class="eb-filter-join dropdown"
						value={group.op}
						onChange={(e) =>
							rest.onChange(path, {
								...group,
								op: (e.target as HTMLSelectElement).value as FilterGroup['op'],
							})
						}
					>
						{(['and', 'or', 'not'] as const).map((op) => (
							<option key={op} value={op}>
								{t(`filter.join.${op}`)}
							</option>
						))}
					</select>
					<button
						type="button"
						class="eb-icon-button"
						aria-label={t('filter.removeGroup')}
						onClick={() => rest.onRemove(path)}
					>
						<Icon name="x" />
					</button>
				</div>
			)}

			<div
				class="eb-filter-children"
				ref={bodyRef}
				data-list={rest.ordinals.get(path.join('.')) ?? 0}
			>
				{group.children.map((child, i) =>
					child.kind === 'group' ? (
						<GroupNode
							key={i}
							{...rest}
							root={root}
							group={child}
							path={[...path, i]}
							index={i}
						/>
					) : (
						<ConditionRow
							key={i}
							app={rest.app}
							config={rest.config}
							tags={rest.tags}
							condition={child}
							path={[...path, i]}
							index={i}
							onChange={rest.onChange}
							onRemove={rest.onRemove}
						/>
					),
				)}
				{group.children.length === 0 ? (
					<div class="eb-filter-empty">{t('filter.emptyGroup')}</div>
				) : null}
			</div>

			<div class="eb-filter-add">
				<button type="button" onClick={() => rest.onAdd(path, nextCondition(group))}>
					<Icon name="plus" class="eb-button-icon" />
					<span>{t('filter.addCondition')}</span>
				</button>
				<button type="button" onClick={() => rest.onAdd(path, emptyGroup('and'))}>
					<Icon name="folder-plus" class="eb-button-icon" />
					<span>{t('filter.addGroup')}</span>
				</button>
			</div>
		</div>
	);
}

/** Pre-order numbering of the groups — the drag protocol's `data-list`. */
export function groupOrdinals(root: FilterNode): { ordinals: Map<string, number>; paths: NodePath[] } {
	const ordinals = new Map<string, number>();
	const paths: NodePath[] = [];
	const walk = (node: FilterNode, path: NodePath): void => {
		if (node.kind !== 'group') return;
		ordinals.set(path.join('.'), paths.length);
		paths.push(path);
		node.children.forEach((child, i) => walk(child, [...path, i]));
	};
	walk(root, []);
	return { ordinals, paths };
}
