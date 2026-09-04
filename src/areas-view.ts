import { ItemView, type TFile, type WorkspaceLeaf } from "obsidian";
import { getChildAreas, getTopLevelAreas } from "./areas-hierarchy";
import type DynamicWidgetPlugin from "./main";
import { isFilePrivate, isValidHex, redactText } from "./utils";

export const VIEW_TYPE_AREAS = "areas-view";

export class AreasView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AREAS;
  }

  getDisplayText(): string {
    return "Areas";
  }

  getIcon(): string {
    return "layout-grid";
  }

  refreshContent(): void {
    this.renderContent();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("areas-view-container");

    this.contentEl = container.createEl("div", {
      cls: "areas-view-content",
    });

    this.renderContent();

    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        if (file.path.startsWith("Areas/")) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file.path.startsWith("Areas/")) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file.path.startsWith("Areas/") || oldPath.startsWith("Areas/")) {
          this.renderContent();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file.path.startsWith("Areas/")) {
          this.renderContent();
        }
      }),
    );
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {
    this.contentEl = document.createElement("div");
  }

  private renderContent(): void {
    this.contentEl.empty();

    this.contentEl.createEl("div", {
      text: "Areas",
      cls: "areas-view-title",
    });

    const areas = getTopLevelAreas(this.app);
    if (areas.length === 0) {
      this.contentEl.createEl("p", {
        text: "No top-level areas found.",
        cls: "areas-view-empty",
      });
      return;
    }

    for (const file of areas) {
      const metadata = this.app.metadataCache.getFileCache(file);
      const isPrivate =
        this.plugin.privateMode && isFilePrivate(this.app, file);

      const priority = metadata?.frontmatter?.priority;
      const name = isPrivate ? redactText(file.basename) : file.basename;
      const displayName =
        priority != null ? `${priority}. ${name}` : `${name} (No priority)`;

      const rawColor = metadata?.frontmatter?.color;
      const color =
        !isPrivate && isValidHex(rawColor) ? rawColor.trim() : null;

      const section = this.contentEl.createEl("section", {
        cls: "areas-view-section",
      });
      if (color) {
        section.classList.add("has-color");
        section.style.setProperty("--area-color", color);
      }

      // Top-level area as h1
      const h1 = section.createEl("h1", {
        text: displayName,
        cls: "areas-view-heading",
      });

      if (isPrivate) {
        h1.classList.add("dynamic-widget-private");
      } else {
        h1.style.cursor = "pointer";
        h1.addEventListener("click", () => {
          this.app.workspace.getLeaf("tab").openFile(file);
        });
      }

      // Description paragraph
      const description = metadata?.frontmatter?.description;
      if (description) {
        const descText = isPrivate
          ? redactText(String(description))
          : String(description);
        const p = section.createEl("p", {
          text: descText,
          cls: "areas-view-description",
        });
        if (isPrivate) {
          p.classList.add("dynamic-widget-private");
        }
      }

      // Child areas as bullet list
      const children = getChildAreas(this.app, file.basename);
      if (children.length > 0) {
        const ul = section.createEl("ul", {
          cls: "areas-view-children",
        });

        for (const child of children) {
          const childPrivate =
            this.plugin.privateMode && isFilePrivate(this.app, child);
          const childName = childPrivate
            ? redactText(child.basename)
            : child.basename;

          const li = ul.createEl("li");

          const childLink = li.createEl("a", {
            text: childName,
            cls: "areas-view-child-link",
          });
          if (childPrivate) {
            childLink.classList.add("dynamic-widget-private");
          } else {
            childLink.addEventListener("click", (e) => {
              e.preventDefault();
              this.app.workspace.getLeaf("tab").openFile(child);
            });
          }

          // Grandchildren inline with →
          const grandchildren = getChildAreas(this.app, child.basename);
          if (grandchildren.length > 0) {
            li.createEl("span", {
              text: " \u2192 ",
              cls: "areas-view-arrow",
            });
            for (let i = 0; i < grandchildren.length; i++) {
              const gc = grandchildren[i];
              const gcPrivate =
                this.plugin.privateMode && isFilePrivate(this.app, gc);
              const gcName = gcPrivate
                ? redactText(gc.basename)
                : gc.basename;

              const gcLink = li.createEl("a", {
                text: gcName,
                cls: "areas-view-grandchild",
              });
              if (gcPrivate) {
                gcLink.classList.add("dynamic-widget-private");
              } else {
                gcLink.addEventListener("click", (e) => {
                  e.preventDefault();
                  this.app.workspace.getLeaf("tab").openFile(gc);
                });
              }

              if (i < grandchildren.length - 1) {
                li.createEl("span", { text: ", " });
              }
            }
          }
        }
      }
    }
  }
}
