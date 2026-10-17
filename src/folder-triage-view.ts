import {
  type App,
  Component,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  type TFile,
  type TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { AreaPickerModal } from "./area-triage-view";
import {
  type AreaNode,
  getAreaAncestors,
  getAreaHierarchy,
} from "./areas-hierarchy";
import {
  type DynamicWidgetView,
  VIEW_TYPE_DYNAMIC_WIDGET,
} from "./dynamic-widget-view";
import type DynamicWidgetPlugin from "./main";
import {
  isFilePrivate,
  isValidHex,
  noteBullet,
  normalizeAreasFrontmatter,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_FOLDER_TRIAGE = "inbox-triage-view";

const INBOX = "Inbox";
const WIKILINK = /^\[\[[^\]]+\]\]$/;
const HIDDEN_PROPS = new Set(["position", "icon"]);

interface Route {
  key: string;
  label: string;
  folder: string;
  type?: string;
}

const ROUTES: Route[] = [
  { key: "a", label: "Active", folder: "Projects/Active", type: "project" },
  { key: "w", label: "Waiting For", folder: "Projects/Waiting For", type: "project" },
  { key: "s", label: "Someday Maybe", folder: "Projects/Someday Maybe", type: "project" },
  { key: "r", label: "Resource", folder: "Resources", type: "resource" },
  { key: "p", label: "Person", folder: "Relationships", type: "relationship" },
  { key: "g", label: "Goal", folder: "Goals", type: "goal" },
  { key: "m", label: "Event", folder: "Events" },
  { key: "e", label: "Archive", folder: "Archives" },
  { key: "i", label: "Inbox", folder: INBOX },
];

interface Ranked {
  rank: number;
  root: string | null;
}

export class FolderTriageView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;
  private queue: TFile[] = [];
  private index = 0;
  private folder = INBOX;
  private filed = new Map<TFile, string>();
  private ranks = new Map<TFile, Ranked>();
  private crossed = new Set<TFile>();
  private preview: Component | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_FOLDER_TRIAGE;
  }

  getDisplayText(): string {
    return `${this.folder} Triage`;
  }

  getState(): Record<string, unknown> {
    return { folder: this.folder };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const folder = (state as { folder?: unknown } | null)?.folder;
    if (typeof folder === "string" && folder !== this.folder) {
      this.folder = folder;
      this.index = 0;
      this.refreshContent();
    }
    await super.setState(state, result);
  }

  private inFolder(file: TFile): boolean {
    return file.path.startsWith(`${this.folder}/`);
  }

  private isDone(file: TFile): boolean {
    return this.crossed.has(file) || !this.inFolder(file);
  }

  private chooseFolder(): void {
    new FolderPickerModal(this.app, (folder) => {
      void this.leaf.setViewState({
        type: VIEW_TYPE_FOLDER_TRIAGE,
        state: { folder },
        active: true,
      });
    }).open();
  }

  getIcon(): string {
    return "inbox";
  }

  refreshContent(): void {
    this.rebuildQueue();
    this.render();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("area-triage-container");

    this.contentEl = container.createEl("div", {
      cls: "area-triage-content inbox-triage-content",
      attr: { tabindex: "0" },
    });

    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      this.onKeydown(event);
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.contentEl.focus();
      }),
    );

    this.rebuildQueue();
    this.render();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {
    this.contentEl = document.createElement("div");
  }

  private rebuildQueue(): void {
    const order = areaOrder(this.app);
    this.ranks.clear();
    this.filed.clear();
    this.crossed.clear();
    this.queue = this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          this.inFolder(file) &&
          !(this.plugin.privateMode && isFilePrivate(this.app, file)),
      );
    for (const file of this.queue) {
      this.ranks.set(file, rankOf(this.app, file, order));
    }
    this.queue.sort(
      (a, b) =>
        (this.ranks.get(a)?.rank ?? Infinity) -
          (this.ranks.get(b)?.rank ?? Infinity) ||
        a.stat.ctime - b.stat.ctime,
    );
    this.index = Math.min(this.index, Math.max(0, this.queue.length - 1));
  }

  private current(): TFile | null {
    return this.queue[this.index] ?? null;
  }

  private render(): void {
    this.contentEl.empty();
    if (this.preview) this.removeChild(this.preview);
    this.preview = null;

    const file = this.current();
    if (!file) {
      this.contentEl.createEl("p", {
        text:
          this.queue.length === 0
            ? `${this.folder} is empty.`
            : "End of the queue.",
        cls: "areas-view-empty",
      });
    } else {
      this.renderNote(file);
      this.renderProps(file);
      void this.renderContent(file);
    }
    this.focusSelf();
    for (const leaf of this.app.workspace.getLeavesOfType(
      VIEW_TYPE_DYNAMIC_WIDGET,
    )) {
      (leaf.view as DynamicWidgetView).refreshContent();
    }
  }

  renderQueue(parent: HTMLElement): void {
    const wrapper = parent.createEl("div", { cls: "inbox-triage-queue" });
    const el = wrapper.createEl("section");
    const heading = el.createEl("h3", {
      text: `${this.folder === INBOX ? "\u{1F4E5}" : "\u{1F4C2}"} ${this.folder} Triage`,
      cls: "inbox-triage-heading",
      attr: { "aria-label": "Change folder (F)" },
    });
    heading.addEventListener("click", () => {
      this.chooseFolder();
    });

    const done = this.queue.filter((f) => this.isDone(f)).length;
    el.createEl("div", {
      text:
        this.queue.length === 0
          ? "0 notes"
          : `Note ${Math.min(this.index + 1, this.queue.length)} of ${this.queue.length} · ${done} filed`,
      cls: "area-triage-progress",
    });

    const bar = el.createEl("div", {
      cls: "area-triage-bar inbox-triage-bar",
    });
    const pct = this.queue.length === 0 ? 0 : (done / this.queue.length) * 100;
    bar.createEl("div", { cls: "area-triage-bar-fill" }).style.width =
      `${pct}%`;

    const current = this.current();
    let group: string | null | undefined;
    let listEl: HTMLElement = el;

    this.queue.forEach((file, position) => {
      const root = this.ranks.get(file)?.root ?? null;
      if (root !== group) {
        group = root;
        const groupEl = el.createEl("div", { cls: "dynamic-widget-area-group" });
        const color = root ? this.areaColor(root) : null;
        if (color) {
          groupEl.addClass("has-color");
          groupEl.style.setProperty("--area-color", color);
        }
        groupEl.createEl("h4", {
          text: root ? this.areaLabel(root) : "Uncategorized",
          cls: "dynamic-widget-time-group-label",
        });
        listEl = groupEl.createEl("ul", { cls: "dw-list" });
      }

      const itemEl = listEl.createEl("li");
      const title =
        this.app.metadataCache.getFileCache(file)?.frontmatter?.title ||
        file.basename;
      if (file === current) {
        itemEl
          .createEl("span", {
            text: `\u{1F449} ${title}`,
            cls: "dynamic-widget-active-file",
          })
          .scrollIntoView({ block: "nearest" });
        return;
      }

      itemEl.addClass("dw-list-item");
      itemEl.style.setProperty("--emoji-bullet", `"${noteBullet(this.app, file)}"`);
      const linkEl = itemEl.createEl("a", { text: title, cls: "dw-list-title" });
      if (this.isDone(file)) linkEl.addClass("is-filed");
      linkEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.index = position;
        this.render();
        this.focusView();
      });
    });

    this.renderKeys(wrapper);
  }

  private areaPriority(area: string): string | null {
    const file = this.app.vault.getFileByPath(`Areas/${area}.md`);
    const priority = file
      ? this.app.metadataCache.getFileCache(file)?.frontmatter?.priority
      : null;
    return priority != null ? String(priority) : null;
  }

  private areaLabel(area: string): string {
    const priority = this.areaPriority(area);
    return priority != null ? `${priority}. ${area}` : area;
  }

  private jumpToPriority(priority: string): void {
    const next = this.queue.findIndex((file) => {
      const root = this.ranks.get(file)?.root;
      return (
        !this.isDone(file) &&
        root != null &&
        this.areaPriority(root) === priority
      );
    });
    if (next === -1) return;
    this.index = next;
    this.render();
  }

  private areaColor(area: string): string | null {
    const file = this.app.vault.getFileByPath(`Areas/${area}.md`);
    if (!file) return null;
    if (this.plugin.privateMode && isFilePrivate(this.app, file)) return null;
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.color;
    return isValidHex(raw) ? raw.trim() : null;
  }

  private focusView(): void {
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.contentEl.focus();
  }

  private renderNote(file: TFile): void {
    const section = this.contentEl.createEl("section", {
      cls: "area-triage-note",
    });

    section.createEl("span", {
      text: noteBullet(this.app, file),
      cls: "area-triage-note-icon",
    });

    const meta = this.app.metadataCache.getFileCache(file);
    const main = section.createEl("div", { cls: "area-triage-note-main" });

    const link = main.createEl("a", {
      text: meta?.frontmatter?.title || file.basename,
      cls: "area-triage-note-title",
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      this.openCurrent();
    });

    const root = this.ranks.get(file)?.root;
    const filed = this.filed.get(file);
    section.createEl("span", {
      text: filed ? `→ ${filed}` : (root ?? "unsorted"),
      cls: `area-triage-status ${filed ? "is-applied" : "is-skipped"}`,
    });
  }

  private renderProps(file: TFile): void {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const entries = Object.entries(frontmatter ?? {}).filter(
      ([name]) => !HIDDEN_PROPS.has(name),
    );
    if (entries.length === 0) return;

    const list = this.contentEl.createEl("dl", { cls: "inbox-triage-props" });
    for (const [name, value] of entries) {
      list.createEl("dt", { text: name });
      const dd = list.createEl("dd");
      const values: unknown[] = Array.isArray(value) ? value : [value];
      values.forEach((item, i) => {
        if (i > 0) dd.appendText(", ");
        this.renderPropValue(dd, item, file);
      });
    }
  }

  private renderPropValue(el: HTMLElement, value: unknown, file: TFile): void {
    const text =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
    if (!WIKILINK.test(text)) {
      el.appendText(text);
      return;
    }
    const target = simplifyWikiLink(text);
    const alias = text.slice(2, -2).split("|")[1]?.trim();
    const link = el.createEl("a", {
      text: alias || target,
      cls: "internal-link",
      href: target,
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(target, file.path, "tab");
    });
  }

  private async renderContent(file: TFile): Promise<void> {
    const el = this.contentEl.createEl("div", {
      cls: "inbox-triage-preview markdown-rendered",
    });
    const preview = this.addChild(new Component());
    this.preview = preview;

    const text = await this.app.vault.cachedRead(file);
    if (this.preview !== preview) return;
    const end =
      this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end
        .offset ?? 0;
    await MarkdownRenderer.render(
      this.app,
      text.slice(end).trim(),
      el,
      file.path,
      preview,
    );
  }

  private renderKeys(parent: HTMLElement): void {
    const grid = parent.createEl("div", { cls: "inbox-triage-keys" });
    const file = this.current();

    for (const route of ROUTES) {
      const button = this.keyButton(grid, route.key, route.label);
      button.disabled = !file || file.parent?.path === route.folder;
      button.addEventListener("click", () => {
        this.focusView();
        if (file) void this.route(file, route);
      });
    }

    const commands: [string, string, (file: TFile | null) => void][] = [
      ["d", "Delete", (f) => f && this.confirmDelete(f)],
      ["c", "Area", (f) => f && this.chooseArea(f)],
      ["o", "Open", () => this.openCurrent()],
      ["R", "Rescan", () => this.refreshContent()],
      ["F", "Folder", () => this.chooseFolder()],
    ];
    for (const [key, label, run] of commands) {
      const button = this.keyButton(grid, key, label);
      button.disabled = !file && key !== "R" && key !== "F";
      button.addEventListener("click", () => {
        this.focusView();
        run(file);
      });
    }

    grid.createEl("div", {
      text: "Tab cross off · Shift+Tab undo · 1-9 jump to an area · j/k or arrows move · press a folder's key to move a filed note back",
      cls: "area-triage-hint",
    });
  }

  private keyButton(
    parent: HTMLElement,
    key: string,
    label: string,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "inbox-triage-key" });
    button.createEl("kbd", { text: key });
    button.createEl("span", { text: label });
    return button;
  }

  private move(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next > this.queue.length) return;
    this.index = next;
    this.render();
  }

  private focusSelf(): void {
    const active = document.activeElement;
    if (active && active !== document.body && !this.containerEl.contains(active)) {
      return;
    }
    this.contentEl.focus();
  }

  private openCurrent(): void {
    const file = this.current();
    if (!file) return;
    void this.app.workspace.getLeaf("tab").openFile(file);
  }

  private async route(file: TFile, route: Route): Promise<void> {
    if (file.parent?.path === route.folder) return;
    const destination = `${route.folder}/${file.name}`;
    if (this.app.vault.getAbstractFileByPath(destination)) {
      new Notice(`${destination} already exists`);
      return;
    }

    try {
      if (route.type) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.type = route.type;
        });
      }
      await this.app.fileManager.renameFile(file, destination);
      this.filed.set(file, route.folder);
      new Notice(`${file.basename} → ${route.folder}`);
      this.move(1);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private confirmDelete(file: TFile): void {
    new ConfirmDeleteModal(this.app, file, async () => {
      try {
        await this.app.fileManager.trashFile(file);
        this.queue.splice(this.queue.indexOf(file), 1);
        this.filed.delete(file);
        this.ranks.delete(file);
        new Notice(`Trashed ${file.basename}`);
        this.move(0);
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      }
    }).open();
  }

  private chooseArea(file: TFile): void {
    new AreaPickerModal(this.app, this.plugin, (area) => {
      void this.app.fileManager
        .processFrontMatter(file, (frontmatter) => {
          const existing = frontmatter.areas
            ? normalizeAreasFrontmatter(frontmatter.areas)
            : [];
          if (!existing.map(simplifyWikiLink).includes(area)) {
            existing.push(`[[${area}]]`);
          }
          frontmatter.areas = existing;
        })
        .then(() => {
          this.render();
        });
    }).open();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "R") {
      event.preventDefault();
      this.refreshContent();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        this.move(-1);
        const previous = this.current();
        if (previous) this.crossed.delete(previous);
        this.render();
      } else {
        const file = this.current();
        if (file) this.crossed.add(file);
        this.move(1);
      }
      return;
    }
    if (event.key === "F") {
      event.preventDefault();
      this.chooseFolder();
      return;
    }
    if (event.key >= "1" && event.key <= "9") {
      event.preventDefault();
      this.jumpToPriority(event.key);
      return;
    }
    const key = event.key.toLowerCase();

    switch (key) {
      case "j":
      case "arrowdown":
      case "arrowright":
        event.preventDefault();
        this.move(1);
        return;
      case "k":
      case "arrowup":
      case "arrowleft":
        event.preventDefault();
        this.move(-1);
        return;
    }

    const file = this.current();
    if (!file) return;

    const route = ROUTES.find((r) => r.key === key);
    if (route) {
      event.preventDefault();
      void this.route(file, route);
      return;
    }

    switch (key) {
      case "d":
        event.preventDefault();
        this.confirmDelete(file);
        break;
      case "c":
        event.preventDefault();
        this.chooseArea(file);
        break;
      case "o":
        event.preventDefault();
        this.openCurrent();
        break;
    }
  }
}

