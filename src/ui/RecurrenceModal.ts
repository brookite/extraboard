// The repetition-rule form. Spec: docs/specs/recurrence.md §4.
//
// A rule is hard to read back from a set of controls, so the form always shows
// what it is about to write — the canonical phrase — and the next three days it
// produces. That preview is the thing that makes a rule checkable.

import { App, Modal, Setting } from 'obsidian';
import { CalDate, formatDate, parseDate, today, weekday } from '../model/dates';
import {
	Freq,
	Recurrence,
	expandRecurrence,
	formatRecurrence,
	parseRecurrence,
} from '../model/recurrence';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];
const ORDINAL_LABELS: [string, 1 | 2 | 3 | 4 | -1][] = [
	['First', 1],
	['Second', 2],
	['Third', 3],
	['Fourth', 4],
	['Last', -1],
];
const MONTH_LABELS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

type End = 'never' | 'until' | 'count';

/**
 * Edit a rule. Resolves to the canonical phrase, `''` when the rule was
 * cleared, or `null` when the dialog was dismissed — the shape the color picker
 * already uses.
 */
export function editRecurrence(app: App, options: { name: string; value: string }): Promise<string | null> {
	return new Promise((resolve) => {
		new RecurrenceModal(app, options, resolve).open();
	});
}

class RecurrenceModal extends Modal {
	private rule: Recurrence;
	private end: End;
	private startText: string;
	private untilText: string;
	private resolved = false;

	constructor(
		app: App,
		private readonly options: { name: string; value: string },
		private readonly done: (value: string | null) => void,
	) {
		super(app);
		// An unparseable value is not thrown away silently: the form opens on a
		// weekly rule anchored today, and the old text stays until the user saves.
		const parsed = parseRecurrence(options.value);
		this.rule = parsed ?? { freq: 'week', interval: 1, weekdays: [weekday(today())], start: today() };
		this.end = this.rule.until ? 'until' : this.rule.count !== undefined ? 'count' : 'never';
		this.startText = this.rule.start ? formatDate(this.rule.start) : formatDate(today());
		this.untilText = this.rule.until ? formatDate(this.rule.until) : '';
	}

