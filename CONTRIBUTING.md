# Contributing

Thanks for your interest in improving Dynamic Widget. This guide gets you to a live
dev loop against your own vault.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [Obsidian](https://obsidian.md/)
- A vault you are willing to load an unofficial plugin into

## 1. Clone and install

```bash
git clone https://github.com/joshmedeski/obsidian-dynamic-widget-staging.git
cd obsidian-dynamic-widget-staging
npm install
```

## 2. Create the plugin folder in your vault

Obsidian loads any folder under `.obsidian/plugins/` that contains a valid
`manifest.json`. Name it after the plugin id so the folder, the manifest, and
Obsidian's enable-state all agree:

```bash
mkdir -p "<path-to-your-vault>/.obsidian/plugins/obsidian-dynamic-widget"
```

## 3. Point `build/` at it

The build output directory is a symlink into the vault, so every rebuild is live:

```bash
rm -rf build
ln -s "<path-to-your-vault>/.obsidian/plugins/obsidian-dynamic-widget" build
ls -la build   # build -> .../.obsidian/plugins/obsidian-dynamic-widget
```

> The symlink goes **repo → vault**, not the other way around. If `build/` is ever a
> real directory, Obsidian will not see your changes and `data.json` may be lost on
> a clean build.

## 4. Install Hot-Reload (recommended)

Install [Hot-Reload](https://github.com/pjeby/hot-reload) by pjeby from Community
Plugins, enable it, then drop a marker file in the plugin folder so it watches this
plugin:

```bash
touch build/.hotreload
```

Now every rebuild reloads the plugin without restarting Obsidian.

## 5. Run the dev loop

```bash
npm run dev     # vite watch -> writes straight into the vault
```

Before committing:

```bash
npm run build   # runs npm run check first
```

## 6. Verify in Obsidian

1. Settings → Community Plugins, turn off Restricted Mode.
2. Enable **Dynamic Widget**.
3. Exercise the change, and check the developer console (`Cmd + Option + I`) for errors.

## Troubleshooting

- **Plugin missing from the list** — confirm `build/manifest.json` exists and that
  `build` resolves into your vault (`ls -la build`).
- **Changes not appearing** — is `npm run dev` still running? Is `build/.hotreload`
  present? Some changes (new commands, new views) still need a full reload.
- **Build errors after a pull** — `rm -rf node_modules && npm install`.

## Conventions

See [`AGENTS.md`](./AGENTS.md) for build, release, and code conventions.