function noteAreas(app: App, file: TFile): string[] {
  const raw = app.metadataCache.getFileCache(file)?.frontmatter?.areas;
  return raw ? normalizeAreasFrontmatter(raw).map(simplifyWikiLink) : [];
}

function areaOrder(app: App): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (node: AreaNode) => {
    order.set(node.file.basename, order.size);
    node.children.forEach(walk);
  };
  getAreaHierarchy(app).forEach(walk);
  return order;
}

function rankOf(app: App, file: TFile, order: Map<string, number>): Ranked {
  let best: Ranked = { rank: Infinity, root: null };
  for (const area of noteAreas(app, file)) {
    const chain = [area, ...getAreaAncestors(app, area)];
    const known = chain.find((name) => order.has(name));
    const rank = known ? (order.get(known) as number) : Infinity;
    if (rank < best.rank) best = { rank, root: chain[chain.length - 1] };
  }
  return best;
}

class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Delete note?");
    this.contentEl.createEl("p", {
      text: `Move "${this.file.basename}" to the trash.`,
    });
    const actions = this.contentEl.createEl("div", {
      cls: "modal-button-container",
    });
    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => {
        this.close();
      });
    const confirm = actions.createEl("button", {
      text: "Delete",
      cls: "mod-warning",
    });
    confirm.addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
    confirm.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onPick: (folder: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Triage which folder\u2026");
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllFolders(false);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onPick(folder.path);
  }
}

export function openFolderPicker(
  app: App,
  onPick: (folder: string) => void,
): void {
  new FolderPickerModal(app, onPick).open();
}
