export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Position {
	left: number;
	top: number;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Position a view-options panel inside the board root. */
export function placeViewOptions(trigger: Box, root: Box, panel: Size): Position {
	const inset = 4;
	return {
		left: clamp(trigger.right - root.left - panel.width, inset, root.width - panel.width - inset),
		top: clamp(trigger.bottom - root.top + inset, inset, root.height - panel.height - inset),
	};
}
