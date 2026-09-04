import {
  type CachedMetadata,
  type FrontmatterLinkCache,
  type LinkCache,
  MarkdownView,
  type TFile,
} from "obsidian";
import type DynamicWidgetPlugin from "./main";
import { formatDate, isFilePrivate, normalizeAreasFrontmatter, redactText, simplifyWikiLink } from "./utils";

export class EditorFooter {
  private footerEl: HTMLElement | null = null;
  private plugin: DynamicWidgetPlugin | null = null;

  attach(plugin: DynamicWidgetPlugin): void {
    this.plugin = plugin;

    this.footerEl = document.createElement("div");
    this.footerEl.className = "editor-footer";

    plugin.registerEvent(
      plugin.app.workspace.on("active-leaf-change", () => {
        this.update();
      }),
    );

    plugin.registerEvent(
      plugin.app.metadataCache.on("changed", (file: TFile) => {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === file.path) {
          this.update();
        }
      }),
    );

    plugin.registerEvent(
      plugin.app.vault.on("rename", (file) => {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === file.path) {
          this.update();
        }
      }),
    );

    // Initial render
    plugin.app.workspace.onLayoutReady(() => {
      this.update();
    });
  }

  refresh(): void {
    this.update();
  }

  detach(): void {
    this.footerEl?.remove();
    this.footerEl = null;
    this.plugin = null;
  }

  private update(): void {
    if (!this.footerEl || !this.plugin) return;

    const activeView =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (!activeView) {
      this.footerEl.remove();
      return;
    }

    const file = activeView.file;
    if (!file) {
      this.footerEl.remove();
      return;
    }

    this.buildFooterContent(file, activeView);

    const viewContent = activeView.contentEl;
    if (viewContent && this.footerEl.parentElement !== viewContent) {
      viewContent.appendChild(this.footerEl);
    }
  }

  private addSeparator(container: HTMLElement): void {
    const sep = container.createEl("span", {
      text: "|",
      cls: "editor-footer-separator",
    });
    sep.style.opacity = "0.4";
  }

  private buildCoverRow(
    file: TFile,
    metadata: CachedMetadata | null,
  ): void {
    if (!this.footerEl || !this.plugin) return;

    const app = this.plugin.app;
    const seen = new Set<string>();
    const covers: { name: string; resourceUrl: string; path: string }[] = [];

    const resolveCover = (linkPath: string) => {
      if (seen.has(linkPath)) return;
      seen.add(linkPath);

      const targetFile = app.metadataCache.getFirstLinkpathDest(
        linkPath,
        file.path,
      );
      if (!targetFile) return;

      const targetMeta = app.metadataCache.getFileCache(targetFile);

      // Add this outlink's own cover, if it has one
      const cover = targetMeta?.frontmatter?.cover;
      if (cover) {
        const coverFile = app.metadataCache.getFirstLinkpathDest(
          simplifyWikiLink(String(cover)),
          targetFile.path,
        );
        if (coverFile) {
          covers.push({
            name: targetFile.basename,
            resourceUrl: app.vault.getResourcePath(coverFile),
            path: targetFile.path,
          });
        }
      }

      // Also surface covers for notes listed in this outlink's "with" frontmatter
      const withRaw = targetMeta?.frontmatter?.with;
      if (withRaw) {
        const withLinks = normalizeAreasFrontmatter(withRaw);
        for (const w of withLinks) {
          resolveCover(simplifyWikiLink(String(w)));
        }
      }
    };

    // Frontmatter property links first
    const fmLinks = metadata?.frontmatterLinks ?? [];
    for (const link of fmLinks) {
      resolveCover(link.link);
    }

    // Then body outgoing links
    const bodyLinks = metadata?.links ?? [];
    for (const link of bodyLinks) {
      resolveCover(link.link);
    }

    if (covers.length === 0) return;

    const wrapper = this.footerEl.createEl("div", {
      cls: "editor-footer-covers-wrapper",
    });

    const handle = wrapper.createEl("div", {
      cls: "editor-footer-resize-handle",
    });

    const row = wrapper.createEl("div", {
      cls: "editor-footer-covers",
    });

    this.attachResizeHandle(handle, row);

    for (const { name, resourceUrl, path } of covers) {
      const targetFile = app.vault.getAbstractFileByPath(path);
      const isPrivate =
        this.plugin?.privateMode &&
        targetFile &&
        "stat" in targetFile &&
        (targetFile.path.startsWith("Relationships/") || isFilePrivate(app, targetFile as TFile));

      if (isPrivate) continue; // Don't render private cover cards at all

      const card = row.createEl("div", { cls: "editor-footer-cover-card" });

      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        if (targetFile) {
          app.workspace.openLinkText(path, "", "tab");
        }
      });

      card.createEl("img", { attr: { src: resourceUrl, alt: name } });
      card.createEl("span", {
        text: name,
        cls: "editor-footer-cover-name",
      });
    }
  }

  private attachResizeHandle(handle: HTMLElement, covers: HTMLElement): void {
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = Math.min(500, Math.max(80, startHeight + delta));
      covers.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      handle.classList.remove("is-dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = covers.offsetHeight;
      handle.classList.add("is-dragging");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private buildFooterContent(file: TFile, activeView: MarkdownView): void {
    if (!this.footerEl || !this.plugin) return;

    this.footerEl.empty();

    const metadata = this.plugin.app.metadataCache.getFileCache(file);
    const fm = metadata?.frontmatter;

    // Metadata row
    const metaRow = this.footerEl.createEl("div", {
      cls: "editor-footer-meta",
    });

    if (this.plugin?.privateMode && (file.path.startsWith("Relationships/") || isFilePrivate(this.plugin.app, file))) {
      metaRow.createEl("span", { text: redactText("Created: Wed, Jan 1, 2025, 12:00am") });
      metaRow.classList.add("dynamic-widget-private");
      this.footerEl.appendChild(metaRow);
      return; // Skip cover row and real dates
    }

    // Created
    metaRow.createEl("span", {
      text: `Created: ${formatDate(file.stat.ctime)}`,
    });

    // Modified
    this.addSeparator(metaRow);
    metaRow.createEl("span", {
      text: `Modified: ${formatDate(file.stat.mtime)}`,
    });

    // Outgoing link covers (before metadata row)
    this.buildCoverRow(file, metadata);
    // Move metadata row after covers
    this.footerEl.appendChild(metaRow);
  }
}
