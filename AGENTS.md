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
sidebar widget. Classification runs in-process:

```
src/classify/types.ts     Candidate, Subject, Choice, Decision, Strategy
src/classify/keyword.ts   KeywordStrategy — TF-IDF with a title-position boost
src/classify/engine.ts    decide() (threshold + top-k) and ancestors()
src/area-suggestion.ts    Obsidian adapter: metadataCache in, AreaSuggestion out
```

`src/classify/` imports **nothing** — no `obsidian`, no `node:`. Keep it that
way: that is what makes it runnable on mobile and testable outside Obsidian.
Everything Obsidian-shaped lives in `src/area-suggestion.ts`. The widget only
renders the result, through the shared `makeIconRow` (icon gutter + title +
optional description) that calendar event rows also use. `updateContent` calls
`renderMedia` and then `renderAreaSuggestions` ahead of the type switch, so
cover art and suggestions are pinned to the top for every note type — do not
put `renderMedia` back inside the per-type renderers. Consequences:

- **No external dependency.** The classifier was ported from the `vault-areas`
  Python package in `~/c/decision-engine`; that repo is no longer required, or
  read, at runtime. The port is exact — verified against the Python engine over
  the 400-note gold set, identical ranking and rationale on every note, max
  score delta 2.2e-16.
- **Day notes are excluded.** `updateContent` skips the section when
  `determineActiveFileType` says `"day"` — a journal page never gets filed
  under an area, so a suggestion there is only noise.
- **The section is hidden whenever the note has a non-empty `areas:` prop**
  (`hasAreas`), cached result or not — applying an area from the list removes
  the section. `areas: []` counts as *no* areas, so the section still shows.
- The classifier runs **only when the button is clicked**, never on note open.
- **Clicking a row files the note under that area** via `processFrontMatter`;
  it does not navigate to the area note. Rows for areas already in the
  frontmatter are inert and carry a ✓.
- The score is colour-coded by confidence, and the bands are measured rather
  than chosen: `evals/calibrate.py` in the decision-engine repo buckets every
  prediction over the gold set by score and reports how often it was right.
  Under 0.75 was right 19% of the time, 0.75–1.50 37%, 1.50+ 53%, which is
  where `CONFIDENCE_MEDIUM` and `CONFIDENCE_HIGH` come from. The bands are
  still valid — the port reproduces the Python scores exactly — but they are
  only valid for `KeywordStrategy`. Re-measure before changing either number,
  or after changing the strategy.
- The cache is keyed by **path alone, not `path:mtime`**. Applying an area
  rewrites frontmatter and bumps mtime, which would otherwise discard the very
  list the user is working through.
- Results are cached per `path:mtime` for the life of the view, so switching
  notes and back doesn't re-run it; editing the note invalidates the entry.
- `AreaSuggestion` keeps its snake_case `existing_areas` field and `note` now
  holds a **vault-relative** path (the Python CLI emitted an absolute one).
- `loadAreas` reads `Areas/*.md` one level deep, via `metadataCache` rather
  than a hand-rolled YAML parser, so real frontmatter rules apply.

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
- **No top-level `node:` imports.** `manifest.json` sets `isDesktopOnly: false`,
  and `vite.config.ts` externalises every builtin — so a top-level
  `import ... from "node:*"` becomes a top-level `require` that throws on
  mobile before the plugin loads. Desktop-only code loads its module lazily,
  inside a `Platform.isDesktopApp` guard, the way `src/calendar.ts` reaches
  `node:child_process`. `require("obsidian")` is the only import that may sit
  at the top of the bundle; check with
  `grep -o 'require("[^"]*")' build/main.js`.
- Imports may use the `@/` alias for `src/` (configured in both `vite.config.ts` and
  `tsconfig.json`).
