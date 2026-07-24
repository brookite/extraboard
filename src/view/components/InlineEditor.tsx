// Inline text editor used for card text, stack names and divider names.
// Enter commits, Escape cancels, blur commits — the behaviour Kanban users
// expect from a card composer.

import { useLayoutEffect, useRef } from 'preact/hooks';

interface Props {
	value?: string;
	placeholder?: string;
	/** Let Enter commit and keep editing, for the add-card composer. */
	keepOpen?: boolean;
	/**
	 * Called with the trimmed text; empty input cancels instead. `again` is true
	 * when the editor stays open for the next entry, so the caller knows whether
	 * to close its composer.
	 */
	onSubmit: (text: string, again: boolean) => void;
	onCancel: () => void;
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
	onSubmit,
	onCancel,
	class: cls,
}: Props) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const closed = useRef(false);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		autosize(el);
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
		if (!text) {
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
