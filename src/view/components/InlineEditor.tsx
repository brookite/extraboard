// Inline text editor used for card text, stack names and divider names.
// Enter commits, Escape cancels, blur commits — the behaviour Kanban users
// expect from a card composer.

import { useLayoutEffect, useRef } from 'preact/hooks';

/** Reading and rewriting the live text from outside, without a re-render. */
export interface InlineEditorHandle {
	getValue(): string;
	/** `focus: false` rewrites the text without pulling focus back (tag picker). */
	setValue(text: string, options?: { focus?: boolean }): void;
}

interface Props {
	value?: string;
	placeholder?: string;
	/** Let Enter commit and keep editing, for the add-card composer. */
	keepOpen?: boolean;
	/** Empty input submits an empty string instead of cancelling (a card may be untitled). */
	allowEmpty?: boolean;
	/**
	 * Called with the trimmed text; empty input cancels instead, unless
	 * `allowEmpty`. `again` is true when the editor stays open for the next
	 * entry, so the caller knows whether to close its composer.
	 */
	onSubmit: (text: string, again: boolean) => void;
	onCancel: () => void;
	/** Reports a handle on the live text while this editor is mounted, `null` after. */
	onReady?: (handle: InlineEditorHandle | null) => void;
	class?: string;
}

/** Grow the textarea to fit its content (styling stays in `styles.css`). */
function autosize(el: HTMLTextAreaElement): void {
	el.setCssProps({ '--eb-editor-height': 'auto' });
	el.setCssProps({ '--eb-editor-height': `${String(el.scrollHeight)}px` });
}

export function InlineEditor({
	value = '',
	placeholder,
	keepOpen = false,
	allowEmpty = false,
	onSubmit,
	onCancel,
	onReady,
	class: cls,
}: Props) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const closed = useRef(false);
	// Like every other callback here, read through a ref: the textarea is mounted
	// once and must not be torn down because a parent re-rendered.
	const ready = useRef(onReady);
	ready.current = onReady;

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		autosize(el);
		ready.current?.({
			getValue: () => el.value,
			setValue: (text, options = {}) => {
				el.value = text;
				autosize(el);
				if (options.focus !== false) el.focus();
				el.setSelectionRange(text.length, text.length);
			},
		});
		return () => ready.current?.(null);
	}, []);

	const cancel = (): void => {
		if (closed.current) return;
		closed.current = true;
		onCancel();
	};

	/**
	 * `fromKey` distinguishes Enter from losing focus: only Enter keeps a
	 * composer open, so clicking elsewhere commits without stealing focus back.
	 */
	const submit = (fromKey: boolean): void => {
		const el = ref.current;
		const text = el?.value.trim() ?? '';
		if (!text && !allowEmpty) {
			cancel();
			return;
		}
		if (keepOpen && fromKey && el) {
			onSubmit(text, true);
			el.value = '';
			autosize(el);
			el.focus();
			return;
		}
		if (closed.current) return;
		closed.current = true;
		onSubmit(text, false);
	};

	return (
		<textarea
			ref={ref}
			class={`eb-editor${cls ? ` ${cls}` : ''}`}
			rows={1}
			spellcheck={false}
			placeholder={placeholder ?? ''}
			value={value}
			onInput={(e) => autosize(e.currentTarget)}
			onBlur={() => submit(false)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					submit(true);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					cancel();
				}
			}}
		/>
	);
}
