// A cheap, synchronous label for surfaces that cannot render inline Markdown.
// Presentation only: the stored title and content-note binding stay untouched.
import { basename, parseCardLink } from './link';

/** A card title as readable text, including every link's display label. */
export function plainCardTitle(title: string): string {
	const literals: string[] = [];
	let marker = '\uE000';
	while (title.includes(marker)) marker += '\uE000';
	const protect = (text: string): string => {
		literals.push(text);
		return `${marker}${literals.length - 1}${marker}`;
	};
	// Code and escaped punctuation are literal even when they resemble links or
	// emphasis. Protect them before interpreting the other inline constructs.
	let text = title.replace(/(`+)([\s\S]*?)\1(?!`)|\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g,
		(_match, ticks: string | undefined, code: string | undefined, escaped: string | undefined) => {
			if (!ticks) return protect(escaped ?? '');
			let value = (code ?? '').replace(/\n/g, ' ');
			if (value.startsWith(' ') && value.endsWith(' ') && value.trim()) value = value.slice(1, -1);
			return protect(value);
		});
	text = text
		.replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, '')
		.replace(/!?\[\[([^[\]]*)\]\]/g, (_match, inner: string) => {
			const link = parseCardLink(`[[${inner}]]`);
			if (link) return link.display;
			const [target = '', alias] = inner.split('|');
			return alias?.trim() || basename(target.split('#')[0] ?? '') || target;
		})
		// Targets may contain balanced parentheses (common in URLs); labels may
		// contain bracketed prose. Destinations and optional link titles are hidden.
		.replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g,
			(_match, label: string) => label)
		.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/gi, (_match, url: string) => url.replace(/^mailto:/i, ''))
		.replace(/<\/?[a-zA-Z][^>]*>/g, '');
	// Peel formatting from the outside in, preserving underscores inside words
	// and unmatched punctuation instead of treating every marker as disposable.
	let previous: string;
	do {
		previous = text;
		text = text
			.replace(/(\*\*|__|~~|==)(?=\S)(\S(?:[\s\S]*?\S)?)\1/g, '$2')
			.replace(/(?<!\w)([*_])(?=\S)(\S(?:[\s\S]*?\S)?)\1(?!\w)/g, '$2');
	} while (text !== previous);
	const entities: Record<string, string> = {
		amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
	};
	text = text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
		if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
		const hex = entity[1]?.toLowerCase() === 'x';
		const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
		return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
			? String.fromCodePoint(point) : match;
	});
	const literalPattern = new RegExp(`${marker}(\\d+)${marker}`, 'g');
	return text.replace(literalPattern, (_match, index: string) => literals[Number(index)] ?? '')
		.replace(/\s+/g, ' ').trim();
}
