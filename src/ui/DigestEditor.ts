// The digest section of Board settings: per kind on/off, time, date
// properties, the weekly first day, and the filter and sort.
// Spec: docs/specs/digest-and-reminders.md §3.1, §6.

import { App, Setting } from 'obsidian';
import { countConditions, type FilterNode } from '../model/filter';
import { DEFAULT_DIGEST_TIME, DIGEST_KINDS, type DigestConfig, type DigestDef, type DigestKind } from '../model/digest';
import type { SortRule } from '../model/sort';
import type { Board, BoardConfig, PropertyDef } from '../model/types';
import { isCalendarProperty } from '../model/views';
import { currentLanguage, t } from '../i18n';
import { weekdayName } from '../i18n/dates';
import { openFilterSortModal, type FilterSortTabs } from './FilterSortModal';

/** A deep copy of plain settings data (definitions hold no functions or dates). */
export function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export interface DefinitionEditorOptions {
	/** The draft's declared properties, read afresh on every render. */
	properties: () => readonly PropertyDef[];
	/** The draft configuration, which a filter's fields are read against. */
	config: () => BoardConfig;
	/** The board being configured, for tag, stack and section suggestions. */
	board?: Board;
}

/**
 * A button opening the condition builder for a definition — a digest's or a
 * reminder's — and labelled with what it already holds.
 */
export function definitionFilterButton(
	app: App,
	parent: HTMLElement,
	options: DefinitionEditorOptions,
	spec: {
		label: string;
		tabs: FilterSortTabs;
		filter?: FilterNode;
		sorts?: SortRule[];
		onApply: (filter: FilterNode | undefined, sorts: SortRule[] | undefined) => void;
	},
): void {
	const conditions = spec.tabs === 'sorts' ? 0 : countConditions(spec.filter);
	const sorts = spec.tabs === 'filters' ? 0 : (spec.sorts?.length ?? 0);
	const count = conditions + sorts;
	const button = parent.createEl('button', {
		text: count ? `${spec.label} (${String(count)})` : spec.label,
	});
	if (count) button.addClass('mod-cta');
	button.addEventListener('click', () => {
		openFilterSortModal(app, {
			...(options.board && { board: options.board }),
			config: options.config(),
			title: spec.label,
			tabs: spec.tabs,
			...(spec.filter && { filter: spec.filter }),
			...(spec.sorts && { sorts: spec.sorts }),
			onApply: (result) =>
				spec.onApply(result.filter ?? undefined, result.sorts.length ? result.sorts : undefined),
		});
	});
}

export class DigestEditor {
	private digest: DigestConfig;

	constructor(
		private readonly app: App,
		private readonly container: HTMLElement,
		digest: DigestConfig | undefined,
		private readonly onChange: (digest: DigestConfig | undefined) => void,
		private readonly options: DefinitionEditorOptions,
	) {
		this.digest = cloneJson(digest ?? {});
	}

	render(): void {
		const el = this.container;
		el.empty();
		for (const kind of DIGEST_KINDS) this.renderKind(el, kind);
	}

	private renderKind(el: HTMLElement, kind: DigestKind): void {
		const def = this.digest[kind];
		new Setting(el)
			.setName(t(`digest.editor.${kind}.name`))
			.setDesc(t(`digest.editor.${kind}.desc`))
			.addToggle((toggle) =>
				toggle.setValue(def !== undefined).onChange((on) => {
					if (on) this.digest[kind] = { time: DEFAULT_DIGEST_TIME };
					else delete this.digest[kind];
					this.commit();
				}),
			);
		if (!def) return;

		const box = el.createDiv({ cls: 'eb-pe' });
		const row = box.createDiv({ cls: 'eb-pe-row' });
		const head = row.createDiv({ cls: 'eb-pe-head' });

		head.createSpan({ cls: 'eb-pe-label', text: t('digest.editor.time') });
		const time = head.createEl('input', { type: 'time', cls: 'eb-digest-time' });
		time.value = def.time;
		time.addEventListener('change', () => {
			def.time = time.value || DEFAULT_DIGEST_TIME;
			this.commit();
		});

		if (kind === 'weekly') {
			head.createSpan({ cls: 'eb-pe-label', text: t('digest.editor.weekStart') });
			const select = head.createEl('select', { cls: 'dropdown eb-pe-type' });
			select.createEl('option', { text: t('digest.editor.weekStartPlugin') }).value = '';
			for (let day = 0; day < 7; day++) {
				select.createEl('option', { text: weekdayName(day, currentLanguage()) }).value = String(day);
			}
			select.value = def.weekStart === undefined ? '' : String(def.weekStart);
			select.addEventListener('change', () => {
				if (select.value === '') delete def.weekStart;
				else def.weekStart = Number(select.value);
				this.commit();
			});
		}

		this.renderProperties(row, def);

		const actions = row.createDiv({ cls: 'eb-pe-option' });
		definitionFilterButton(this.app, actions, this.options, {
			label: t('digest.editor.filterAndSort'),
			tabs: 'both',
			filter: def.filter,
			sorts: def.sorts,
			onApply: (filter, sorts) => {
				if (filter) def.filter = filter;
				else delete def.filter;
				if (sorts) def.sorts = sorts;
				else delete def.sorts;
				this.commit();
			},
		});
	}

	/** One checkbox per date property; none ticked means every one (§3.1). */
	private renderProperties(row: HTMLElement, def: DigestDef): void {
		const names = this.options
			.properties()
			.filter((p) => isCalendarProperty(p))
			.map((p) => p.name);
		const line = row.createDiv({ cls: 'eb-pe-option' });
		line.createSpan({ cls: 'eb-pe-label', text: t('digest.editor.properties') });
		if (!names.length) {
			line.createSpan({ cls: 'eb-pe-empty', text: t('digest.editor.noDateProperties') });
			return;
		}
		const chosen = def.properties ?? [];
		for (const name of names) {
			const label = line.createEl('label', { cls: 'eb-pe-check' });
			const box = label.createEl('input', { type: 'checkbox' });
			box.checked = chosen.includes(name);
			label.appendText(name);
			box.addEventListener('change', () => {
				const next = names.filter((n) => (n === name ? box.checked : chosen.includes(n)));
				if (next.length) def.properties = next;
				else delete def.properties;
				this.commit();
			});
		}
		if (!chosen.length) line.createSpan({ cls: 'eb-pe-empty', text: t('digest.editor.allProperties') });
	}

	private commit(): void {
		const has = this.digest.daily || this.digest.weekly;
		this.onChange(has ? cloneJson(this.digest) : undefined);
		this.render();
	}
}
