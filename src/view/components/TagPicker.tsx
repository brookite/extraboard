// The tag picker under the card's inline editor: a searchable, scrollable list
// of every tag the board and the vault know, with the card's own marked.
// Spec: docs/specs/card-content-and-checklists.md §3.1.1.
//
// It edits the **field's text**, not the board: tags live in the card's line
// and the field owns that text until it closes (model/tags.ts).

import { Platform } from 'obsidian';
import type { RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { boardTags, isTagName, tagsInText, toggleTag } from '../../model/tags';
import type { BoardApi } from '../api';
import type { CardField } from '../CardEditor';
import { vaultTags } from '../../util/vaultTags';
import { Icon } from './Icon';
import { t } from '../../i18n';

/**
 * How many rows are ever in the DOM at once. The list scrolls, but a vault with
 * thousands of tags would otherwise build thousands of elements to draw ten of
 * them — the search field is the way through a list that long, not the scrollbar.
 */
const MAX_ROWS = 200;

interface Props {
	field: RefObject<CardField | null>;
	api: BoardApi;
	onClose: () => void;
}

export function TagPicker({ field, api, onClose }: Props) {
	const [query, setQuery] = useState('');
	// The field's text, mirrored so the checks re-render as tags go on and off.
	// Seeded from the field, and every write goes through both.
	const [text, setText] = useState(() => field.current?.getValue() ?? '');
	const searchRef = useRef<HTMLInputElement>(null);

	// Not on a phone: there the picker is a modal (mobile.md §7.1) and the
	// software keyboard would cover the list the user came to tap. The search is
	// one tap away for a vault whose tags need narrowing.
	useEffect(() => {
		if (!Platform.isMobile) searchRef.current?.focus();
	}, []);

	// Read once per picker: the vault index is a large object to walk, and
	// neither list changes while one picker is open.
	const candidates = useMemo(() => {
		const board = api.getBoard();
		const own = board ? boardTags(board) : [];
		const seen = new Set(own);
		return [...own, ...vaultTags(api.app).filter((tag) => !seen.has(tag))];
	}, [api]);

	const current = tagsInText(text);
	// A tag the card wears that neither the board nor the vault index knows yet
	// (just typed, not saved) still belongs at the top, where it can be removed.
	const known = new Set(candidates);
	const pool = [...current.filter((tag) => !known.has(tag)), ...candidates];

	const typed = query.trim().replace(/^#/, '');
	const needle = typed.toLowerCase();
	const matches = needle ? pool.filter((tag) => tag.toLowerCase().includes(needle)) : pool;
	const shown = matches.slice(0, MAX_ROWS);
	const canCreate = isTagName(typed) && !matches.includes(typed);

	const toggle = (tag: string): void => {
		const live = field.current;
		if (!live) return;
		// Re-read: the user may have typed in the field since the picker opened.
		const next = toggleTag(live.getValue(), tag);
		// Focus stays here, so several tags are several clicks and nothing else.
		live.setValue(next, { focus: false });
		setText(next);
	};

	return (
		<div class="eb-tag-picker">
			<input
				ref={searchRef}
				type="text"
				class="eb-value-input"
				placeholder={t('tagPicker.search')}
				value={query}
				onInput={(e) => setQuery(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						onClose();
						return;
					}
					if (e.key !== 'Enter') return;
					e.preventDefault();
					// Enter takes the obvious one: the single match, else the new tag.
					const first = shown[0];
					if (canCreate && !shown.length) toggle(typed);
					else if (first) toggle(first);
					setQuery('');
				}}
			/>

			<div class="eb-tag-picker-list">
				{canCreate ? (
					<button type="button" class="eb-tag-picker-row is-new" onClick={() => toggle(typed)}>
						<Icon name="plus" class="eb-button-icon" />
						<span class="eb-tag-picker-name">{t('tagPicker.create', { tag: typed })}</span>
					</button>
				) : null}
				{shown.map((tag) => {
					const on = current.includes(tag);
					return (
						<button
							key={tag}
							type="button"
							class={`eb-tag-picker-row${on ? ' is-on' : ''}`}
							onClick={() => toggle(tag)}
						>
							<Icon name={on ? 'check' : 'tag'} class="eb-button-icon" />
							<span class="eb-tag-picker-name">#{tag}</span>
						</button>
					);
				})}
				{!shown.length && !canCreate ? (
					<div class="eb-value-empty">{t('tagPicker.empty')}</div>
				) : null}
			</div>

			<div class="eb-tag-picker-foot">
				{matches.length > shown.length ? (
					<span class="eb-tag-picker-hint">
						{t('tagPicker.more', { count: matches.length - shown.length })}
					</span>
				) : (
					<span />
				)}
				<button type="button" onClick={onClose}>
					{t('propertyBadges.done')}
				</button>
			</div>
		</div>
	);
}
