import { ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import { type AreaNode, getAreaHierarchy } from "./areas-hierarchy";
import type DynamicWidgetPlugin from "./main";
import {
  formatRelativeDeadline,
  isFilePrivate,
  isValidHex,
  normalizeAreasFrontmatter,
  redactText,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_SOMEDAY_MAYBE = "someday-maybe-view";
const FOLDER_PREFIX = "Projects/Someday Maybe/";
const TARGET_COLUMN_WIDTH = 380;
const MAX_CARD_COLUMNS = 6;
const MIN_ITEMS_PER_COLUMN = 3;
const RESIZE_EPSILON = 16;

export class SomedayMaybeView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;
  private resizeObserver: ResizeObserver | null = null;
  private layoutFrame: number | null = null;
  private lastGridWidth = 0;

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SOMEDAY_MAYBE;
  }

  getDisplayText(): string {
    return "Someday Maybe";
  }

  getIcon(): string {
    return "hourglass";
  }

  refreshContent(): void {
    this.renderContent();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("someday-maybe-container");

    this.contentEl = container.createEl("div", {
      cls: "someday-maybe-content",
    });

    this.setupResizeObserver();
    this.renderContent();

    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        if (
          file.path.startsWith(FOLDER_PREFIX) ||
          file.path.startsWith("Areas/")
        ) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (
          file.path.startsWith(FOLDER_PREFIX) ||
          file.path.startsWith("Areas/")
        ) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (
          file.path.startsWith(FOLDER_PREFIX) ||
          file.path.startsWith("Areas/") ||
          oldPath.startsWith(FOLDER_PREFIX) ||
          oldPath.startsWith("Areas/")
        ) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (
          file.path.startsWith(FOLDER_PREFIX) ||
          file.path.startsWith("Areas/")
        ) {
          this.renderContent();
        }
      }),
    );
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {
    this.teardownResizeObserver();
    this.contentEl = document.createElement("div");
  }

  private renderContent(): void {
    this.contentEl.empty();

    this.contentEl.createEl("div", {
      text: "🔮 Someday Maybe",
      cls: "someday-maybe-title",
    });

    const projects = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(FOLDER_PREFIX));

    if (projects.length === 0) {
      this.contentEl.createEl("p", {
        text: "No someday-maybe projects found.",
        cls: "areas-view-empty",
      });
      return;
    }

    const grid = this.contentEl.createEl("div", {
      cls: "someday-maybe-grid",
    });

    const hierarchy = getAreaHierarchy(this.app);
    const claimed = new Set<string>();

    for (const node of hierarchy) {
      const areaPaths = collectAreaPaths(node);
      const matching = projects.filter((f) => {
        if (claimed.has(f.path)) return false;
        const meta = this.app.metadataCache.getFileCache(f);
        const fileAreas = meta?.frontmatter?.areas;
        if (!fileAreas) return false;
        return normalizeAreasFrontmatter(fileAreas).some((raw) => {
          const linkpath = simplifyWikiLink(raw);
          // Resolves aliases natively — handles `areas: [[Some Alias]]`.
          const resolved = this.app.metadataCache.getFirstLinkpathDest(
            linkpath,
            f.path,
          );
          return resolved != null && areaPaths.has(resolved.path);
        });
      });

      if (matching.length === 0) continue;

      for (const f of matching) claimed.add(f.path);

      const label =
        node.priority != null
          ? `${node.priority}. ${node.file.basename}`
          : node.file.basename;

      this.renderCard(grid, label, node.file, matching);
    }

    const uncategorized = projects.filter((f) => !claimed.has(f.path));
    if (uncategorized.length > 0) {
      this.renderCard(grid, "Uncategorized", null, uncategorized);
    }

    this.applyResponsiveColumns(grid);
  }

  private renderCard(
    grid: HTMLElement,
    label: string,
    areaFile: TFile | null,
    files: TFile[],
  ): void {
    const card = grid.createEl("section", {
      cls: "someday-maybe-card dynamic-widget-area-group",
    });
    card.dataset.itemCount = String(files.length);

    if (areaFile) {
      const areaMeta = this.app.metadataCache.getFileCache(areaFile);
      const isAreaPrivate =
        this.plugin.privateMode && isFilePrivate(this.app, areaFile);
      const rawColor = areaMeta?.frontmatter?.color;
      const color =
        !isAreaPrivate && isValidHex(rawColor) ? rawColor.trim() : null;
      if (color) {
        card.classList.add("has-color");
        card.style.setProperty("--area-color", color);
      }
    }

    card.createEl("h4", {
      text: label,
      cls: "dynamic-widget-time-group-label",
    });

    card.appendChild(this.makeProjectList(files));
  }

  private makeProjectList(list: TFile[]): HTMLElement {
    const ulEl = document.createElement("ul");
    ulEl.classList.add("emoji-bullet-list");

    const sorted = [...list].sort((a, b) => b.stat.mtime - a.stat.mtime);

    for (const note of sorted) {
      const li = document.createElement("li");
      li.classList.add("emoji-bullet-item");

      const isPrivate =
        this.plugin.privateMode && isFilePrivate(this.app, note);

      const metadata = this.app.metadataCache.getFileCache(note);
      const icon = metadata?.frontmatter?.icon;
      li.style.setProperty("--emoji-bullet", icon ? `"${icon}"` : "'⏺️'");

      const title = metadata?.frontmatter?.title || note.basename;
      const linkEl = li.createEl("a", {
        text: isPrivate ? redactText(title) : title,
      });

      if (isPrivate) {
        linkEl.classList.add("dynamic-widget-private");
      } else {
        linkEl.addEventListener("click", (event) => {
          event.preventDefault();
          this.app.workspace.getLeaf("tab").openFile(note);
        });
      }

      const deadline = metadata?.frontmatter?.deadline;
      if (deadline != null) {
        const deadlineLabel = formatRelativeDeadline(deadline);
        if (deadlineLabel) {
          li.createEl("div", {
            text: deadlineLabel,
            cls: "dynamic-widget-project-deadline",
          });
        }
      }

      ulEl.appendChild(li);
    }

    return ulEl;
  }

  private setupResizeObserver(): void {
    this.teardownResizeObserver();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      const grid = this.contentEl.querySelector<HTMLElement>(
        ".someday-maybe-grid",
      );
      if (!grid) return;

      const width = Math.round(grid.clientWidth || this.contentEl.clientWidth);
      if (!width || Math.abs(width - this.lastGridWidth) < RESIZE_EPSILON) {
        return;
      }

      if (this.layoutFrame != null) {
        return;
      }

      this.layoutFrame = window.requestAnimationFrame(() => {
        this.layoutFrame = null;

        const currentGrid = this.contentEl.querySelector<HTMLElement>(
          ".someday-maybe-grid",
        );
        if (currentGrid) {
          this.applyResponsiveColumns(currentGrid);
        }
      });
    });

    this.resizeObserver.observe(this.contentEl);
  }

  private teardownResizeObserver(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.layoutFrame != null) {
      window.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
  }

  private applyResponsiveColumns(grid: HTMLElement): void {
    const gridWidth = Math.round(grid.clientWidth || this.contentEl.clientWidth);
    if (!gridWidth) {
      return;
    }

    this.lastGridWidth = gridWidth;

    const colsByWidth = Math.max(
      1,
      Math.min(MAX_CARD_COLUMNS, Math.floor(gridWidth / TARGET_COLUMN_WIDTH)),
    );

    for (const card of grid.querySelectorAll<HTMLElement>(
      ".someday-maybe-card",
    )) {
      const itemCount = Number(card.dataset.itemCount ?? "0");
      const colsByContent = Math.max(
        1,
        Math.ceil(itemCount / MIN_ITEMS_PER_COLUMN),
      );
      const cols = Math.min(MAX_CARD_COLUMNS, colsByWidth, colsByContent);

      card.style.setProperty("--card-cols", String(cols));

      const list = card.querySelector<HTMLElement>(".emoji-bullet-list");
      if (!list) continue;

      if (cols > 1) {
        list.style.columnCount = String(cols);
      } else {
        list.style.removeProperty("column-count");
      }
    }
  }
}

function collectAreaPaths(node: AreaNode): Set<string> {
  const paths = new Set<string>();
  const walk = (n: AreaNode) => {
    paths.add(n.file.path);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return paths;
}
