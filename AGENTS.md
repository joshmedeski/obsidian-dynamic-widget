# Agent Guidelines

Dynamic Widget is a standalone Obsidian plugin. It was extracted from the
`joshmedeski/obsidian-dynamic` monorepo — there is no workspace, no `catalog:`
protocol, and no shared build package. Everything this repo needs is in this repo.

## Commands

| Script | What it does |
|---|---|
| `npm install` | Installs all deps. Use `npm ci` for reproducible installs (CI does). |
| `npm run dev` | Vite in watch mode. Writes `build/` with inline sourcemaps, no minification, no type-check. |
| `npm run check` | `tsc -noEmit -skipLibCheck` type-checks the TypeScript sources. No emit. |
| `npm run build` | `npm run check` then a minified production bundle. This is the gate before committing. |

- `node_modules/` is gitignored; `package-lock.json` **is** committed.
- `"private": true` — there is no `npm publish`. Obsidian's plugin loader is the only consumer.
- Run `npm run build` before committing (it includes `npm run check`). CI runs the same chain.
- There are no automated tests. Verify by hand in Obsidian — see `CONTRIBUTING.md`.

## Layout

```
public/manifest.json   Plugin metadata. The source of truth for `version`.
public/styles.css      Plugin CSS. Copied verbatim into build/.
src/main.ts            Plugin entry point (default-exported Plugin subclass).
vite.config.ts         Self-contained build config. No shared package.
version-bump.mjs       Bumps public/manifest.json + versions.json together.
build/                 Symlink into the vault. Generated. Never commit, never edit.
```

Anything in `public/` is copied to `build/` on every build by
`vite-plugin-static-copy`. That is how `manifest.json` and `styles.css` reach the
vault — do not write them into `build/` by hand.

## The build symlink

`build/` is a **symlink to the plugin folder inside the vault**:

```
build -> /Users/joshmedeski/c/second-brain/.obsidian/plugins/obsidian-dynamic-widget
```

Vite writes directly into the vault, so a rebuild is immediately live in Obsidian.
Two consequences that matter:

- **`emptyOutDir` is `false` and must stay false.** That directory also holds
  Obsidian's own `data.json` (your plugin settings) and the `.hotreload` marker.
  Emptying it wipes real user data.
- **Never commit `build/`.** It is gitignored. The three shipped artifacts
  (`main.js`, `manifest.json`, `styles.css`) are attached to GitHub releases by CI.

If the symlink is missing (fresh clone), recreate it — see `CONTRIBUTING.md`.

## Area suggestions

Notes with no `areas:` frontmatter render a **Suggested Areas** section in the
sidebar widget. It shells out to the `vault-areas` classifier in
`~/c/decision-engine`:

```bash
uv run --project ~/c/decision-engine classify-note <abs note path> --json --vault <vault path>
```

`src/area-suggestion.ts` owns the subprocess and parses that JSON; the widget
only renders it, through the shared `makeIconRow` (icon gutter + title +
optional description) that calendar event rows also use. `updateContent` calls
`renderMedia` and then `renderAreaSuggestions` ahead of the type switch, so
cover art and suggestions are pinned to the top for every note type — do not
put `renderMedia` back inside the per-type renderers. Consequences:

- **`uv` and the `decision-engine` checkout are required** for the section to
  work. Without them the section renders the stderr from the failed spawn
  instead of results — the rest of the widget is unaffected.
- **Day notes are excluded.** `updateContent` skips the section when
  `determineActiveFileType` says `"day"` — a journal page never gets filed
  under an area, so a suggestion there is only noise.
- **Classifying is gated on the note having no `areas:` prop** (`hasAreas`);
  *displaying* a result is not. Once computed, the list stays up after an area
  is applied so more can be added from it — the section renders whenever
  there's a cached result, whatever the note's type became. `areas: []` counts
  as *having* the prop, so it never triggers a classify.
- The classifier runs **only when the button is clicked**, never on note open.
- **Clicking a row files the note under that area** via `processFrontMatter`;
  it does not navigate to the area note. Rows for areas already in the
  frontmatter are inert and carry a ✓.
- The score is colour-coded by confidence, and the bands are measured rather
  than chosen: `evals/calibrate.py` in the decision-engine repo buckets every
  prediction over the gold set by score and reports how often it was right.
  Under 0.75 was right 19% of the time, 0.75–1.50 37%, 1.50+ 53%, which is
  where `CONFIDENCE_MEDIUM` and `CONFIDENCE_HIGH` come from. Re-run it before
  changing either number, or after changing the strategy.
- The cache is keyed by **path alone, not `path:mtime`**. Applying an area
  rewrites frontmatter and bumps mtime, which would otherwise discard the very
  list the user is working through.
  `updateContent` fires on every `active-leaf-change` and metadata change, so
  spawning there would mean a process per keystroke.
- Results are cached per `path:mtime` for the life of the view, so switching
  notes and back doesn't re-run it; editing the note invalidates the entry.
- The JSON payload shape is defined by `vault_areas.to_dict`, not by the CLI.
  Changing it means changing both repos.

## Releases

Tag-driven. The tag must match `public/manifest.json`'s `version`, no `v` prefix:

```bash
node version-bump.mjs 1.1.0        # updates public/manifest.json AND versions.json
npm run build
git commit -am "chore: bump version to 1.1.0"
git tag 1.1.0
git push origin main 1.1.0
```

`.github/workflows/release.yml` validates the tag against the manifest, rebuilds,
and publishes a GitHub release with `main.js`, `manifest.json`, `styles.css`, and
`versions.json` attached. Tags containing `-` publish as pre-releases.

## Conventions

- Plugin id is `obsidian-dynamic-widget` — it must match the vault folder name and the
  `id` field in `public/manifest.json`. Obsidian keys enable-state off the manifest
  id, so changing it resets the user's settings.
- Use `this.app` for Vault/Workspace access; register every listener and interval
  through `this.register*` so unload actually cleans up.
- Imports may use the `@/` alias for `src/` (configured in both `vite.config.ts` and
  `tsconfig.json`).
