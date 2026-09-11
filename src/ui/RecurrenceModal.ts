// The repetition-rule form. Spec: docs/specs/recurrence.md §4.
//
// A rule is hard to read back from a set of controls, so the form always shows
// what it is about to write — the canonical phrase — and the next three days it
// produces. That preview is the thing that makes a rule checkable.

import { App, Modal, Setting, TextComponent } from 'obsidian';
import { CalDate, dayKey, formatDate, parseDate, today, weekday } from '../model/dates';
import {
	Freq,
	Recurrence,
	expandRecurrence,
	formatRecurrence,
	parseRecurrence,
} from '../model/recurrence';
import { t } from '../i18n';

// Display only — the stored phrase's own weekday/month names stay English file
// syntax regardless of UI language (recurrence.md §1.1, §7).
function weekdayLabels(): string[] {
	return [
		t('modal.recurrence.weekday.mon'),
		t('modal.recurrence.weekday.tue'),
		t('modal.recurrence.weekday.wed'),
		t('modal.recurrence.weekday.thu'),
		t('modal.recurrence.weekday.fri'),
		t('modal.recurrence.weekday.sat'),
		t('modal.recurrence.weekday.sun'),
	];
}
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

function ordinalLabels(): [string, 1 | 2 | 3 | 4 | -1][] {
	return [
		[t('modal.recurrence.ordinal.first'), 1],
		[t('modal.recurrence.ordinal.second'), 2],
		[t('modal.recurrence.ordinal.third'), 3],
		[t('modal.recurrence.ordinal.fourth'), 4],
		[t('modal.recurrence.ordinal.last'), -1],
	];
}

function everyUnitDesc(freq: Freq): string {
	switch (freq) {
		case 'day':
			return t('modal.recurrence.everyUnit.day');
		case 'week':
			return t('modal.recurrence.everyUnit.week');
		case 'month':
			return t('modal.recurrence.everyUnit.month');
		case 'year':
			return t('modal.recurrence.everyUnit.year');
	}
}

