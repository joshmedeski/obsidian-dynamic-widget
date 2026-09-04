# Dynamic Widget

An Obsidian sidebar widget that changes with the note you are in — plus a set of
PARA-oriented views for navigating a second brain.

## Views

| View | Command | What it shows |
|---|---|---|
| Dynamic Widget | `Open Dynamic Widget` | Context for the active note: calendar, cover art, related notes, and a footer of resolved links. |
| Areas | `Open Areas` | Your Areas hierarchy, styled from folder emoji, with inline header tags. |
| Someday Maybe | `Open Someday Maybe` | The someday/maybe backlog, sorted by modified time. |
| Private Note | `Toggle Private Mode` | A dedicated leaf for notes you don't want on screen by default. |

The widget follows the active file — if a note is moved or renamed, the sidebar
updates in place rather than going stale.

## Installation

Not in the community plugin list. Install from a release:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Drop them in `<your-vault>/.obsidian/plugins/obsidian-dynamic-widget/`.
3. Enable **Dynamic Widget** in Settings → Community Plugins.

Or point [BRAT](https://github.com/TfTHacker/obsidian42-brat) at this repo.

## Development

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the vault symlink + hot-reload dev loop,
and [`AGENTS.md`](./AGENTS.md) for build and release conventions.

## History

Extracted from the `joshmedeski/obsidian-dynamic` monorepo. The commits before the
extraction commit are the original 2025 esbuild-based version of this plugin; the
current tree is the newer Vite version that was developed in the monorepo.
