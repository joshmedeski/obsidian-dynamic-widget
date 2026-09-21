import {
  type App,
  ItemView,
  Notice,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  type AreaSuggestion,
  basePath,
  classifyVault,
  confidenceOf,
} from "./area-suggestion";
import type DynamicWidgetPlugin from "./main";
import { areaIcon, DEFAULT_BULLET, isFilePrivate, noteBullet } from "./utils";

export const VIEW_TYPE_AREA_TABLE = "area-table-view";

const ALL_FOLDERS = "__all__";
const PAGE_SIZE = 200;

type SortKey = "note" | "folder" | "score" | "strategy" | "existing";

interface Row {
  suggestion: AreaSuggestion;
  path: string;
  folder: string;
  file: TFile | null;
  score: number;
}

const COLUMNS: { key: SortKey | null; label: string; cls: string }[] = [
  { key: "note", label: "Note", cls: "area-table-col-note" },
  { key: "folder", label: "Folder", cls: "area-table-col-folder" },
  { key: "score", label: "Score", cls: "area-table-col-score" },
  { key: "strategy", label: "Strategy", cls: "area-table-col-strategy" },
  { key: null, label: "Suggested areas", cls: "area-table-col-areas" },
  { key: "existing", label: "Current areas", cls: "area-table-col-existing" },
];

export class AreaTableView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;
  private rows: Row[] = [];
  private loading = false;
  private error: string | null = null;
  private scope_ = ALL_FOLDERS;
  private sortKey: SortKey = "score";
  private sortAsc = false;
  private limit = PAGE_SIZE;

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AREA_TABLE;
  }

  getDisplayText(): string {
    return "Area Table";
  }

  getIcon(): string {
    return "table";
  }

  refreshContent(): void {
    this.render();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("area-table-container");

    this.contentEl = container.createEl("div", { cls: "area-table-content" });

    this.render();
    if (this.rows.length === 0) void this.scan();
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose(): Promise<void> {
    this.contentEl = document.createElement("div");
  }

  private async scan(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    this.render();

    try {
      const vaultPath = basePath(this.app);
      const suggestions = await classifyVault(this.app);
      this.rows = suggestions.map((suggestion) =>
        toRow(this.app, suggestion, vaultPath),
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.rows = [];
    } finally {
      this.loading = false;
      this.limit = PAGE_SIZE;
      this.render();
    }
  }

  /** Private notes are dropped outright rather than redacted: the table is a
   * bulk overview, and a page of hidden titles says nothing useful. A row whose
   * file would not resolve is dropped too -- privacy lives in the frontmatter,
   * so a note we cannot look up is a note we cannot clear. */
  private visible(): Row[] {
    if (!this.plugin.privateMode) return this.rows;
    return this.rows.filter(
      (row) => row.file != null && !isFilePrivate(this.app, row.file),
    );
  }

  private folderCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of this.visible()) {
      counts.set(row.folder, (counts.get(row.folder) ?? 0) + 1);
    }
    return counts;
  }

  private filtered(): Row[] {
    const rows = this.visible().filter(
      (row) => this.scope_ === ALL_FOLDERS || row.folder === this.scope_,
    );
    const direction = this.sortAsc ? 1 : -1;
    return rows.sort((a, b) => compare(a, b, this.sortKey) * direction);
  }

  private render(): void {
    this.contentEl.empty();
    this.renderHeader();

    if (this.error) {
      this.contentEl.createEl("div", {
        text: this.error,
        cls: "dw-area-suggestion-error",
      });
      return;
    }

    if (this.loading) {
      this.contentEl.createEl("p", {
        text: "Classifying every note in the vault…",
        cls: "area-triage-loading",
      });
      return;
    }

    const rows = this.filtered();
    if (rows.length === 0) {
      this.contentEl.createEl("p", {
        text: "No classifications yet. Hit Rescan.",
        cls: "areas-view-empty",
      });
      return;
    }

    this.renderTable(rows);
  }

  private renderHeader(): void {
    const header = this.contentEl.createEl("div", { cls: "area-table-header" });
    const topRow = header.createEl("div", { cls: "area-triage-top" });

    topRow.createEl("div", {
      text: "\u{1F5C2}️ Area Table",
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
      this.limit = PAGE_SIZE;
      this.render();
    });

    const rescan = topRow.createEl("button", {
      text: this.loading ? "Scanning…" : "Rescan",
      cls: "area-triage-rescan",
    });
    rescan.disabled = this.loading;
    rescan.addEventListener("click", () => {
      void this.scan();
    });

    const shown = this.loading ? 0 : this.filtered().length;
    header.createEl("div", {
      text: `${shown} notes · sorted by ${this.sortKey} ${this.sortAsc ? "↑" : "↓"}`,
      cls: "area-triage-progress",
    });
  }

  private renderTable(rows: Row[]): void {
    const table = this.contentEl.createEl("table", { cls: "area-table" });
    const headRow = table.createEl("thead").createEl("tr");

    for (const column of COLUMNS) {
      const th = headRow.createEl("th", { cls: column.cls });
      const key = column.key;
      if (key === null) {
        th.setText(column.label);
        continue;
      }
      const button = th.createEl("button", {
        text: column.label,
        cls: "area-table-sort",
      });
      if (this.sortKey === key) {
        button.addClass("is-active");
        button.createEl("span", {
          text: this.sortAsc ? " ↑" : " ↓",
          cls: "area-table-sort-arrow",
        });
      }
      button.addEventListener("click", () => {
        this.sortBy(key);
      });
    }

    const body = table.createEl("tbody");
    for (const row of rows.slice(0, this.limit)) {
      this.renderRow(body, row);
    }

    if (rows.length > this.limit) {
      const more = this.contentEl
        .createEl("div", { cls: "area-triage-actions" })
        .createEl("button", {
          text: `Show ${Math.min(PAGE_SIZE, rows.length - this.limit)} more (${rows.length - this.limit} left)`,
        });
      more.addEventListener("click", () => {
        this.limit += PAGE_SIZE;
        this.render();
      });
    }
  }

  private renderRow(body: HTMLElement, row: Row): void {
    const tr = body.createEl("tr", { cls: "area-table-row" });

    const noteCell = tr.createEl("td", { cls: "area-table-col-note" });
    noteCell.createEl("span", {
      text: row.file ? noteBullet(this.app, row.file) : DEFAULT_BULLET,
      cls: "area-table-icon",
    });
    const link = noteCell.createEl("a", {
      text: row.suggestion.title || row.path,
      cls: "area-table-note-title",
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      this.openRow(row);
    });

    tr.createEl("td", { text: row.folder, cls: "area-table-col-folder" });

    const scoreCell = tr.createEl("td", { cls: "area-table-col-score" });
    if (row.score > 0) {
      scoreCell.createEl("span", {
        text: row.score.toFixed(2),
        cls: `dw-area-suggestion-score is-${confidenceOf(row.score)}`,
      });
    } else {
      scoreCell.createEl("span", { text: "—", cls: "area-table-empty" });
    }

    tr.createEl("td", {
      text: row.suggestion.abstained
        ? `${row.suggestion.strategy} (abstained)`
        : row.suggestion.strategy,
      cls: "area-table-col-strategy",
    });

    const areasCell = tr.createEl("td", { cls: "area-table-col-areas" });
    for (const choice of row.suggestion.choices) {
      const chip = areasCell.createEl("span", { cls: "area-table-chip" });
      chip.createEl("span", {
        text: areaIcon(this.app, choice.area) ?? DEFAULT_BULLET,
        cls: "area-triage-choice-icon",
      });
      chip.createEl("span", { text: choice.area });
      chip.createEl("span", {
        text: choice.score.toFixed(2),
        cls: `area-table-chip-score dw-area-suggestion-score is-${confidenceOf(choice.score)}`,
      });
    }
    if (row.suggestion.choices.length === 0) {
      areasCell.createEl("span", { text: "—", cls: "area-table-empty" });
    }

    const existingCell = tr.createEl("td", { cls: "area-table-col-existing" });
    for (const area of row.suggestion.existing_areas) {
      const chip = existingCell.createEl("span", { cls: "area-table-chip" });
      chip.createEl("span", {
        text: areaIcon(this.app, area) ?? DEFAULT_BULLET,
        cls: "area-triage-choice-icon",
      });
      chip.createEl("span", { text: area });
    }
    if (row.suggestion.existing_areas.length === 0) {
      existingCell.createEl("span", { text: "—", cls: "area-table-empty" });
    }
  }

  /** Re-clicking the active column flips direction; a new column starts on the
   * direction that puts the interesting end first -- highest score, A-Z text. */
  private sortBy(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = key !== "score";
    }
    this.limit = PAGE_SIZE;
    this.render();
  }

  private openRow(row: Row): void {
    const file = row.file ?? this.app.vault.getFileByPath(row.path);
    if (!file) {
      new Notice(`Can't open ${row.path || row.suggestion.note}`);
      return;
    }
    void this.app.workspace.getLeaf("tab").openFile(file);
  }
}

