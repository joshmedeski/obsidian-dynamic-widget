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
