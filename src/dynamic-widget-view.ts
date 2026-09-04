import { ItemView, TFile, type WorkspaceLeaf } from "obsidian";
import { collectAreaNames, getAreaHierarchy } from "./areas-hierarchy";
import { type CalendarEvent, fetchEventsForDate } from "./calendar";
import type DynamicWidgetPlugin from "./main";
import {
  formatRelativeDeadline,
  isFilePrivate,
  isValidHex,
  normalizeAreasFrontmatter,
  redactText,
  simplifyWikiLink,
} from "./utils";

export const VIEW_TYPE_DYNAMIC_WIDGET = "dynamic-widget-view";
const dayFileNameRegex = /^\d{4}-\d{2}-\d{2}$/;

function formatEventTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sanitizeFilenameSegment(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatEventDateLabel(date: Date): string {
  return date
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .replace(/,/g, "");
}

function buildEventNoteFilename(event: CalendarEvent): string {
  const title = sanitizeFilenameSegment(event.title) || "Event";
  const dateLabel = formatEventDateLabel(event.startDate);
  return `${title} (${dateLabel})`;
}

function toLocalIsoDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function toLocalIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDurationMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildEventNoteContent(event: CalendarEvent): string {
  const isMeeting = Boolean(event.attendees && event.attendees.length > 0);
  const lines: string[] = ["---"];
  lines.push(`type: ${isMeeting ? "meeting" : "event"}`);
  lines.push(`calendar_id: ${event.id}`);
  lines.push(
    `when: ${event.allDay ? toLocalIsoDate(event.startDate) : toLocalIsoDateTime(event.startDate)}`,
  );

  if (isMeeting && !event.allDay) {
    const duration = event.endDate.getTime() - event.startDate.getTime();
    lines.push(`length: ${formatDurationMmSs(duration)}`);
  }

  lines.push("aliases:");
  lines.push(`  - "${event.title.replace(/"/g, '\\"')}"`);

  lines.push("areas: []");

  if (isMeeting && event.attendees) {
    lines.push("with:");
    for (const attendee of event.attendees) {
      const label = attendee.name || attendee.email;
      if (!label) continue;
      lines.push(`  - "[[${label.replace(/"/g, '\\"')}]]"`);
    }
  }

  if (event.location) {
    lines.push(`location: ${JSON.stringify(event.location)}`);
  }

  lines.push("---");
  lines.push("");

  if (event.notes) {
    lines.push(event.notes.trim());
    lines.push("");
  }

  return lines.join("\n");
}

type TimeGroup =
  | { compareRule: "start-of-day"; staleLabel: string; updatedLabel: string }
  | { compareRule: "relative-date" }
  | { compareRule: "day-heatmap" };

type FolderWithTitle = {
  folder: string;
  title: string;
  timeGroup?: TimeGroup;
};

const IS_AREA_FOLDERS: FolderWithTitle[] = [
  { folder: "Areas", title: "🏠 Areas" },
  { folder: "Inbox", title: "📥 Inbox" },
  { folder: "Goals", title: "🎯 Goals" },
  { folder: "Projects/Active", title: "✅ Active Projects" },
  { folder: "Projects/Waiting For", title: "⏳ Waiting For" },
  { folder: "Relationships", title: "👥 Relationships" },
  { folder: "Resources", title: "📚 Resources" },
  {
    folder: "Projects/Someday Maybe",
    title: "🔮 Someday Maybe",
    timeGroup: { compareRule: "relative-date" },
  },
  {
    folder: "Archives",
    title: "🗄️ Archives",
    timeGroup: { compareRule: "relative-date" },
  },
];

const HAS_AREAS_FOLDERS: FolderWithTitle[] = [
  { folder: "Areas", title: "🏠 Areas" },
  { folder: "Inbox", title: "📥 Inbox" },
  { folder: "Goals", title: "🎯 Goals" },
  { folder: "Projects/Active", title: "✅ Active Projects" },
  { folder: "Projects/Waiting For", title: "⏳ Waiting For" },
  { folder: "Relationships", title: "👥 Relationships" },
  { folder: "Resources", title: "📚 Resources" },
  {
    folder: "Projects/Someday Maybe",
    title: "🔮 Someday Maybe",
    timeGroup: { compareRule: "relative-date" },
  },
  {
    folder: "Archives",
    title: "🗄️ Archives",
    timeGroup: { compareRule: "relative-date" },
  },
];

const IS_DAILY_FOLDERS: FolderWithTitle[] = [
  {
    folder: "Inbox",
    title: "📥 Inbox",
    timeGroup: { compareRule: "relative-date" },
  },
];

const RELATIONSHIP_FOLDERS: FolderWithTitle[] = [
  { folder: "Inbox", title: "📥 Inbox" },
  { folder: "Projects/Active", title: "✅ Active Projects" },
  { folder: "Projects/Waiting For", title: "⏳ Waiting For" },
  {
    folder: "Projects/Someday Maybe",
    title: "🔮 Someday Maybe",
    timeGroup: { compareRule: "relative-date" },
  },
  {
    folder: "Days",
    title: "📅 Days",
    timeGroup: { compareRule: "day-heatmap" },
  },
  { folder: "Goals", title: "🎯 Goals" },
  { folder: "Areas", title: "🏠 Areas" },
  { folder: "Resources", title: "📚 Resources" },
  {
    folder: "Archives",
    title: "🗄️ Archives",
    timeGroup: { compareRule: "relative-date" },
  },
];

const NO_ACTIVE_FILE: FolderWithTitle[] = [
  {
    folder: "Inbox",
    title: "📥 Inbox",
    timeGroup: { compareRule: "relative-date" },
  },
];

type FilesByFolder = { folder: FolderWithTitle; files: TFile[] }[];

export class DynamicWidgetView extends ItemView {
  contentEl: HTMLElement = document.createElement("div");
  private plugin: DynamicWidgetPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: DynamicWidgetPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DYNAMIC_WIDGET;
  }

  getDisplayText(): string {
    return "Dynamic Widget";
  }

  getIcon(): string {
    return "activity";
  }

  refreshContent(): void {
    this.updateContent();
  }

  private makeUlLinkListWithTitle(
    title: string,
    list: TFile[] | undefined,
  ): Element {
    if (!list || list.length === 0) {
      return document.createElement("div");
    }
    const sectionEl = document.createElement("section");
    sectionEl.createEl("h3", { text: title });
    const ulEl = this.makeUlLinkList(list);
    sectionEl.appendChild(ulEl);
    return sectionEl;
  }

  private makeUlLinkListWithTimeGroups(
    title: string,
    files: TFile[],
    startOfDay: Date,
    staleLabel: string,
    updatedLabel: string,
  ): Element {
    if (!files || files.length === 0) {
      return document.createElement("div");
    }

    const startMs = startOfDay.getTime();
    const stale = files.filter((f) => f.stat.mtime < startMs);
    const updated = files.filter((f) => f.stat.mtime >= startMs);

    const sectionEl = document.createElement("section");
    sectionEl.createEl("h3", { text: title });

    if (stale.length > 0) {
      sectionEl.createEl("h4", {
        text: staleLabel,
        cls: "dynamic-widget-time-group-label",
      });
      sectionEl.appendChild(this.makeUlLinkList(stale));
    }

    if (updated.length > 0) {
      sectionEl.createEl("h4", {
        text: updatedLabel,
        cls: "dynamic-widget-time-group-label",
      });
      sectionEl.appendChild(this.makeUlLinkList(updated));
    }

    return sectionEl;
  }

  private computeRelativeDateGroups(
    now: Date,
  ): { label: string; minMs: number; maxMs: number }[] {
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();

    const startOfYesterday = startOfToday - 86400000;

    // Monday of this week (ISO: Monday = 1)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfThisWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysFromMonday,
    ).getTime();

    const startOfLastWeek = startOfThisWeek - 7 * 86400000;

    const startOfThisMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).getTime();

    const startOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    ).getTime();

    const startOfThisYear = new Date(now.getFullYear(), 0, 1).getTime();
    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1).getTime();

    return [
      { label: "Today", minMs: startOfToday, maxMs: Number.POSITIVE_INFINITY },
      { label: "Yesterday", minMs: startOfYesterday, maxMs: startOfToday },
      { label: "This Week", minMs: startOfThisWeek, maxMs: startOfYesterday },
      { label: "Last Week", minMs: startOfLastWeek, maxMs: startOfThisWeek },
      {
        label: "This Month",
        minMs: startOfThisMonth,
        maxMs: startOfLastWeek,
      },
      {
        label: "Last Month",
        minMs: startOfLastMonth,
        maxMs: startOfThisMonth,
      },
      { label: "This Year", minMs: startOfThisYear, maxMs: startOfLastMonth },
      { label: "Last Year", minMs: startOfLastYear, maxMs: startOfThisYear },
      { label: "Previously", minMs: 0, maxMs: startOfLastYear },
    ];
  }

  private makeUlLinkListWithRelativeDateGroups(
    title: string,
    files: TFile[],
  ): Element {
    if (!files || files.length === 0) {
      return document.createElement("div");
    }

    const groups = this.computeRelativeDateGroups(new Date());
    const sectionEl = document.createElement("section");
    sectionEl.createEl("h3", { text: title });

    const seen = new Set<string>();
    for (const group of groups) {
      const groupFiles = files
        .filter(
          (f) =>
            !seen.has(f.path) &&
            f.stat.mtime >= group.minMs &&
            f.stat.mtime < group.maxMs,
        )
        .sort((a, b) => b.stat.mtime - a.stat.mtime);

      for (const f of groupFiles) seen.add(f.path);

      if (groupFiles.length === 0) continue;

      sectionEl.createEl("h4", {
        text: group.label,
        cls: "dynamic-widget-time-group-label",
      });
      sectionEl.appendChild(this.makeUlLinkList(groupFiles));
    }

    return sectionEl;
  }

  private makeDaysHeatmap(title: string, files: TFile[]): Element {
    if (!files || files.length === 0) {
      return document.createElement("div");
    }

    const linked = new Map<string, TFile>();
    for (const file of files) {
      if (!file.basename.match(dayFileNameRegex)) continue;
      linked.set(file.basename, file);
    }

    if (linked.size === 0) {
      return document.createElement("div");
    }

    const keys = [...linked.keys()].sort();
    const parseKey = (key: string): Date => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d);
    };
    const minDate = parseKey(keys[0]);
    const maxDate = parseKey(keys[keys.length - 1]);

    const minDayOfWeek = minDate.getDay();
    const minDaysFromMonday = minDayOfWeek === 0 ? 6 : minDayOfWeek - 1;
    const snappedMin = new Date(
      minDate.getFullYear(),
      minDate.getMonth(),
      minDate.getDate() - minDaysFromMonday,
    );
    const maxDayOfWeek = maxDate.getDay();
    const maxDaysToSunday = maxDayOfWeek === 0 ? 0 : 7 - maxDayOfWeek;
    const snappedMax = new Date(
      maxDate.getFullYear(),
      maxDate.getMonth(),
      maxDate.getDate() + maxDaysToSunday,
    );

    type Cell = { date: Date; file?: TFile };
    type Week = { monday: Date; cells: Cell[] };
    const weeks: Week[] = [];
    const cursor = new Date(snappedMin);
    while (cursor.getTime() <= snappedMax.getTime()) {
      const monday = new Date(cursor);
      const cells: Cell[] = [];
      for (let row = 0; row < 7; row++) {
        const cellDate = new Date(cursor);
        const file = linked.get(toLocalIsoDate(cellDate));
        cells.push(file ? { date: cellDate, file } : { date: cellDate });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push({ monday, cells });
    }

    const activeFile = this.app.workspace.getActiveFile();
    const suppressInteractivity =
      this.plugin.privateMode &&
      activeFile !== null &&
      (activeFile.path.startsWith("Relationships/") ||
        isFilePrivate(this.app, activeFile));

    const sectionEl = document.createElement("section");
    sectionEl.classList.add("dynamic-widget-heatmap");
    sectionEl.createEl("h3", { text: title });

    const chunksEl = sectionEl.createEl("div", {
      cls: "dynamic-widget-heatmap-chunks",
    });

    const CELL_SIZE = 11;
    const CELL_GAP = 2;
    const CELL_PITCH = CELL_SIZE + CELL_GAP;
    const MIN_WEEKS_PER_CHUNK = 4;

    const MIN_LABEL_GAP = 3;

    const renderChunks = (weeksPerChunk: number): void => {
      chunksEl.empty();
      for (let start = 0; start < weeks.length; start += weeksPerChunk) {
        const chunkWeeks = weeks.slice(start, start + weeksPerChunk);
        const chunkEl = chunksEl.createEl("div", {
          cls: "dynamic-widget-heatmap-chunk",
        });
        const yearsEl = chunkEl.createEl("div", {
          cls: "dynamic-widget-heatmap-years",
        });
        const monthsEl = chunkEl.createEl("div", {
          cls: "dynamic-widget-heatmap-months",
        });
        const gridEl = chunkEl.createEl("div", {
          cls: "dynamic-widget-heatmap-grid",
        });

        let lastYear = -1;
        let lastYearCol = Number.NEGATIVE_INFINITY;
        let lastMonth = -1;
        let lastMonthCol = Number.NEGATIVE_INFINITY;

        chunkWeeks.forEach((week, col) => {
          const year = week.monday.getFullYear();
          const month = week.monday.getMonth();

          if (year !== lastYear && col - lastYearCol >= MIN_LABEL_GAP) {
            const yearLabel = yearsEl.createEl("span", {
              text: `'${String(year).slice(-2)}`,
            });
            yearLabel.style.gridColumn = String(col + 1);
            lastYearCol = col;
          }
          if (year !== lastYear) lastYear = year;

          if (month !== lastMonth && col - lastMonthCol >= MIN_LABEL_GAP) {
            const monthName = week.monday.toLocaleDateString("en-US", {
              month: "short",
            });
            const labelEl = monthsEl.createEl("span", { text: monthName });
            labelEl.style.gridColumn = String(col + 1);
            lastMonthCol = col;
          }
          if (month !== lastMonth) lastMonth = month;

          for (const cell of week.cells) {
            const cellEl = gridEl.createEl("div", {
              cls: "dynamic-widget-heatmap-cell",
            });
            if (cell.file) {
              cellEl.classList.add("is-linked");
              if (!suppressInteractivity) {
                const file = cell.file;
                cellEl.setAttribute(
                  "title",
                  cell.date.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
                );
                cellEl.setAttribute("role", "button");
                cellEl.setAttribute("tabindex", "0");
                cellEl.addEventListener("click", (event) => {
                  event.preventDefault();
                  this.app.workspace.getLeaf("tab").openFile(file);
                });
                cellEl.addEventListener("keydown", (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.app.workspace.getLeaf("tab").openFile(file);
                  }
                });
              }
            } else {
              cellEl.setAttribute("aria-hidden", "true");
            }
          }
        });
      }
    };

    let currentWeeksPerChunk = Math.min(weeks.length, 20);
    renderChunks(currentWeeksPerChunk);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const fit = Math.floor(width / CELL_PITCH);
      const next = Math.max(MIN_WEEKS_PER_CHUNK, Math.min(weeks.length, fit));
      if (next !== currentWeeksPerChunk) {
        currentWeeksPerChunk = next;
        renderChunks(next);
      }
    });
    observer.observe(chunksEl);
    this.register(() => observer.disconnect());

    return sectionEl;
  }

  private makeUlLinkList(list: TFile[] | undefined): Element {
    if (!list || list.length === 0) {
      return document.createElement("div");
    }
    const ulEl = document.createElement("ul");
    const activeFile = this.app.workspace.getActiveFile();

    // Add emoji bullet class
    ulEl.classList.add("emoji-bullet-list");

    const liEls = list
      .sort((a, b) => {
        const aMetadata = this.app.metadataCache.getFileCache(a);
        const bMetadata = this.app.metadataCache.getFileCache(b);
        const areaA = aMetadata?.frontmatter?.areas?.[0]; // might not exist
        const areaB = bMetadata?.frontmatter?.areas?.[0]; // might not exist
        if (areaA && areaB) {
          return areaA.localeCompare(areaB);
        }
        if (areaA && !areaB) return -1;
        if (!areaA && areaB) return 1;
        if (!areaA && !areaB) return 0;
      })
      .map((note) => {
        const projectEl = document.createElement("li");
        const isPrivate =
          this.plugin.privateMode &&
          (note.path.startsWith("Relationships/") ||
            isFilePrivate(this.app, note));

        if (activeFile && activeFile.path === note.path) {
          const span = projectEl.createEl("span", {
            text: isPrivate
              ? `👉 ${redactText(note.basename)}`
              : `👉 ${note.basename}`,
            cls: "dynamic-widget-active-file",
          });
          if (isPrivate) {
            span.classList.add("dynamic-widget-private");
          }
          return projectEl;
        }

        const metadata = this.app.metadataCache.getFileCache(note);

        projectEl.classList.add("emoji-bullet-item");

        // Extract emoji from the file's path
        const icon = metadata?.frontmatter?.icon;
        if (icon) {
          projectEl.style.setProperty("--emoji-bullet", `"${icon}"`);
        } else {
          projectEl.style.setProperty("--emoji-bullet", "'⏺️'");
        }

        const title = metadata?.frontmatter?.title || note.basename;
        const linkEl = projectEl.createEl("a", {
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
        const isArchived = note.path.startsWith("Archives/");
        if (deadline != null && !isArchived) {
          const label = formatRelativeDeadline(deadline);
          if (label) {
            projectEl.createEl("div", {
              text: label,
              cls: "dynamic-widget-project-deadline",
            });
          }
        }

        return projectEl;
      });
    for (const liEl of liEls) {
      ulEl.appendChild(liEl);
    }
    return ulEl;
  }

  private filesByFolders(
    allFiles: TFile[],
    folders: FolderWithTitle[],
  ): FilesByFolder {
    const notesByFolder: FilesByFolder = [];
    for (const folderWithTitle of folders) {
      const files = allFiles
        .filter(
          (file) =>
            file.path.startsWith(folderWithTitle.folder) &&
            file.extension === "md",
        )
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      if (files) {
        notesByFolder.push({ folder: folderWithTitle, files });
      }
    }
    return notesByFolder;
  }

  private renderFolderSection(
    folder: FolderWithTitle,
    files: TFile[],
  ): Element {
    const { timeGroup } = folder;
    if (!timeGroup) {
      return this.makeUlLinkListWithTitle(folder.title, files);
    }
    switch (timeGroup.compareRule) {
      case "start-of-day": {
        const now = new Date();
        const startOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        return this.makeUlLinkListWithTimeGroups(
          folder.title,
          files,
          startOfDay,
          timeGroup.staleLabel,
          timeGroup.updatedLabel,
        );
      }
      case "relative-date":
        return this.makeUlLinkListWithRelativeDateGroups(folder.title, files);
      case "day-heatmap":
        return this.makeDaysHeatmap(folder.title, files);
    }
  }

  private readonly simplifyWikiLink = simplifyWikiLink;

  private normalizeAreasFrontmatter = normalizeAreasFrontmatter;

  private getFilesByArea(area: string): TFile[] {
    return this.app.vault.getFiles().filter((file) => {
      const metadata = this.app.metadataCache.getFileCache(file);

      const fileAreas: string[] | undefined = this.normalizeAreasFrontmatter(
        metadata?.frontmatter?.areas,
      );
      if (!fileAreas?.length) {
        return false;
      }

      const fileHasArea = fileAreas.map(this.simplifyWikiLink).includes(area);
      return fileHasArea;
    });
  }

  private getFilesByDayCreated(date: Date) {
    const files = this.app.vault
      .getFiles()
      .filter((file) => {
        const fileDate = new Date(file.stat.ctime);
        return (
          file.extension === "md" &&
          fileDate.getFullYear() === date.getFullYear() &&
          fileDate.getMonth() === date.getMonth() &&
          fileDate.getDate() === date.getDate()
        );
      })
      .sort((a, b) => {
        return (
          new Date(b.stat.ctime).getTime() - new Date(a.stat.ctime).getTime()
        );
      });

    const newFiles = this.makeUlLinkListWithTitle("🌱 Created", files);
    this.contentEl.appendChild(newFiles);
  }

  private getFilesByDayModified(date: Date) {
    const files = this.app.vault
      .getFiles()
      .filter((file) => {
        const fileDate = new Date(file.stat.mtime);
        return (
          file.extension === "md" &&
          fileDate.getFullYear() === date.getFullYear() &&
          fileDate.getMonth() === date.getMonth() &&
          fileDate.getDate() === date.getDate()
        );
      })
      .sort((a, b) => {
        return (
          new Date(b.stat.mtime).getTime() - new Date(a.stat.mtime).getTime()
        );
      });

    const newFiles = this.makeUlLinkListWithTitle("🪴 Modified", files);
    this.contentEl.appendChild(newFiles);
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("dynamic-widget-container");

    // Create and store reference to content container
    this.contentEl = container.createEl("div", {
      cls: "dynamic-widget-content",
    });

    // Initial content update
    this.updateContent();

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateContent();
      }),
    );

    // Listen for file modifications
    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        if (activeFile.path === file.path) {
          this.updateContent();
          return;
        }
        // Relationship view depends on backlinks from other files, so any
        // metadata change elsewhere can alter what should render.
        if (activeFile.path.startsWith("Relationships/")) {
          this.updateContent();
        }
      }),
    );

    // Listen for file movements/renames
    this.registerEvent(
      this.app.vault.on("rename", (file: TFile) => {
        const activeFile = this.app.workspace.getActiveFile();

        // If the currently active file was moved, always update
        if (activeFile && activeFile.path === file.path) {
          this.updateContent();
          return;
        }

        // Update when any file with the same area is moved
        if (activeFile) {
          const metadata = this.app.metadataCache.getFileCache(activeFile);
          const currentArea = metadata?.frontmatter?.area;
          if (currentArea) {
            const movedFileMetadata = this.app.metadataCache.getFileCache(file);
            const movedFileArea = movedFileMetadata?.frontmatter?.area;
            // Update if the moved file shares the same area
            if (
              movedFileArea &&
              movedFileArea.replace(/\[\[|\]\]/g, "") ===
                currentArea.replace(/\[\[|\]\]/g, "")
            ) {
              this.updateContent();
            }
          }
        }
      }),
    );

    // Listen for file deletions
    this.registerEvent(
      this.app.vault.on("delete", () => {
        // Update when any file with the same area is deleted
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          const metadata = this.app.metadataCache.getFileCache(activeFile);
          const currentArea = metadata?.frontmatter?.area;
          if (currentArea) {
            // Since the file is deleted, we can't check its metadata
            // So we update the widget to reflect the deletion
            this.updateContent();
          }
        }
      }),
    );
  }

  private determineActiveFileType(
    activeFile: TFile | null,
  ): "area" | "areas" | "day" | "relationship" | "other" {
    if (!activeFile) {
      return "other";
    }
    if (activeFile.path.startsWith("Areas/")) {
      return "area";
    }
    if (activeFile.path.startsWith("Relationships/")) {
      return "relationship";
    }
    const metadata = this.app.metadataCache.getFileCache(activeFile);
    if (metadata?.frontmatter?.areas) {
      return "areas";
    }
    if (activeFile.basename.match(dayFileNameRegex)) {
      return "day";
    }
    return "other";
  }

  private renderImage(coverUrl: string): void {
    const imgEl = this.contentEl.createEl("img", {
      cls: "area-cover-image",
      attr: { src: coverUrl, alt: "Cover image" },
    });
    imgEl.style.maxWidth = "100%";
    imgEl.style.borderRadius = "8px";
    imgEl.style.marginBottom = "10px";
    this.contentEl.appendChild(imgEl);
  }

  private renderVideo(coverUrl: string): void {
    const videoEl = this.contentEl.createEl("video", {
      cls: "area-cover-image",
      attr: {
        src: coverUrl,
        autoplay: "",
        muted: "",
        alt: "Cover video",
      },
    });
    videoEl.style.maxWidth = "100%";
    videoEl.style.borderRadius = "8px";
    videoEl.style.marginBottom = "10px";
    this.contentEl.appendChild(videoEl);
  }

  private renderMedia({
    cover,
    activeFilePath,
  }: {
    cover: string | undefined;
    activeFilePath: string;
  }): void {
    if (!cover) return;

    // Skip media rendering entirely for private files
    if (this.plugin.privateMode) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && isFilePrivate(this.app, activeFile)) return;
    }

    // Strip wiki link brackets if present
    const cleanCover = cover.replace(/\[\[|\]\]/g, "");

    const coverFile = this.app.metadataCache.getFirstLinkpathDest(
      cleanCover,
      activeFilePath,
    );

    if (!coverFile) return;

    const coverUrl = this.app.vault.getResourcePath(coverFile);
    const fileExtension = coverFile.extension.toLowerCase();

    // Define image and video extensions
    const imageExtensions = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "svg",
      "webp",
      "avif",
    ];
    const videoExtensions = ["mp4", "webm", "ogg", "mov", "avi", "mkv"];

    if (imageExtensions.includes(fileExtension)) {
      this.renderImage(coverUrl);
    } else if (videoExtensions.includes(fileExtension)) {
      this.renderVideo(coverUrl);
    }
  }

  private renderAreaContent(activeFile: TFile): void {
    const metadata = this.app.metadataCache.getFileCache(activeFile);

    this.renderMedia({
      cover: metadata?.frontmatter?.cover,
      activeFilePath: activeFile.path,
    });

    let areas: string[] = [];

    if (activeFile.path.startsWith("Areas/")) {
      areas = [activeFile.basename];
    } else {
      // Use areas frontmatter
      const areasFrontmatter = this.normalizeAreasFrontmatter(
        metadata?.frontmatter?.areas,
      );
      if (areasFrontmatter && areasFrontmatter.length > 0) {
        areas = areasFrontmatter.map(this.simplifyWikiLink);
      }
    }

    if (areas.length > 0) {
      const areasFiles: TFile[] = [];
      const areasHeaderEl = this.contentEl.createEl("div", {
        cls: "areas-header",
      });
      areasHeaderEl.style.display = "flex";
      areasHeaderEl.style.flexWrap = "wrap";
      areasHeaderEl.style.gap = "10px";

      for (const area of areas) {
        const icon = metadata?.frontmatter?.icon;
        const isAreaPrivate =
          this.plugin.privateMode &&
          (() => {
            const areaFile = this.app.vault
              .getFiles()
              .find((f) => f.path === `Areas/${area}.md`);
            return areaFile ? isFilePrivate(this.app, areaFile) : false;
          })();

        const displayText = isAreaPrivate
          ? redactText(area)
          : `${icon ? `${icon} ` : ""}${area}`;
        const h2 = areasHeaderEl.createEl("h2", { text: displayText });
        if (isAreaPrivate) {
          h2.classList.add("dynamic-widget-private");
        }

        const areaFiles = this.getFilesByArea(area);
        areasFiles.push(...areaFiles);
      }
      const uniqueFiles = Array.from(
        new Map(areasFiles.map((file) => [file.path, file])).values(),
      );
      const folders = this.filesByFolders(uniqueFiles, IS_AREA_FOLDERS);
      for (const folder of folders) {
        const areaSection = this.renderFolderSection(
          folder.folder,
          folder.files,
        );
        if (areaSection) {
          this.contentEl.appendChild(areaSection);
        }
      }
    }
  }

  private renderAreasContent(activeFile: TFile): void {
    const metadata = this.app.metadataCache.getFileCache(activeFile);

    this.renderMedia({
      cover: metadata?.frontmatter?.cover,
      activeFilePath: activeFile.path,
    });

    let areas: string[] = [];

    if (activeFile.path.startsWith("Areas/")) {
      areas = [activeFile.basename];
    } else {
      // Use areas frontmatter
      const areasFrontmatter = this.normalizeAreasFrontmatter(
        metadata?.frontmatter?.areas,
      );
      if (areasFrontmatter && areasFrontmatter.length > 0) {
        areas = areasFrontmatter.map(this.simplifyWikiLink);
      }
    }

    if (areas.length > 0) {
      const areasFiles: TFile[] = [];
      const areasHeaderEl = this.contentEl.createEl("div", {
        cls: "areas-header",
      });
      areasHeaderEl.style.display = "flex";
      areasHeaderEl.style.flexWrap = "wrap";
      areasHeaderEl.style.gap = "10px";

      for (const area of areas) {
        const filesByArea = this.getFilesByArea(area).filter((file) => {
          return !file.path.startsWith("Areas");
        });
        areasFiles.push(...filesByArea);
      }
      const uniqueFiles = Array.from(
        new Map(areasFiles.map((file) => [file.path, file])).values(),
      );
      const folders = this.filesByFolders(uniqueFiles, HAS_AREAS_FOLDERS);
      for (const folder of folders) {
        const areaSection = this.renderFolderSection(
          folder.folder,
          folder.files,
        );
        if (areaSection) {
          this.contentEl.appendChild(areaSection);
        }
      }
    }
  }

  private renderRelationshipContent(activeFile: TFile): void {
    const metadata = this.app.metadataCache.getFileCache(activeFile);

    this.renderMedia({
      cover: metadata?.frontmatter?.cover,
      activeFilePath: activeFile.path,
    });

    const resolved = this.app.metadataCache.resolvedLinks;
    const backlinks: TFile[] = [];
    for (const sourcePath in resolved) {
      if (!resolved[sourcePath]?.[activeFile.path]) continue;
      if (sourcePath === activeFile.path) continue;
      const source = this.app.vault.getAbstractFileByPath(sourcePath);
      if (source instanceof TFile && source.extension === "md") {
        backlinks.push(source);
      }
    }

    const folders = this.filesByFolders(backlinks, RELATIONSHIP_FOLDERS);
    for (const folder of folders) {
      const section = this.renderFolderSection(folder.folder, folder.files);
      if (section) {
        this.contentEl.appendChild(section);
      }
    }
  }

  private renderDateContent(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }

    const basename = activeFile.basename;
    if (!basename.match(dayFileNameRegex)) {
      return;
    }

    const [year, month, day] = basename.split("-").map(Number);
    const noteDate = new Date(year, month - 1, day); // month is 0-indexed
    this.contentEl.createEl("h2", {
      text: `🌅 ${noteDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`,
    });

    this.renderCalendarEventsSection(noteDate);

    const allFiles = this.app.vault.getFiles();

    // Inbox section
    const folders = this.filesByFolders(allFiles, IS_DAILY_FOLDERS);
    for (const folder of folders) {
      const section = this.renderFolderSection(folder.folder, folder.files);
      this.contentEl.appendChild(section);
    }

    // Active Projects grouped by area priority
    this.renderFolderByArea(allFiles, "Projects/Active/", "✅ Active Projects");

    // Waiting For grouped by area priority
    this.renderFolderByArea(
      allFiles,
      "Projects/Waiting For/",
      "⏳ Waiting For",
    );
  }

  private renderCalendarEventsSection(date: Date): void {
    const sectionEl = this.contentEl.createEl("section");
    sectionEl.createEl("h3", { text: "📅 Events" });
    const bodyEl = sectionEl.createEl("div", {
      cls: "calendar-events-body",
    });
    bodyEl.createEl("p", {
      text: "Loading events…",
      cls: "calendar-events-empty",
    });

    fetchEventsForDate(date).then((events) => {
      if (!sectionEl.isConnected) return;
      if (events === null) {
        sectionEl.remove();
        return;
      }
      this.populateCalendarEvents(bodyEl, events);
    });
  }

  private populateCalendarEvents(
    bodyEl: HTMLElement,
    events: CalendarEvent[],
  ): void {
    bodyEl.empty();

    if (events.length === 0) {
      bodyEl.createEl("p", {
        text: "No events today.",
        cls: "calendar-events-empty",
      });
      return;
    }

    const ulEl = bodyEl.createEl("ul", { cls: "calendar-events-list" });
    for (const ev of events) {
      const liEl = ulEl.createEl("li", { cls: "calendar-event-item" });
      liEl.setAttribute("role", "button");
      liEl.setAttribute("tabindex", "0");
      liEl.createEl("span", {
        text: ev.allDay ? "All day" : formatEventTime(ev.startDate),
        cls: "calendar-event-time",
      });
      liEl.createEl("span", {
        text: ev.title,
        cls: "calendar-event-title",
      });
      if (ev.calendar) {
        liEl.createEl("span", {
          text: ev.calendar,
          cls: "calendar-event-calendar",
        });
      }
      liEl.addEventListener("click", () => {
        this.openOrCreateEventNote(ev);
      });
      liEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.openOrCreateEventNote(ev);
        }
      });
    }
  }

  private async openOrCreateEventNote(event: CalendarEvent): Promise<void> {
    const existing = this.app.vault.getFiles().find((f) => {
      const meta = this.app.metadataCache.getFileCache(f);
      return meta?.frontmatter?.calendar_id === event.id;
    });

    if (existing) {
      this.app.workspace.getLeaf("tab").openFile(existing);
      return;
    }

    const path = this.pickEventNotePath(event);
    const content = buildEventNoteContent(event);
    try {
      const file = await this.app.vault.create(path, content);
      this.app.workspace.getLeaf("tab").openFile(file);
    } catch (err) {
      console.error("Failed to create event note", err);
    }
  }

  private pickEventNotePath(event: CalendarEvent): string {
    const base = buildEventNoteFilename(event);
    const candidatePath = `Inbox/${base}.md`;
    if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
      return candidatePath;
    }
    let n = 2;
    while (
      this.app.vault.getAbstractFileByPath(`Inbox/${base} (${n}).md`) &&
      n < 100
    ) {
      n += 1;
    }
    return `Inbox/${base} (${n}).md`;
  }

  private renderFolderByArea(
    allFiles: TFile[],
    folderPrefix: string,
    title: string,
  ): void {
    const projects = allFiles.filter(
      (f) => f.path.startsWith(folderPrefix) && f.extension === "md",
    );
    if (projects.length === 0) return;

    const sectionEl = document.createElement("section");
    sectionEl.createEl("h3", { text: title });

    const hierarchy = getAreaHierarchy(this.app);
    const claimed = new Set<string>();

    for (const node of hierarchy) {
      const areaNames = collectAreaNames(node);
      const matching = projects.filter((f) => {
        if (claimed.has(f.path)) return false;
        const meta = this.app.metadataCache.getFileCache(f);
        const fileAreas = meta?.frontmatter?.areas;
        if (!fileAreas) return false;
        return this.normalizeAreasFrontmatter(fileAreas)
          .map(this.simplifyWikiLink)
          .some((a) => areaNames.includes(a));
      });

      if (matching.length === 0) continue;

      for (const f of matching) claimed.add(f.path);

      const label =
        node.priority != null
          ? `${node.priority}. ${node.file.basename}`
          : node.file.basename;

      const groupEl = sectionEl.createEl("div", {
        cls: "dynamic-widget-area-group",
      });

      const areaMeta = this.app.metadataCache.getFileCache(node.file);
      const isAreaPrivate =
        this.plugin.privateMode && isFilePrivate(this.app, node.file);
      const rawColor = areaMeta?.frontmatter?.color;
      const color =
        !isAreaPrivate && isValidHex(rawColor) ? rawColor.trim() : null;
      if (color) {
        groupEl.classList.add("has-color");
        groupEl.style.setProperty("--area-color", color);
      }

      groupEl.createEl("h4", {
        text: label,
        cls: "dynamic-widget-time-group-label",
      });
      groupEl.appendChild(this.makeUlLinkList(matching));
    }

    // Uncategorized projects (no area match)
    const uncategorized = projects.filter((f) => !claimed.has(f.path));
    if (uncategorized.length > 0) {
      const groupEl = sectionEl.createEl("div", {
        cls: "dynamic-widget-area-group",
      });
      groupEl.createEl("h4", {
        text: "Uncategorized",
        cls: "dynamic-widget-time-group-label",
      });
      groupEl.appendChild(this.makeUlLinkList(uncategorized));
    }

    this.contentEl.appendChild(sectionEl);
  }

  private updateContent() {
    if (!this.contentEl) {
      return;
    }
    this.contentEl.empty();

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      const allFiles = this.app.vault.getFiles();

      // Inbox section
      const folders = this.filesByFolders(allFiles, NO_ACTIVE_FILE);
      for (const folder of folders) {
        const section = this.renderFolderSection(folder.folder, folder.files);
        if (section) {
          this.contentEl.appendChild(section);
        }
      }

      // Active Projects grouped by area priority
      this.renderFolderByArea(
        allFiles,
        "Projects/Active/",
        "✅ Active Projects",
      );
      return;
    }

    const activeFileType = this.determineActiveFileType(activeFile);
    switch (activeFileType) {
      case "area":
        this.renderAreaContent(activeFile);
        break;
      case "areas":
        this.renderAreasContent(activeFile);
        break;
      case "day":
        this.renderDateContent();
        break;
      case "relationship":
        this.renderRelationshipContent(activeFile);
        break;
      default:
        break;
    }
  }

  // biome-ignore lint/suspicious/useAwait: Obsidian's API requires this to be async
  async onClose() {
    this.contentEl = document.createElement("div");
  }
}
