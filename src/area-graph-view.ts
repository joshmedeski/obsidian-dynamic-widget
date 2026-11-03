import { ItemView, type TFile } from "obsidian";
import { buildAreaGraph, layoutAreaGraph } from "./area-graph";
import { getAllAreaFiles } from "./areas-hierarchy";
import {
  isFilePrivate,
  isValidHex,
  normalizeAreasFrontmatter,
  onMiddleClick,
  openInTab,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_AREA_GRAPH = "area-graph-view";

const SVG_MARGIN = 20;

export class AreaGraphView extends ItemView {
  getViewType(): string {
    return VIEW_TYPE_AREA_GRAPH;
  }

  getDisplayText(): string {
    return "Area Graph";
  }

  getIcon(): string {
    return "network";
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    this.contentEl.addClass("area-graph-view");
    this.app.workspace.onLayoutReady(() => this.render());
  }

  private areasOf(file: TFile): string[] {
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.areas;
    if (!raw) return [];
    return normalizeAreasFrontmatter(raw).map(simplifyWikiLink);
  }

  private visibleAreaFiles(): TFile[] {
    const all = getAllAreaFiles(this.app);
    const fileByName = new Map(all.map((f) => [f.basename, f]));
    const hidden = (file: TFile): boolean => {
      const seen = new Set<string>();
      for (let f: TFile | undefined = file; f && !seen.has(f.basename); f = fileByName.get(this.areasOf(f)[0])) {
        seen.add(f.basename);
        if (isFilePrivate(this.app, f)) return true;
      }
      return false;
    };
    return all.filter((f) => !hidden(f));
  }

  private render(): void {
    this.contentEl.empty();

    const areaFiles = this.visibleAreaFiles();
    const fileByName = new Map(areaFiles.map((f) => [f.basename, f]));

    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !f.path.startsWith("Areas/") && !isFilePrivate(this.app, f))
      .map((f) => this.areasOf(f));

    const graph = buildAreaGraph(
      areaFiles.map((f) => ({ name: f.basename, parent: this.areasOf(f)[0] ?? null })),
      notes,
    );
    const parentOf = new Map(graph.areas.map((a) => [a.name, a.parent]));
    const countOf = new Map(graph.areas.map((a) => [a.name, a.count]));
    const circles = layoutAreaGraph(graph);

    const colorOf = (name: string): string | null => {
      const seen = new Set<string>();
      for (let n: string | null = name; n !== null && !seen.has(n); n = parentOf.get(n) ?? null) {
        seen.add(n);
        const file = fileByName.get(n);
        const color = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.color;
        if (isValidHex(color)) return color.trim();
      }
      return null;
    };

    const minX = Math.min(...circles.map((c) => c.x - c.radius)) - SVG_MARGIN;
    const minY = Math.min(...circles.map((c) => c.y - c.radius)) - SVG_MARGIN;
    const maxX = Math.max(...circles.map((c) => c.x + c.radius)) + SVG_MARGIN;
    const maxY = Math.max(...circles.map((c) => c.y + c.radius)) + SVG_MARGIN;

    const svg = this.contentEl.createSvg("svg", {
      cls: "area-graph",
      attr: { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` },
    });

    const groupsByName = new Map<string, SVGGElement[]>();
    const highlight = (name: string | null) => {
      svg.toggleClass("is-focused", name !== null);
      for (const el of svg.querySelectorAll(".is-related")) el.removeClass("is-related");
      if (name === null) return;
      for (const n of [name, ...(graph.shared.get(name)?.keys() ?? [])]) {
        for (const g of groupsByName.get(n) ?? []) g.addClass("is-related");
      }
    };

    for (const c of circles) {
      const g = svg.createSvg("g", {
        cls: c.container ? "area-graph-container" : "area-graph-area",
      });
      groupsByName.set(c.name, [...(groupsByName.get(c.name) ?? []), g]);
      const color = colorOf(c.name);
      if (color) g.style.setProperty("--area-color", color);

      const shared = graph.shared.get(c.name)?.size ?? 0;
      g.createSvg("title").textContent = c.container
        ? c.name
        : `${c.name} · ${countOf.get(c.name) ?? 0} notes · shares notes with ${shared} areas`;
      g.createSvg("circle", { attr: { cx: c.x, cy: c.y, r: c.radius } });

      const label = c.container
        ? g.createSvg("text", { attr: { x: c.x, y: c.y - c.radius + 9 } })
        : g.createSvg("text", {
            attr: { x: c.x, y: c.y, "font-size": Math.min(16, Math.max(6, c.radius * 0.3)) },
          });
      label.textContent = c.name;

      if (!c.container) {
        g.addEventListener("mouseenter", () => highlight(c.name));
        g.addEventListener("mouseleave", () => highlight(null));
      }

      const file = fileByName.get(c.name);
      if (!file) continue;
      g.addEventListener("click", () => openInTab(this.app, file));
      onMiddleClick(g, () => openInTab(this.app, file, true));
    }
  }
}
