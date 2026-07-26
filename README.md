# Extraboard

A Markdown-backed Kanban and calendar board plugin for [Obsidian](https://obsidian.md).

Each board is a single Markdown file: stacks are headings, cards are list items,
and card properties are stored inline. The board is deserialized on open and
re-serialized on every change, so the underlying note stays clean and portable.
Designed to be mobile-friendly.

Planned capabilities: a card-and-stack Kanban view and a month/week calendar view,
a typed card-property system (colors, string lists with badge colors, numbers,
percent progress, dates, date ranges, recurrence, checkboxes, tags), per-card
Markdown content, hierarchical checklists with auto `N/M` progress, and an
archive.

## Status

**Early development** — the MVP is being implemented milestone by milestone.
The Kanban side works: boards open in their own view, and cards, stacks and
dividers can be created, edited, dragged, given typed properties and colors,
linked to a note, given a checklist, and archived. A stack can mark the cards
that land in it as done, and a named divider can color the cards in its group.
The calendar view, recurrence and localization are still ahead. This section will be replaced with
setup and usage instructions once the MVP is complete.

## Development

```bash
npm install       # install dependencies
npm run dev       # watch build
npm run build     # production build (tsc type-check + esbuild bundle)
npm run lint      # eslint
npm test          # run the unit tests
```

The build assembles the complete plugin into **`dist/`** (`main.js`,
`manifest.json`, `styles.css`). For manual testing, copy or symlink `dist/` to
`<Vault>/.obsidian/plugins/extraboard/`, then reload Obsidian and enable the
plugin under **Settings → Community plugins**.

## License

0-BSD — see [LICENSE](LICENSE).
