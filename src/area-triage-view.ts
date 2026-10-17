import {
  type App,
  FuzzySuggestModal,
  type FuzzyMatch,
  ItemView,
  Notice,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { getAllAreaFiles, getAreaAncestors } from "./areas-hierarchy";
import {
  type AreaSuggestion,
  confidenceOf,
  hasAreas,
  suggestAreas,
} from "./area-suggestion";
import type DynamicWidgetPlugin from "./main";
import {
  areaIcon,
  DEFAULT_BULLET,
  isFilePrivate,
  noteBullet,
  normalizeAreasFrontmatter,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_AREA_TRIAGE = "area-triage-view";

const DAY_FILE_NAME = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED_PREFIXES = ["Areas/", "Days/"];
const ALL_FOLDERS = "__all__";

type Status = "pending" | "applied" | "skipped";

export class AreaTriageView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;
  private queue: TFile[] = [];
  private index = 0;
  private scope_ = ALL_FOLDERS;
  private status = new Map<string, Status>();
  private results = new Map<string, AreaSuggestion>();
  private errors = new Map<string, string>();
  private inFlight = new Map<string, Promise<void>>();
  private checked = new Set<string>();
  private picked = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AREA_TRIAGE;
  }

  getDisplayText(): string {
    return "Area Triage";
  }

  getIcon(): string {
    return "compass";
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
      cls: "area-triage-content",
      attr: { tabindex: "0" },
    });

    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      this.onKeydown(event);
    });

    this.rebuildQueue();
    this.render();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {
    this.contentEl = document.createElement("div");
  }

  private candidates(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (EXCLUDED_PREFIXES.some((p) => file.path.startsWith(p))) {
          return false;
        }
        if (DAY_FILE_NAME.test(file.basename)) return false;
        if (this.plugin.privateMode && isFilePrivate(this.app, file)) {
          return false;
        }
        return !hasAreas(this.app, file);
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  private rebuildQueue(): void {
    const all = this.candidates();
    this.queue =
      this.scope_ === ALL_FOLDERS
        ? all
        : all.filter((f) => topFolder(f) === this.scope_);
    this.index = Math.min(this.index, Math.max(0, this.queue.length - 1));
  }

  private folderCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of this.candidates()) {
      const folder = topFolder(file);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return counts;
  }

  private current(): TFile | null {
    return this.queue[this.index] ?? null;
  }

  private render(): void {
    this.contentEl.empty();
    this.renderHeader();

    const file = this.current();
    if (!file) {
      this.contentEl.createEl("p", {
        text:
          this.queue.length === 0
            ? "Every note in this scope has an area. Nothing to triage."
            : "End of the queue.",
        cls: "areas-view-empty",
      });
      if (this.index > 0) {
        const back = this.contentEl
          .createEl("div", { cls: "area-triage-actions" })
          .createEl("button", { text: "\u2190 Back" });
        back.addEventListener("click", () => {
          this.move(-1);
        });
      }
      return;
    }

    this.renderNote(file);
    this.renderSuggestions(file);
    this.renderActions(file);
    this.focusSelf();

    void this.classify(file).then(() => {
      void this.prefetchNext();
    });
  }

  private renderHeader(): void {
    const header = this.contentEl.createEl("div", {
      cls: "area-triage-header",
    });

    const topRow = header.createEl("div", { cls: "area-triage-top" });
    topRow.createEl("div", {
      text: "\u{1F9ED} Area Triage",
      cls: "area-triage-title",
    });

    const counts = this.folderCounts();
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    const select = topRow.createEl("select", {
      cls: "dropdown area-triage-scope",
    });
    select.createEl("option", {
      text: `All folders (${total})`,
      value: ALL_FOLDERS,
    });
    for (const folder of [...counts.keys()].sort()) {
      select.createEl("option", {
        text: `${folder} (${counts.get(folder)})`,
        value: folder,
      });
    }
    select.value = this.scope_;
    select.addEventListener("change", () => {
      this.scope_ = select.value;
      this.index = 0;
      this.rebuildQueue();
      this.render();
    });

    const rescan = topRow.createEl("button", {
      text: "Rescan",
      cls: "area-triage-rescan",
    });
    rescan.addEventListener("click", () => {
      this.refreshContent();
    });

    const done = this.queue.filter(
      (f) => this.status.get(f.path) != null,
    ).length;
    header.createEl("div", {
      text:
        this.queue.length === 0
          ? "0 notes"
          : `Note ${Math.min(this.index + 1, this.queue.length)} of ${this.queue.length} · ${done} triaged`,
      cls: "area-triage-progress",
    });

    const bar = header.createEl("div", { cls: "area-triage-bar" });
    const pct =
      this.queue.length === 0 ? 0 : (done / this.queue.length) * 100;
    bar.createEl("div", { cls: "area-triage-bar-fill" }).style.width =
      `${pct}%`;
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

    main.createEl("div", {
      text: file.parent?.path ?? "/",
      cls: "area-triage-note-path",
    });

    const description = meta?.frontmatter?.description;
    if (description) {
      main.createEl("div", {
        text: String(description),
        cls: "area-triage-note-description",
      });
    }

    const status = this.status.get(file.path);
    if (status) {
      section.createEl("span", {
        text: status === "applied" ? "\u2713 filed" : "skipped",
        cls: `area-triage-status is-${status}`,
      });
    }
  }

  private renderSuggestions(file: TFile): void {
    const body = this.contentEl.createEl("div", { cls: "area-triage-body" });

    const error = this.errors.get(file.path);
    const result = this.results.get(file.path);

    if (error) {
      body.createEl("div", { text: error, cls: "dw-area-suggestion-error" });
    } else if (!result) {
      body.createEl("div", {
        text: "Classifying\u2026",
        cls: "area-triage-loading",
      });
    } else if (result.abstained || result.choices.length === 0) {
      body.createEl("div", {
        text: `No confident match \u2014 falls back to ${result.areas.join(" ")}`,
        cls: "dw-area-suggestion-abstained",
      });
    }

    // Hand-picked areas render alongside the suggestions and outlive a
    // reclassify, so a pick made while the classifier was still running is
    // never dropped from under the user.
    const suggested = result?.abstained ? [] : (result?.choices ?? []);
    const suggestedNames = new Set(suggested.map((c) => c.area));

    if (suggested.length > 0 || this.picked.size > 0) {
      const ulEl = body.createEl("ul", { cls: "area-triage-choices" });

      suggested.forEach((choice, position) => {
        this.renderChoiceRow(ulEl, {
          area: choice.area,
          lineage: choice.lineage.filter((name) => name !== choice.area),
          score: choice.score,
          key: position < 9 ? String(position + 1) : "",
        });
      });

      for (const area of this.picked) {
        if (suggestedNames.has(area)) continue;
        this.renderChoiceRow(ulEl, {
          area,
          lineage: getAreaAncestors(this.app, area),
          picked: true,
        });
      }
    }

    if (result) {
      const details = body.createEl("details", {
        cls: "dw-area-suggestion-json",
      });
      details.createEl("summary", { text: `JSON (${result.strategy})` });
      details.createEl("pre").createEl("code", {
        text: JSON.stringify(result, null, 2),
      });
    }
  }

  /**
   * A label makes the whole row the checkbox's hit target natively -- no click
   * handler, so no chance of the row and the box disagreeing.
   */
  private renderChoiceRow(
    ulEl: HTMLElement,
    options: {
      area: string;
      lineage: string[];
      score?: number;
      key?: string;
      picked?: boolean;
    },
  ): void {
    const rowEl = ulEl
      .createEl("li")
      .createEl("label", { cls: "area-triage-choice" });
    if (options.picked) rowEl.classList.add("is-picked");

    const checkbox = rowEl.createEl("input", {
      type: "checkbox",
      cls: "area-triage-checkbox",
    });
    checkbox.checked = this.checked.has(options.area);
    checkbox.addEventListener("change", () => {
      this.toggle(options.area, checkbox.checked);
    });

    rowEl.createEl("span", {
      text: areaIcon(this.app, options.area) ?? DEFAULT_BULLET,
      cls: "area-triage-choice-icon",
    });
    rowEl.createEl("span", {
      text: options.area,
      cls: "area-triage-choice-name",
    });

    // The area names its own lineage tail; showing it again says nothing.
    rowEl.createEl("span", {
      text: options.lineage.join(" \u2039 "),
      cls: "area-triage-choice-lineage",
    });

    if (options.score != null) {
      rowEl.createEl("span", {
        text: options.score.toFixed(2),
        cls: `area-triage-choice-score dw-area-suggestion-score is-${confidenceOf(options.score)}`,
      });
    } else {
      rowEl.createEl("span", {
        text: "picked",
        cls: "area-triage-choice-score area-triage-choice-picked",
      });
    }

    rowEl.createEl("kbd", {
      text: options.key ?? "",
      cls: "area-triage-key",
    });
  }

  private openAreaPicker(): void {
    new AreaPickerModal(this.app, this.plugin, (area) => {
      this.picked.add(area);
      this.checked.add(area);
      const file = this.current();
      if (file) this.refreshBody(file);
    }).open();
  }

  private renderActions(file: TFile): void {
    const actions = this.contentEl.createEl("div", {
      cls: "area-triage-actions",
    });

    const back = actions.createEl("button", { text: "← Back" });
    back.disabled = this.index === 0;
    back.addEventListener("click", () => {
      this.move(-1);
    });

    const apply = actions.createEl("button", {
      text:
        this.checked.size > 0
          ? `Apply ${this.checked.size} →`
          : "Apply →",
      cls: "mod-cta",
    });
    apply.disabled = this.checked.size === 0;
    apply.addEventListener("click", () => {
      void this.applyChecked(file);
    });

    const skip = actions.createEl("button", { text: "Skip →" });
    skip.addEventListener("click", () => {
      this.status.set(file.path, "skipped");
      this.move(1);
    });

    const choose = actions.createEl("button", { text: "Choose area\u2026" });
    choose.addEventListener("click", () => {
      this.openAreaPicker();
    });

    const open = actions.createEl("button", { text: "Open note" });
    open.addEventListener("click", () => {
      this.openCurrent();
    });

    actions.createEl("div", {
      text: "1-9 toggle · C choose · A apply · S skip · J/K move · O open",
      cls: "area-triage-hint",
    });
  }

  private toggle(area: string, on: boolean): void {
    if (on) {
      this.checked.add(area);
    } else {
      this.checked.delete(area);
    }
    const file = this.current();
    if (!file) return;
    this.contentEl.querySelector(".area-triage-actions")?.remove();
    this.renderActions(file);
  }

  private move(delta: number): void {
    const next = this.index + delta;
    if (next < 0 || next > this.queue.length) return;
    this.index = next;
    this.checked.clear();
    this.picked.clear();
    this.render();
  }

  // Keyboard shortcuts need focus in the view, but a background refresh must
  // not yank the caret out of whatever the user is actually typing in.
  private focusSelf(): void {
    const active = document.activeElement;
    if (active && active !== document.body && !this.containerEl.contains(active)) {
      return;
    }
    this.contentEl.focus();
  }

  /** Redraw the suggestion list and the action bar, leaving the header and
   * note card alone so the page does not flicker. */
  private refreshBody(file: TFile): void {
    this.contentEl.querySelector(".area-triage-body")?.remove();
    this.contentEl.querySelector(".area-triage-actions")?.remove();
    this.renderSuggestions(file);
    this.renderActions(file);
  }

  private openCurrent(): void {
    const file = this.current();
    if (!file) return;
    void this.app.workspace.getLeaf("tab").openFile(file);
  }

  private async applyChecked(file: TFile): Promise<void> {
    const areas = [...this.checked];
    if (areas.length === 0) return;

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existing = frontmatter.areas
          ? normalizeAreasFrontmatter(frontmatter.areas)
          : [];
        const names = new Set(existing.map(simplifyWikiLink));
        for (const area of areas) {
          if (!names.has(area)) existing.push(`[[${area}]]`);
        }
        frontmatter.areas = existing;
      });
      this.status.set(file.path, "applied");
      new Notice(`${file.basename}: ${areas.map((a) => `[[${a}]]`).join(" ")}`);
      this.move(1);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    const file = this.current();
    if (!file) return;

    if (event.key >= "1" && event.key <= "9") {
      const choice = this.results.get(file.path)?.choices[
        Number(event.key) - 1
      ];
      if (!choice) return;
      event.preventDefault();
      const on = !this.checked.has(choice.area);
      this.toggle(choice.area, on);
      const box = this.contentEl.querySelectorAll<HTMLInputElement>(
        ".area-triage-checkbox",
      )[Number(event.key) - 1];
      if (box) box.checked = on;
      return;
    }

    switch (event.key) {
      case "Enter":
      case "a":
      case "A":
        event.preventDefault();
        void this.applyChecked(file);
        break;
      case "c":
      case "C":
        event.preventDefault();
        this.openAreaPicker();
        break;
      case "s":
      case "S":
        event.preventDefault();
        this.status.set(file.path, "skipped");
        this.move(1);
        break;
      case "j":
      case "J":
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        this.move(1);
        break;
      case "k":
      case "K":
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        this.move(-1);
        break;
      case "o":
      case "O":
        event.preventDefault();
        this.openCurrent();
        break;
      default:
        break;
    }
  }

  /**
   * One classify per note, memoised by path and de-duplicated while in
   * flight. The classifier is a `uv` subprocess that takes seconds, so the
   * queue only ever has the current note and the next one running.
   */
  private classify(file: TFile): Promise<void> {
    if (this.results.has(file.path) || this.errors.has(file.path)) {
      return Promise.resolve();
    }
    const running = this.inFlight.get(file.path);
    if (running) return running;

    const promise = suggestAreas(this.app, file)
      .then((result) => {
        this.results.set(file.path, result);
      })
      .catch((error: unknown) => {
        this.errors.set(
          file.path,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.inFlight.delete(file.path);
        if (this.current()?.path === file.path) {
          this.refreshBody(file);
        }
      });

    this.inFlight.set(file.path, promise);
    return promise;
  }

  private async prefetchNext(): Promise<void> {
    const next = this.queue[this.index + 1];
    if (next) await this.classify(next);
  }
}

