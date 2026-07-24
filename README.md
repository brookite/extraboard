# Extraboard

A Markdown-backed Kanban and calendar board plugin for [Obsidian](https://obsidian.md).

Each board is a single Markdown file: stacks are headings, cards are list items,
and card properties are stored inline. The board is deserialized on open and
re-serialized on every change, so the underlying note stays clean and portable.
Designed to be mobile-friendly.

Planned capabilities: a Trello-like Kanban view and a month/week calendar view,
a typed card-property system (colors, string lists with badge colors, numbers,
percent progress, dates, date ranges, recurrence, checkboxes, tags), per-card
Markdown content, hierarchical checklists with auto `N/M` progress, and an
archive.

## Status

**Early development** — the MVP is being implemented milestone by milestone.
The plugin currently builds and loads but has no user-facing features yet. This
section will be replaced with setup and usage instructions as features land.

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
