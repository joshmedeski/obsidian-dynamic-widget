import { debounce, ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import {
  HOME_WIDGETS,
  type HomeColumn,
  type HomeWidget,
  type WidgetContext,
} from "./home-widgets";
import type DynamicWidgetPlugin from "./main";

export const VIEW_TYPE_HOME = "dynamic-home-view";

const HOME_COLUMNS: HomeColumn[] = ["main", "side"];

export class HomeView extends ItemView {
  private plugin: DynamicWidgetPlugin;
  private gridEl: HTMLElement = document.createElement("div");
  private bodies = new Map<string, HTMLElement>();
  private headings = new Map<string, HTMLElement>();
  private scheduleRefresh = debounce(() => this.refresh(), 500, true);

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HOME;
  }

  getDisplayText(): string {
    return "Home";
  }

  getIcon(): string {
    return "home";
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("home-view-container");
    this.gridEl = container.createDiv("home-view-content").createDiv("home-grid");
    this.refreshContent();

    const onVault = () => this.scheduleRefresh();
    this.registerEvent(this.app.metadataCache.on("changed", onVault));
    this.registerEvent(this.app.vault.on("create", onVault));
    this.registerEvent(this.app.vault.on("delete", onVault));
    this.registerEvent(this.app.vault.on("rename", onVault));
  }

  refreshContent(): void {
    this.gridEl.empty();
    this.bodies.clear();
    this.headings.clear();
    const columns = new Map<HomeColumn, HTMLElement>();
    for (const column of HOME_COLUMNS) {
      columns.set(column, this.gridEl.createDiv(`home-column is-${column}`));
    }
    for (const widget of HOME_WIDGETS) {
      const card = (columns.get(widget.column) ?? this.gridEl).createDiv("home-widget");
      card.dataset.widget = widget.id;
      if (widget.title) {
        const heading = card.createEl("h2", { cls: "home-widget-title" });
        this.headings.set(widget.id, heading);
        const onTitleClick = widget.onTitleClick;
        if (onTitleClick) {
          heading.addClass("is-clickable");
          heading.addEventListener("click", () => onTitleClick(this.context()));
        }
      }
      this.bodies.set(widget.id, card.createDiv("home-widget-body"));
      this.renderWidget(widget);
    }
  }

  private refresh(): void {
    for (const widget of HOME_WIDGETS) this.renderWidget(widget);
  }

  private renderWidget(widget: HomeWidget): void {
    const old = this.bodies.get(widget.id);
    if (!old) return;
    const body = createDiv("home-widget-body");
    old.replaceWith(body);
    this.bodies.set(widget.id, body);
    const count = widget.count?.(this.app);
    this.headings.get(widget.id)?.setText(count == null ? widget.title : `${widget.title} (${count})`);
    void Promise.resolve(widget.render(body, this.context())).catch((error: unknown) => {
      body.empty();
      body.createEl("p", { text: `Couldn't load: ${String(error)}`, cls: "home-widget-empty" });
    });
  }

  private context(): WidgetContext {
    return {
      app: this.app,
      plugin: this.plugin,
      open: (file: TFile) => void this.leaf.openFile(file),
    };
  }
}
