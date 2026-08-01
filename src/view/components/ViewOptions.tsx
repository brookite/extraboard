// The quick view settings: what the active view draws on a card, and the two
// or three knobs that view has of its own. Spec: docs/specs/views.md §5.
//
// A panel rather than an Obsidian `Menu`, because every row here is a *toggle*
// and a menu closes on the first click — turning three badges off would mean
// opening it three times. It hangs off the header button on desktop and rises
// as a sheet on a phone (CSS), and every switch applies immediately through an
// op, so what is on screen is what the file says.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import * as ops from '../../model/ops';
import type { Board, ViewDef, ViewDisplay } from '../../model/types';
import { dateProperties } from '../../model/views';
import type { BoardApi } from '../api';
import { t } from '../../i18n';
import { placeViewOptions, type Position } from '../viewOptionsPosition';

interface Props {
	board: Board;
	view: ViewDef;
	api: BoardApi;
	/**
	 * The header action the panel hangs under, or `null` when it was opened from
	 * the ⋯ menu — on a phone it is a bottom sheet and has nothing to hang from.
	 * Kept as the element, not its box: the same element also has to be excluded
	 * from the outside-click check, or pressing it again would close and reopen
	 * the panel in one gesture.
	 */
	trigger: HTMLElement | null;
	onClose: () => void;
}

function Row({
	label,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<label class={`eb-view-options-row${disabled ? ' is-disabled' : ''}`}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
			/>
			<span>{label}</span>
		</label>
	);
}

export function ViewOptions({ board, view, api, trigger, onClose }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<Position | null>(null);

	// Pointing anywhere else, Escape, or the pane moving underneath all close it
	// — the same contract the card editor has with the rest of the board.
	useEffect(() => {
		const onPointerDown = (evt: Event): void => {
			const target = evt.target;
			if (!(target instanceof Node)) return;
			if (ref.current?.contains(target)) return;
			// The trigger toggles by itself; closing here too would undo its work.
			if (trigger?.contains(target)) return;
			onClose();
		};
		const onKeyDown = (evt: KeyboardEvent): void => {
			if (evt.key === 'Escape') onClose();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [onClose, trigger]);

	// The panel is rendered inside `.eb-root`, while the header trigger is not.
	// Convert both viewport rectangles into root-local coordinates after mount;
	// using the trigger's viewport `top` directly is what placed the panel far
	// below its button in an offset workspace pane.
	useLayoutEffect(() => {
		if (!trigger) return;
		const update = (): void => {
			const panel = ref.current;
			const root = panel?.closest('.eb-root');
			if (!panel || !(root instanceof HTMLElement) || !trigger.isConnected) {
				onClose();
				return;
			}
			setPosition(
				placeViewOptions(trigger.getBoundingClientRect(), root.getBoundingClientRect(), {
					width: panel.offsetWidth,
					height: panel.offsetHeight,
				}),
			);
		};
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	}, [onClose, trigger]);

	const display: ViewDisplay = view.display ?? {};
	const hidden = display.hiddenProperties ?? [];
	const patch = (next: Partial<ViewDisplay>): void => {
		api.update((b) => ops.setViewDisplay(b, view.id, next));
	};

	/** Badge properties: a `color` never was one, so it is not offered here. */
	const badgeProps = board.config.properties.filter((def) => def.type !== 'color');
	const showProperty = (name: string, show: boolean): void => {
		patch({ hiddenProperties: show ? hidden.filter((n) => n !== name) : [...hidden, name] });
	};

	const dates = dateProperties(board.config);

	return (
		<div
			class="eb-view-options"
			ref={ref}
			style={
				trigger
					? position
						? `top: ${String(Math.round(position.top))}px; left: ${String(Math.round(position.left))}px`
						: 'top: 0; left: 0; visibility: hidden'
					: 'bottom: 0; right: 0; left: 0; top: auto'
			}
		>
			{badgeProps.length > 0 ? (
				<>
					<div class="eb-view-options-head">{t('viewOptions.properties')}</div>
					{badgeProps.map((def) => (
						<Row
							key={def.name}
							label={def.name}
							checked={!hidden.includes(def.name)}
							onChange={(value) => showProperty(def.name, value)}
						/>
					))}
				</>
			) : null}

			<div class="eb-view-options-head">{t('viewOptions.elements')}</div>
			<Row
				label={t('viewOptions.tags')}
				checked={!display.hideTags}
				onChange={(value) => patch({ hideTags: !value })}
			/>
			<Row
				label={t('viewOptions.checkbox')}
				checked={!display.hideCheckbox}
				onChange={(value) => patch({ hideCheckbox: !value })}
			/>
			<Row
				label={t('viewOptions.progress')}
				checked={!display.hideProgress}
				onChange={(value) => patch({ hideProgress: !value })}
			/>
			<Row
				label={t('viewOptions.color')}
				checked={!display.hideColor}
				onChange={(value) => patch({ hideColor: !value })}
			/>

			{view.type === 'calendar' ? (
				<>
					<div class="eb-view-options-head">{t('modal.views.dateProperties')}</div>
					{dates.map((def) => {
						const on = view.dateProperties.includes(def.name);
						return (
							<Row
								key={def.name}
								label={def.name}
								checked={on}
								// A calendar needs one property to be a calendar (views.md §4.3).
								disabled={on && view.dateProperties.length === 1}
								onChange={(value) => {
									const next = dates
										.map((d) => d.name)
										.filter((name) =>
											name === def.name ? value : view.dateProperties.includes(name),
										);
									if (!next.length) return;
									api.update((b) => ops.updateView(b, view.id, { dateProperties: next }));
								}}
							/>
						);
					})}
					<div class="eb-view-options-head">{t('modal.views.mode.label')}</div>
					<div class="eb-view-options-choice">
						{(['month', 'week'] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								class={view.mode === mode ? 'is-active' : ''}
								onClick={() => api.update((b) => ops.updateView(b, view.id, { mode }))}
							>
								{t(mode === 'month' ? 'modal.views.mode.month' : 'modal.views.mode.week')}
							</button>
						))}
					</div>
				</>
			) : null}

			{view.type === 'list' ? (
				<>
					<div class="eb-view-options-head">{t('modal.views.controls.label')}</div>
					<div
						class="eb-view-options-radio-group"
						role="radiogroup"
						aria-label={t('modal.views.controls.label')}
					>
						{(['dynamic', 'fixed', 'session'] as const).map((controls) => (
							<label class="eb-view-options-row eb-view-options-radio" key={controls}>
								<input
									type="radio"
									name={`eb-view-controls-${view.id}`}
									value={controls}
									checked={view.controls === controls}
									onChange={(event) => {
										if ((event.target as HTMLInputElement).checked) {
											api.update((b) => ops.updateView(b, view.id, { controls }));
										}
									}}
								/>
								<span>{t(`modal.views.controls.${controls}`)}</span>
							</label>
						))}
					</div>
				</>
			) : null}
		</div>
	);
}