	override onOpen(): void {
		this.titleEl.setText(`Repeat: ${this.options.name}`);
		this.modalEl.addClass('eb-recurrence-modal');
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		const rule = this.rule;

		new Setting(el)
			.setName('Repeats')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' })
					.setValue(rule.freq)
					.onChange((value) => {
						this.setFreq(value as Freq);
						this.render();
					}),
			)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.addClass('eb-recurrence-interval');
				text
					.setValue(String(rule.interval))
					.onChange((value) => {
						const n = Number(value);
						this.rule.interval = Number.isInteger(n) && n >= 1 ? n : 1;
						this.renderPreview();
					});
			})
			.setDesc(`every N ${rule.freq}s`);

		if (rule.freq === 'week') this.renderWeekdays(el);
		if (rule.freq === 'month') this.renderMonthly(el);
		if (rule.freq === 'year') this.renderYearly(el);

		new Setting(el).setName('Starts').addText((text) =>
			text
				.setPlaceholder('2026-07-27')
				.setValue(this.startText)
				.onChange((value) => {
					this.startText = value;
					this.rule.start = parseDate(value) ?? undefined;
					this.renderPreview();
				}),
		);

		new Setting(el)
			.setName('Ends')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ never: 'Never', until: 'On date', count: 'After N times' })
					.setValue(this.end)
					.onChange((value) => {
						this.end = value as End;
						this.applyEnd();
						this.render();
					}),
			);

		if (this.end === 'until') {
			new Setting(el).setName('Until').addText((text) =>
				text
					.setPlaceholder('2026-12-31')
					.setValue(this.untilText)
					.onChange((value) => {
						this.untilText = value;
						this.rule.until = parseDate(value) ?? undefined;
						this.renderPreview();
					}),
			);
		}
		if (this.end === 'count') {
			new Setting(el).setName('Times').addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.setValue(String(this.rule.count ?? 1)).onChange((value) => {
					const n = Number(value);
					this.rule.count = Number.isInteger(n) && n >= 1 ? n : 1;
					this.renderPreview();
				});
			});
		}

		el.createDiv({ cls: 'eb-recurrence-preview' });
		this.renderPreview();

		const buttons = el.createDiv({ cls: 'modal-button-container' });
		const clear = buttons.createEl('button', { cls: 'mod-warning', text: 'No repetition' });
		clear.addEventListener('click', () => this.finish(''));
		const cancel = buttons.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const confirm = buttons.createEl('button', { cls: 'mod-cta', text: 'Save' });
		confirm.addEventListener('click', () => {
			if (this.problem() === null) this.finish(formatRecurrence(this.rule));
		});
	}

	private renderWeekdays(el: HTMLElement): void {
		const setting = new Setting(el).setName('On');
		const row = setting.controlEl.createDiv({ cls: 'eb-weekday-row' });
		WEEKDAY_VALUES.forEach((day, i) => {
			const button = row.createEl('button', { text: WEEKDAY_LABELS[i], cls: 'eb-weekday' });
			if (this.rule.weekdays?.includes(day)) button.addClass('is-on');
			button.addEventListener('click', () => {
				const days = new Set(this.rule.weekdays ?? []);
				if (days.has(day)) days.delete(day);
				else days.add(day);
				this.rule.weekdays = [...days].sort((a, b) => a - b);
				this.render();
			});
		});
	}

	private renderMonthly(el: HTMLElement): void {
		const byDay = this.rule.monthDay !== undefined;
		new Setting(el)
			.setName('On')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ day: 'Day of month', nth: 'Weekday of month' })
					.setValue(byDay ? 'day' : 'nth')
					.onChange((value) => {
						if (value === 'day') {
							this.rule.monthDay = this.rule.start?.d ?? 1;
							delete this.rule.nth;
						} else {
							this.rule.nth = { ordinal: 1, weekday: 1 };
							delete this.rule.monthDay;
						}
						this.render();
					}),
			);

		if (byDay) {
			new Setting(el).setName('Day').addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.max = '31';
				text.setValue(String(this.rule.monthDay ?? 1)).onChange((value) => {
					const n = Number(value);
					this.rule.monthDay = Number.isInteger(n) && n >= 1 && n <= 31 ? n : 1;
					this.renderPreview();
				});
			});
			return;
		}

		const nth = this.rule.nth ?? { ordinal: 1 as const, weekday: 1 };
		new Setting(el)
			.setName('The')
			.addDropdown((dropdown) => {
				for (const [label, value] of ORDINAL_LABELS) dropdown.addOption(String(value), label);
				dropdown.setValue(String(nth.ordinal)).onChange((value) => {
					this.rule.nth = { ordinal: Number(value) as 1 | 2 | 3 | 4 | -1, weekday: nth.weekday };
					this.renderPreview();
				});
			})
			.addDropdown((dropdown) => {
				WEEKDAY_VALUES.forEach((day, i) => {
					dropdown.addOption(String(day), WEEKDAY_LABELS[i] ?? '');
				});
				dropdown.setValue(String(nth.weekday)).onChange((value) => {
					this.rule.nth = { ordinal: nth.ordinal, weekday: Number(value) };
					this.renderPreview();
				});
			});
	}

	private renderYearly(el: HTMLElement): void {
		const month = this.rule.month ?? this.rule.start?.m ?? 1;
		const day = this.rule.day ?? this.rule.start?.d ?? 1;
		new Setting(el)
			.setName('On')
			.addDropdown((dropdown) => {
				MONTH_LABELS.forEach((label, i) => {
					dropdown.addOption(String(i + 1), label);
				});
				dropdown.setValue(String(month)).onChange((value) => {
					this.rule.month = Number(value);
					this.rule.day = day;
					this.renderPreview();
				});
			})
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.max = '31';
				text.setValue(String(day)).onChange((value) => {
					const n = Number(value);
					this.rule.month = month;
					this.rule.day = Number.isInteger(n) && n >= 1 && n <= 31 ? n : 1;
					this.renderPreview();
				});
			});
	}

	/** The phrase plus the next three days it produces (§4). */
	private renderPreview(): void {
		const el = this.contentEl.querySelector('.eb-recurrence-preview');
		if (!(el instanceof HTMLElement)) return;
		el.empty();

		const problem = this.problem();
		if (problem) {
			el.createDiv({ cls: 'eb-recurrence-problem', text: problem });
			return;
		}

		el.createDiv({ cls: 'eb-recurrence-phrase', text: formatRecurrence(this.rule) });
		const anchor = this.rule.start ?? today();
		const next = expandRecurrence(this.rule, anchor, anchor, { ...anchor, y: anchor.y + 5 }, 3);
		el.createDiv({
			cls: 'eb-recurrence-next',
			text: next.length ? `Next: ${next.map(formatDate).join(', ')}` : 'This rule produces no days.',
		});
	}

	/** What stops the rule from being saved, or `null` when it is fine. */
	private problem(): string | null {
		const rule = this.rule;
		if (!rule.start) return 'The start date is not a date (YYYY-MM-DD).';
		if (rule.interval < 1) return 'Repeat every one period or more.';
		if (rule.freq === 'week' && rule.weekdays && rule.weekdays.length === 0) {
			return 'Choose at least one weekday.';
		}
		if (this.end === 'until' && !rule.until) return 'The end date is not a date (YYYY-MM-DD).';
		if (rule.until && rule.start && formatDate(rule.until) < formatDate(rule.start)) {
			return 'The end date is before the start date.';
		}
		if (this.end === 'count' && (rule.count ?? 0) < 1) return 'Repeat at least once.';
		return null;
	}

	private setFreq(freq: Freq): void {
		const rule = this.rule;
		rule.freq = freq;
		delete rule.weekdays;
		delete rule.monthDay;
		delete rule.nth;
		delete rule.month;
		delete rule.day;
		const start: CalDate = rule.start ?? today();
		if (freq === 'week') rule.weekdays = [weekday(start)];
		if (freq === 'month') rule.monthDay = start.d;
		if (freq === 'year') {
			rule.month = start.m;
			rule.day = start.d;
		}
	}

	private applyEnd(): void {
		if (this.end !== 'until') delete this.rule.until;
		if (this.end !== 'count') delete this.rule.count;
		if (this.end === 'count' && this.rule.count === undefined) this.rule.count = 10;
		if (this.end === 'until' && !this.rule.until) this.rule.until = parseDate(this.untilText) ?? undefined;
	}

	private finish(value: string | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.done(value);
		if (value !== null) this.close();
	}
}
