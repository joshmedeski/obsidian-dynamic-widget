import { MarkdownView, Plugin, type TFile } from 'obsidian';

import { AreasView, VIEW_TYPE_AREAS } from './areas-view';
import {
  DynamicWidgetView,
  VIEW_TYPE_DYNAMIC_WIDGET,
} from './dynamic-widget-view';
import { EditorFooter } from './editor-footer';
import {
  PrivateNoteView,
  VIEW_TYPE_PRIVATE_NOTE,
} from './private-note-view';
import {
  SomedayMaybeView,
  VIEW_TYPE_SOMEDAY_MAYBE,
} from './someday-maybe-view';
import { isFilePrivate } from './utils';

interface PluginData {
  privateMode: boolean;
}

const DEFAULT_DATA: PluginData = { privateMode: false };

export default class DynamicWidgetPlugin extends Plugin {
  private editorFooter = new EditorFooter();
  privateMode = false;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    const data = (await this.loadData()) as PluginData | null;
    this.privateMode = data?.privateMode ?? DEFAULT_DATA.privateMode;

    this.editorFooter.attach(this);
    // Register the dynamic widget view
    this.registerView(
      VIEW_TYPE_DYNAMIC_WIDGET,
      (leaf) => new DynamicWidgetView(leaf, this)
    );

    // Register the private note view
    this.registerView(
      VIEW_TYPE_PRIVATE_NOTE,
      (leaf) => new PrivateNoteView(leaf)
    );

    // Register the areas view
    this.registerView(
      VIEW_TYPE_AREAS,
      (leaf) => new AreasView(leaf, this)
    );

    // Register the someday maybe view
    this.registerView(
      VIEW_TYPE_SOMEDAY_MAYBE,
      (leaf) => new SomedayMaybeView(leaf, this)
    );

    // Intercept private file opens
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!this.privateMode || !file) return;
        if (!this.isFilePrivateCheck(file)) return;
        const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
        if (!leaf) return;
        leaf.setViewState({
          type: VIEW_TYPE_PRIVATE_NOTE,
          state: { filePath: file.path },
        });
      }),
    );

    // Add command to toggle the dynamic widget
    this.addCommand({
      id: 'open-dynamic-widget',
      name: 'Open Dynamic Widget',
      callback: () => {
        this.activateView();
      },
    });

    // Add command to open areas view
    this.addCommand({
      id: 'open-areas-view',
      name: 'Open Areas',
      callback: () => {
        this.activateAreasView();
      },
    });

    // Add command to open someday maybe view
    this.addCommand({
      id: 'open-someday-maybe-view',
      name: 'Open Someday Maybe',
      callback: () => {
        this.activateSomedayMaybeView();
      },
    });

    // Private mode toggle command
    this.addCommand({
      id: 'toggle-private-mode',
      name: 'Toggle Private Mode',
      callback: () => {
        this.togglePrivateMode();
      },
    });

    // Status bar indicator
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();
  }

  private isFilePrivateCheck(file: TFile): boolean {
    return file.path.startsWith('Relationships/') || isFilePrivate(this.app, file);
  }

  private async togglePrivateMode(): Promise<void> {
    this.privateMode = !this.privateMode;
    await this.saveData({ privateMode: this.privateMode } satisfies PluginData);
    this.updateStatusBar();

    if (this.privateMode) {
      // Replace open private files with private note view
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const file = (leaf.view as MarkdownView).file;
        if (file && this.isFilePrivateCheck(file)) {
          leaf.setViewState({
            type: VIEW_TYPE_PRIVATE_NOTE,
            state: { filePath: file.path },
          });
        }
      }
    } else {
      // Restore files from private note views
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PRIVATE_NOTE)) {
        const filePath = leaf.getViewState()?.state?.filePath as
          | string
          | undefined;
        if (filePath) {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (file) {
            await leaf.openFile(file as TFile);
          }
        }
      }
    }

    // Re-render widget view
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DYNAMIC_WIDGET);
    for (const leaf of leaves) {
      const view = leaf.view as DynamicWidgetView;
      view.refreshContent();
    }

    // Re-render editor footer
    this.editorFooter.refresh();

    // Re-render areas view
    const areasLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AREAS);
    for (const leaf of areasLeaves) {
      (leaf.view as AreasView).refreshContent();
    }

    // Re-render someday maybe view
    const somedayLeaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_SOMEDAY_MAYBE,
    );
    for (const leaf of somedayLeaves) {
      (leaf.view as SomedayMaybeView).refreshContent();
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.setText(this.privateMode ? '🔒' : '');
  }

  async activateView() {
    // Reuse an existing widget leaf rather than detaching and rebuilding it,
    // so running the command twice doesn't move the pane or lose its state.
    const existing = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_DYNAMIC_WIDGET,
    );
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_DYNAMIC_WIDGET,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async activateAreasView() {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_AREAS,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async activateSomedayMaybeView() {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_SOMEDAY_MAYBE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    this.editorFooter.detach();
    // Deliberately does NOT detach leaves. Obsidian keeps them across a plugin
    // reload and rebuilds the views once onload re-registers the view types --
    // that is what lets Hot-Reload swap in a new build without the sidebar
    // disappearing. Detaching here would close the user's panes on every save.
  }
}