function monthLabels(): string[] {
	return [
		t('modal.recurrence.month.jan'),
		t('modal.recurrence.month.feb'),
		t('modal.recurrence.month.mar'),
		t('modal.recurrence.month.apr'),
		t('modal.recurrence.month.may'),
		t('modal.recurrence.month.jun'),
		t('modal.recurrence.month.jul'),
		t('modal.recurrence.month.aug'),
		t('modal.recurrence.month.sep'),
		t('modal.recurrence.month.oct'),
		t('modal.recurrence.month.nov'),
		t('modal.recurrence.month.dec'),
	];
}

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
		this.titleEl.setText(t('modal.recurrence.titlePrefix', { name: this.options.name }));
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
			.setName(t('modal.recurrence.repeats'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						day: t('modal.recurrence.freq.day'),
						week: t('modal.recurrence.freq.week'),
						month: t('modal.recurrence.freq.month'),
						year: t('modal.recurrence.freq.year'),
					})
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
			.setDesc(everyUnitDesc(rule.freq));

		if (rule.freq === 'week') this.renderWeekdays(el);
		if (rule.freq === 'month') this.renderMonthly(el);
		if (rule.freq === 'year') this.renderYearly(el);

		new Setting(el).setName(t('modal.recurrence.starts')).addText((text) => {
			this.asDatePicker(text, this.startText);
			text.onChange((value) => {
				this.startText = value;
				this.rule.start = parseDate(value) ?? undefined;
				this.renderPreview();
			});
		});

		new Setting(el)
			.setName(t('modal.recurrence.ends'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						never: t('modal.recurrence.end.never'),
						until: t('modal.recurrence.end.until'),
						count: t('modal.recurrence.end.count'),
					})
					.setValue(this.end)
					.onChange((value) => {
						this.end = value as End;
						this.applyEnd();
						this.render();
					}),
			);

		if (this.end === 'until') {
			new Setting(el).setName(t('modal.recurrence.until')).addText((text) => {
				this.asDatePicker(text, this.untilText);
				text.onChange((value) => {
					this.untilText = value;
					this.rule.until = parseDate(value) ?? undefined;
					this.renderPreview();
				});
			});
		}
		if (this.end === 'count') {
			new Setting(el).setName(t('modal.recurrence.times')).addText((text) => {
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
		const clear = buttons.createEl('button', {
			cls: 'mod-warning',
			text: t('modal.recurrence.noRepetition'),
		});
		clear.addEventListener('click', () => this.finish(''));
		const cancel = buttons.createEl('button', { text: t('common.cancel') });
		cancel.addEventListener('click', () => {
			this.close();
		});
		const confirm = buttons.createEl('button', { cls: 'mod-cta', text: t('modal.boardSettings.save') });
		confirm.addEventListener('click', () => {
			if (this.problem() === null) this.finish(formatRecurrence(this.rule));
		});
	}

	private renderWeekdays(el: HTMLElement): void {
		const setting = new Setting(el).setName(t('modal.recurrence.on'));
		const row = setting.controlEl.createDiv({ cls: 'eb-weekday-row' });
		const labels = weekdayLabels();
		WEEKDAY_VALUES.forEach((day, i) => {
			const button = row.createEl('button', { text: labels[i], cls: 'eb-weekday' });
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
			.setName(t('modal.recurrence.on'))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						day: t('modal.recurrence.dayOfMonth'),
						nth: t('modal.recurrence.weekdayOfMonth'),
					})
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
			new Setting(el).setName(t('modal.recurrence.day')).addText((text) => {
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
		const weekLabels = weekdayLabels();
		new Setting(el)
			.setName(t('modal.recurrence.the'))
			.addDropdown((dropdown) => {
				for (const [label, value] of ordinalLabels()) dropdown.addOption(String(value), label);
				dropdown.setValue(String(nth.ordinal)).onChange((value) => {
					this.rule.nth = { ordinal: Number(value) as 1 | 2 | 3 | 4 | -1, weekday: nth.weekday };
					this.renderPreview();
				});
			})
			.addDropdown((dropdown) => {
				WEEKDAY_VALUES.forEach((day, i) => {
					dropdown.addOption(String(day), weekLabels[i] ?? '');
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
			.setName(t('modal.recurrence.on'))
			.addDropdown((dropdown) => {
				monthLabels().forEach((label, i) => {
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
			text: next.length
				? t('modal.recurrence.next', { days: next.map(formatDate).join(', ') })
				: t('modal.recurrence.noDays'),
		});
	}

	/** What stops the rule from being saved, or `null` when it is fine. */
	private problem(): string | null {
		const rule = this.rule;
		if (!rule.start) return t('modal.recurrence.problem.startNotDate');
		if (rule.interval < 1) return t('modal.recurrence.problem.intervalTooSmall');
		if (rule.freq === 'week' && rule.weekdays && rule.weekdays.length === 0) {
			return t('modal.recurrence.problem.needWeekday');
		}
		if (this.end === 'until' && !rule.until) return t('modal.recurrence.problem.endNotDate');
		if (rule.until && rule.start && formatDate(rule.until) < formatDate(rule.start)) {
			return t('modal.recurrence.problem.endBeforeStart');
		}
		if (this.end === 'count' && (rule.count ?? 0) < 1) return t('modal.recurrence.problem.countTooSmall');
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

	/**
	 * A whole date is picked, not typed: `type="date"` is the one control both
	 * platforms already have a calendar for — Obsidian's own date fields use it,
	 * and on a phone it is the system picker rather than a keyboard.
	 *
	 * It accepts `YYYY-MM-DD` and nothing else, so the value it is shown is the
	 * day alone. A hand-written rule that carried a time on its `from`/`until`
	 * keeps it: the rule is only rewritten when the field actually changes.
	 */
	private asDatePicker(text: TextComponent, value: string): void {
		text.inputEl.type = 'date';
		text.inputEl.addClass('eb-date-input');
		const date = parseDate(value);
		text.setValue(date ? dayKey(date) : '');
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