function topFolder(file: TFile): string {
  const [first] = file.path.split("/");
  return file.path.includes("/") ? first : "/";
}

/**
 * Every area in the vault, for the times none of the classifier's guesses fit.
 * Matching runs over the area name plus its parent chain, so typing a parent
 * narrows to its children.
 */
export class AreaPickerModal extends FuzzySuggestModal<TFile> {
  private plugin: DynamicWidgetPlugin;
  private onPick: (area: string) => void;
  // Resolved once: the modal asks for a lineage on every keystroke, for every
  // area, and walking the frontmatter chain each time is not free.
  private lineages = new Map<string, string[]>();

  constructor(
    app: App,
    plugin: DynamicWidgetPlugin,
    onPick: (area: string) => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.onPick = onPick;
    this.setPlaceholder("Choose an area\u2026");
    for (const file of getAllAreaFiles(app)) {
      this.lineages.set(file.basename, getAreaAncestors(app, file.basename));
    }
  }

  private lineage(area: string): string[] {
    return this.lineages.get(area) ?? [];
  }

  getItems(): TFile[] {
    return getAllAreaFiles(this.app).filter(
      (file) => !(this.plugin.privateMode && isFilePrivate(this.app, file)),
    );
  }

  getItemText(file: TFile): string {
    return [file.basename, ...this.lineage(file.basename)].join(" ");
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    const area = match.item.basename;
    el.addClass("area-triage-pick");
    el.createEl("span", {
      text: areaIcon(this.app, area) ?? DEFAULT_BULLET,
      cls: "area-triage-choice-icon",
    });
    el.createEl("span", { text: area, cls: "area-triage-choice-name" });
    el.createEl("span", {
      text: this.lineage(area).join(" \u2039 "),
      cls: "area-triage-choice-lineage",
    });
  }

  onChooseItem(file: TFile): void {
    this.onPick(file.basename);
  }
}
