// Renders a Lucide icon via Obsidian's setIcon, so board glyphs match the
// rest of the app and follow the user's theme.

import { setIcon } from 'obsidian';
import { useLayoutEffect, useRef } from 'preact/hooks';

export function Icon({ name, class: cls }: { name: string; class?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		if (ref.current) setIcon(ref.current, name);
	}, [name]);
	return <span ref={ref} class={cls} />;
}

interface ButtonProps {
	icon: string;
	label: string;
	class?: string;
	onClick: (event: MouseEvent) => void;
}

/** A small icon-only button with an accessible label and a tooltip. */
export function IconButton({ icon, label, class: cls, onClick }: ButtonProps) {
	return (
		<button
			type="button"
			class={`eb-icon-button${cls ? ` ${cls}` : ''}`}
			aria-label={label}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				onClick(e);
			}}
		>
			<Icon name={icon} class="eb-button-icon" />
		</button>
	);
}
