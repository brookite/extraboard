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
