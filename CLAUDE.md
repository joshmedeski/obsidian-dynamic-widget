# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development build with watch mode (compiles TypeScript to JavaScript)
- `npm run build` - Production build with TypeScript type checking
- `npm version patch/minor/major` - Bump version in manifest.json, package.json, and versions.json

## Architecture

This is an Obsidian plugin built with TypeScript that follows the standard Obsidian plugin architecture:

- **main.ts**: Entry point containing the main plugin class that extends Obsidian's Plugin base class
- **esbuild.config.mjs**: Build configuration that bundles TypeScript into main.js for Obsidian
- **manifest.json**: Plugin metadata including ID, version, and compatibility requirements
- **versions.json**: Version compatibility mapping for different Obsidian versions

### Plugin Structure

The plugin follows Obsidian's lifecycle pattern:
- `onload()`: Initialize plugin features (commands, ribbons, settings, event handlers)
- `onunload()`: Cleanup when plugin is disabled
- Settings are persisted using `loadData()`/`saveData()`

### Key Components

- **Commands**: Added via `addCommand()` for palette integration
- **Ribbon Icons**: Left sidebar icons via `addRibbonIcon()`
- **Modals**: Custom dialogs extending Obsidian's Modal class
- **Settings Tab**: Plugin configuration via PluginSettingTab

### Build Process

The build uses esbuild to:
- Bundle TypeScript into a single main.js file
- External dependencies (obsidian, electron, codemirror) are excluded from bundle
- Development builds include inline sourcemaps and watch mode
- Production builds are minified without sourcemaps

## Plugin Installation

For manual installation, copy `main.js`, `styles.css`, and `manifest.json` to the vault's `.obsidian/plugins/[plugin-id]/` directory.
