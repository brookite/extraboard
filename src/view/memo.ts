// A shallow-compare memo for function components. Spec: docs/plans/m10-perf.md §2.
//
// Preact ships `memo` in `preact/compat`, which is a React-compatibility layer
// this plugin needs nothing else from — and the bundle's parse cost is the
// plugin's real startup cost on a phone (`docs/NOTICES.md` §"Board startup
// cost"). `memo` itself is a class component with a `shouldComponentUpdate`,
// which core Preact supports, so it is written out here instead.
//
// It only pays off because `model/ops.ts` preserves object identity for
// everything an edit did not touch: a memoized card is handed the *same* card
// object across an unrelated edit and skips its whole subtree. Props must
// therefore be identity-stable — no inline lambdas, no freshly built objects —
// or `memo` is a no-op with extra steps.

import { Component, createElement, type ComponentType, type VNode } from 'preact';

function shallowEqual(a: object, b: object): boolean {
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	for (const key in left) if (!(key in right) || left[key] !== right[key]) return false;
	for (const key in right) if (!(key in left)) return false;
	return true;
}

/**
 * Skip a re-render when every prop is identical (`===`). Children are compared
 * like any other prop, so a memoized component must not take any: JSX builds a
 * fresh vnode for them on every render, which would never compare equal.
 */
export function memo<P extends object>(inner: ComponentType<P>): ComponentType<P> {
	class Memoized extends Component<P> {
		override shouldComponentUpdate(next: P): boolean {
			return !shallowEqual(this.props, next);
		}

		override render(): VNode<P> {
			return createElement(inner, this.props);
		}
	}
	// Keeps the component's name in Preact's devtools, where the whole point of
	// this change is verified.
	Object.defineProperty(Memoized, 'name', { value: `Memo(${inner.name})` });
	return Memoized;
}
