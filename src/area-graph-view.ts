import { ItemView, type TFile } from "obsidian";
import {
  type Circle,
  type Overlap,
  buildAreaGraph,
  labelFits,
  labelPx,
  layoutAreaGraph,
} from "./area-graph";
import { getAllAreaFiles } from "./areas-hierarchy";
import {
  isFilePrivate,
  resolveCoverFile,
  isValidHex,
  normalizeAreasFrontmatter,
  onMiddleClick,
  openInTab,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_AREA_GRAPH = "area-graph-view";

const SVG_MARGIN = 20;
const MIN_ZOOM = 1;
const MAX_ZOOM = 30;
const DRAG_THRESHOLD_PX = 4;

const CONTAINER_LABEL_SCALE = 0.4;
const CONTAINER_LABEL_INSET = 1.4;
const CONTAINER_LABEL_FILL = 1.2;

interface Label {
  el: SVGTextElement;
  circle: Circle;
  widthPerPx: number;
}

export class AreaGraphView extends ItemView {
  private updateViewport: () => void = () => {};

  onResize(): void {
    this.updateViewport();
  }

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
    const { circles, overlaps } = layoutAreaGraph(graph);

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
    const tint = (el: HTMLElement | SVGElement, name: string) => {
      const color = colorOf(name);
      if (color) el.style.setProperty("--area-color", color);
    };

    const legend = this.contentEl.createDiv({ cls: "area-graph-legend" });
    for (const root of new Set(circles.map((c) => c.root))) {
      const item = legend.createSpan({ cls: "area-graph-legend-item", text: root });
      tint(item, root);
      const file = fileByName.get(root);
      if (file) item.addEventListener("click", () => openInTab(this.app, file));
    }

    const minX = Math.min(...circles.map((c) => c.x - c.radius)) - SVG_MARGIN;
    const minY = Math.min(...circles.map((c) => c.y - c.radius)) - SVG_MARGIN;
    const maxX = Math.max(...circles.map((c) => c.x + c.radius)) + SVG_MARGIN;
    const maxY = Math.max(...circles.map((c) => c.y + c.radius)) + SVG_MARGIN;

    const svg = this.contentEl.createSvg("svg", {
      cls: "area-graph",
      attr: { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` },
    });
    const defs = svg.createSvg("defs");
    const clipPrefix = `area-graph-clip-${Math.random().toString(36).slice(2)}`;
    const containerNames = new Set(circles.filter((c) => c.container).map((c) => c.name));
    const wallpaperOf = (c: Circle) => {
      const file = fileByName.get(c.name);
      if (!file || (!c.container && containerNames.has(c.name))) return null;
      const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.wallpaper;
      const image = resolveCoverFile(this.app, raw, file.path);
      return image ? this.app.vault.getResourcePath(image) : null;
    };
    const viewport = svg.createSvg("g");
    const shapeLayer = viewport.createSvg("g");
    const labelLayer = viewport.createSvg("g", { cls: "area-graph-labels" });
    const labels: Label[] = [];

    const areaGroups = new Map<string, SVGGElement>();
    const highlight = (names: string[] | null) => {
      svg.toggleClass("is-focused", names !== null);
      for (const el of Array.from(svg.querySelectorAll(".is-related"))) el.removeClass("is-related");
      for (const n of names ?? []) areaGroups.get(n)?.addClass("is-related");
    };

    const drawCircle = (c: Circle) => {
      const g = shapeLayer.createSvg("g", {
        cls: c.container ? "area-graph-container" : "area-graph-area",
      });
      tint(g, c.name);
      const wallpaper = wallpaperOf(c);
      if (wallpaper) {
        const clipId = `${clipPrefix}-${defs.childElementCount}`;
        defs
          .createSvg("clipPath", { attr: { id: clipId } })
          .createSvg("circle", { attr: { cx: c.x, cy: c.y, r: c.radius } });
        g.createSvg("image", {
          attr: {
            href: wallpaper,
            x: c.x - c.radius,
            y: c.y - c.radius,
            width: 2 * c.radius,
            height: 2 * c.radius,
            preserveAspectRatio: "xMidYMid slice",
            "clip-path": `url(#${clipId})`,
          },
        });
        g.addClass("has-wallpaper");
      }
      g.createSvg("circle", { attr: { cx: c.x, cy: c.y, r: c.radius } });
      const label = labelLayer.createSvg("text", { attr: { x: c.x, y: c.y } });
      if (c.container) label.addClass("area-graph-container-label");
      label.textContent = c.name;
      tint(label, c.name);
      labels.push({ el: label, circle: c, widthPerPx: 0 });

      if (c.container) {
        g.createSvg("title").textContent = `${c.name} · ${c.count} notes across its areas`;
      } else {
        areaGroups.set(c.name, g);
        const partners = graph.shared.get(c.name)?.size ?? 0;
        g.createSvg("title").textContent = `${c.name} · ${c.count} notes · shares notes with ${partners} areas`;
        g.addEventListener("mouseenter", () =>
          highlight([c.name, ...(graph.shared.get(c.name)?.keys() ?? [])]),
        );
        g.addEventListener("mouseleave", () => highlight(null));
      }

      const file = fileByName.get(c.name);
      if (!file) return;
      g.addEventListener("click", () => openInTab(this.app, file));
      onMiddleClick(g, () => openInTab(this.app, file, true));
    };

    const drawOverlap = (o: Overlap) => {
      const lens = shapeLayer.createSvg("path", {
        cls: o.a.container || o.b.container ? ["area-graph-overlap", "is-container"] : "area-graph-overlap",
        attr: { d: o.path },
      });
      lens.createSvg("title").textContent =
        `${o.a.name} ∩ ${o.b.name} · ${o.shared} ${o.shared === 1 ? "note" : "notes"}`;
      lens.addEventListener("mouseenter", () => highlight([o.a.name, o.b.name]));
      lens.addEventListener("mouseleave", () => highlight(null));
    };

    const maxDepth = Math.max(...circles.map((c) => c.depth));
    for (let depth = 0; depth <= maxDepth; depth++) {
      for (const c of circles) if (c.depth === depth) drawCircle(c);
      for (const o of overlaps) if (o.depth === depth) drawOverlap(o);
    }

    let zoom = { k: 1, x: 0, y: 0 };
    const layoutToScreen = () => {
      const box = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      return Math.min(rect.width / box.width, rect.height / box.height);
    };
    const measure = (label: Label) => {
      label.el.setAttr("font-size", 100);
      label.widthPerPx = label.el.getComputedTextLength() / 100;
    };

    this.updateViewport = () => {
      viewport.setAttr("transform", `translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`);
      const scale = layoutToScreen() * zoom.k;
      if (!scale) return;
      for (const label of labels) {
        if (!label.widthPerPx) measure(label);
        const { container, y, radius } = label.circle;
        const radiusPx = radius * scale;
        const sizePx = container ? labelPx(radiusPx * CONTAINER_LABEL_SCALE) : labelPx(radiusPx);
        label.el.setAttr("font-size", sizePx / scale);
        if (container) label.el.setAttr("y", y - radius + (sizePx * CONTAINER_LABEL_INSET) / scale);
        const fits = container
          ? label.widthPerPx * sizePx <= CONTAINER_LABEL_FILL * radiusPx
          : labelFits(label.widthPerPx, radiusPx);
        label.el.toggleClass("is-hidden", !fits);
      }
    };

    const toLayout = (e: MouseEvent) =>
      new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()?.inverse());

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = toLayout(e);
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.k * Math.exp(-e.deltaY * 0.002)));
        zoom = { k, x: p.x - ((p.x - zoom.x) * k) / zoom.k, y: p.y - ((p.y - zoom.y) * k) / zoom.k };
        this.updateViewport();
      },
      { passive: false },
    );

    let drag: { x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      suppressClick = false;
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!drag.moved) svg.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: true };
      const toLayoutUnits = layoutToScreen();
      zoom = { ...zoom, x: zoom.x + dx / toLayoutUnits, y: zoom.y + dy / toLayoutUnits };
      svg.addClass("is-panning");
      this.updateViewport();
    });
    svg.addEventListener("pointerup", () => {
      suppressClick = drag?.moved ?? false;
      drag = null;
      svg.removeClass("is-panning");
    });
    svg.addEventListener(
      "click",
      (e) => {
        if (suppressClick) e.stopPropagation();
      },
      true,
    );
    svg.addEventListener("dblclick", () => {
      zoom = { k: 1, x: 0, y: 0 };
      this.updateViewport();
    });

    this.updateViewport();
  }
}
