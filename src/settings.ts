// Plugin-global settings. Per-board configuration (views, properties, paths)
// lives in each board file's YAML frontmatter, not here.
//
// No global settings are defined yet; this module is the scaffold they will
// attach to. The optional `never` field keeps the type non-empty without
// declaring a real setting prematurely.
export interface ExtraboardSettings {
	readonly _reserved?: never;
}

export const DEFAULT_SETTINGS: ExtraboardSettings = {};