/**
 * The classifier walks the filesystem, which on macOS hands back decomposed
 * (NFD) filenames for anything accented -- "Andr\u00e9" arrives as "Andre" plus a
 * combining acute. Obsidian stores every path composed (NFC), so the two forms
 * are the same name and different strings, and a raw lookup misses every note
 * with a diacritic in its title.
 */
function toRow(app: App, suggestion: AreaSuggestion, vaultPath: string): Row {
  const absolute = suggestion.note.normalize("NFC");
  const base = vaultPath.normalize("NFC");
  const path = absolute.startsWith(`${base}/`)
    ? absolute.slice(base.length + 1)
    : absolute;
  return {
    suggestion,
    path,
    folder: path.includes("/") ? path.split("/")[0] : "/",
    file: app.vault.getFileByPath(path),
    score: suggestion.choices[0]?.score ?? 0,
  };
}

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "score":
      return a.score - b.score;
    case "folder":
      return a.folder.localeCompare(b.folder) || a.path.localeCompare(b.path);
    case "strategy":
      return (
        a.suggestion.strategy.localeCompare(b.suggestion.strategy) ||
        a.score - b.score
      );
    case "existing":
      return (
        a.suggestion.existing_areas.join(" ").localeCompare(
          b.suggestion.existing_areas.join(" "),
        ) || a.path.localeCompare(b.path)
      );
    default:
      return (a.suggestion.title || a.path).localeCompare(
        b.suggestion.title || b.path,
      );
  }
}
