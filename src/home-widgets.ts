import type { App, TFile } from "obsidian";
import { areaOrder, getAreaAncestors } from "./areas-hierarchy";
import { type CalendarEvent, fetchEventsForDate } from "./calendar";
import type DynamicWidgetPlugin from "./main";
import {
  areasForCalendar,
  dayFileNameRegex,
  eventNoteWhen,
  FOLDER_ICONS,
  formatDayNoteTitle,
  formatEventNoteWhen,
  formatRelativeDeadline,
  isFilePrivate,
  isSameLocalDay,
  isValidHex,
  noteBullet,
  onMiddleClick,
  openInTab,
  redactText,
  resolveCoverFile,
  simplifyWikiLink,
} from "./utils";

export interface WidgetContext {
  app: App;
  plugin: DynamicWidgetPlugin;
  open(file: TFile): void;
}

export type HomeColumn = "main" | "side";

export interface HomeWidget {
  id: string;
  title: string;
  count?(app: App): number;
  column: HomeColumn;
  onTitleClick?(ctx: WidgetContext): void;
  render(el: HTMLElement, ctx: WidgetContext): void | Promise<void>;
}

const RECENT_LISTENS = 6;
const RECENT_PEOPLE = 8;

const MEDIA: Record<string, number> = {
  book: 2 / 3,
  game: 3 / 4,
  "tv show": 2 / 3,
  movie: 2 / 3,
  album: 1,
  video: 16 / 9,
};
const MEDIA_ORDER = Object.keys(MEDIA);
const LIST_LIMIT = 8;
const RECENT_LIMIT = 12;
const REDISCOVER_PICKS = 4;
const HEATMAP_WEEKS = 53;
const MIN_MONTH_LABEL_GAP = 3;
const HEATMAP_DAY_LABELS: [number, string][] = [
  [0, "Mon"],
  [2, "Wed"],
  [4, "Fri"],
  [6, "Sun"],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function ago(ms: number): string {
  const seconds = (ms - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clock(date: Date): string {
  return date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s?(AM|PM)$/i, (_, p: string) => p.toLowerCase());
}

function filesIn(app: App, folder: string): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${folder}/`));
}

function frontmatter(app: App, file: TFile): Record<string, unknown> {
  return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

function links(value: unknown): string[] {
  if (typeof value === "string") return [simplifyWikiLink(value)];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map(simplifyWikiLink);
  }
  return [];
}

function isPrivate(ctx: WidgetContext, file: TFile): boolean {
  return (
    ctx.plugin.privateMode &&
    (file.path.startsWith("Relationships/") || isFilePrivate(ctx.app, file))
  );
}

function title(ctx: WidgetContext, file: TFile): string {
  const raw = frontmatter(ctx.app, file).title;
  const text = typeof raw === "string" && raw ? raw : file.basename;
  return isPrivate(ctx, file) ? redactText(text) : text;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`=~]/g, "")
    .trim();
}

function mediaType(app: App, file: TFile): string | null {
  const type = frontmatter(app, file).type;
  return typeof type === "string" && type in MEDIA ? type : null;
}

function activeMedia(app: App): { file: TFile; type: string }[] {
  return filesIn(app, "Projects/Active")
    .map((file) => ({ file, type: mediaType(app, file) }))
    .filter((m): m is { file: TFile; type: string } => m.type !== null);
}

function activeProjects(app: App): TFile[] {
  return filesIn(app, "Projects/Active").filter((f) => !mediaType(app, f));
}

function areaFile(app: App, name: string): TFile | null {
  return app.vault.getFileByPath(`Areas/${name}.md`);
}

function firstArea(app: App, file: TFile): string | undefined {
  return links(frontmatter(app, file).areas)[0];
}

function areaColor(ctx: WidgetContext, area: string | undefined): string | null {
  if (!area) return null;
  for (const name of [area, ...getAreaAncestors(ctx.app, area)]) {
    const file = areaFile(ctx.app, name);
    if (!file) continue;
    if (isPrivate(ctx, file)) return null;
    const color = frontmatter(ctx.app, file).color;
    if (isValidHex(color)) return color.trim();
  }
  return null;
}

function areaRank(app: App, order: Map<string, number>, area: string | undefined): number {
  if (!area) return Number.POSITIVE_INFINITY;
  const known = [area, ...getAreaAncestors(app, area)].find((name) => order.has(name));
  return known ? (order.get(known) as number) : Number.POSITIVE_INFINITY;
}

function coverSrc(ctx: WidgetContext, file: TFile): string | null {
  if (isPrivate(ctx, file)) return null;
  const cover = resolveCoverFile(ctx.app, frontmatter(ctx.app, file).cover, file.path);
  return cover ? ctx.app.vault.getResourcePath(cover) : null;
}

function makeOpenable(ctx: WidgetContext, el: HTMLElement, file: TFile): void {
  if (isPrivate(ctx, file)) {
    el.addClass("dynamic-widget-private");
    return;
  }
  el.addClass("is-clickable");
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    ctx.open(file);
  });
  onMiddleClick(el, () => openInTab(ctx.app, file, true));
}

function listRow(
  ctx: WidgetContext,
  ul: HTMLElement,
  file: TFile,
  meta?: string,
  bullet = noteBullet(ctx.app, file),
): HTMLElement {
  const li = ul.createEl("li", { cls: "dw-list-item is-row" });
  li.style.setProperty("--emoji-bullet", `"${bullet}"`);
  li.createEl("a", { text: title(ctx, file), cls: "dw-list-title" });
  if (meta) li.createDiv({ text: meta, cls: "dw-list-meta" });
  makeOpenable(ctx, li, file);
  return li;
}

function fileList(
  ctx: WidgetContext,
  el: HTMLElement,
  files: TFile[],
  meta: (file: TFile) => string | undefined,
  empty: string,
): void {
  if (files.length === 0) {
    el.createEl("p", { text: empty, cls: "home-widget-empty" });
    return;
  }
  const ul = el.createEl("ul", { cls: "dw-list" });
  for (const file of files.slice(0, LIST_LIMIT)) listRow(ctx, ul, file, meta(file));
  if (files.length > LIST_LIMIT) {
    el.createDiv({ text: `+${files.length - LIST_LIMIT} more`, cls: "home-widget-more" });
  }
}

function projectRow(
  ctx: WidgetContext,
  list: HTMLElement,
  file: TFile,
): { tags: HTMLElement; sub: HTMLElement } {
  const row = list.createDiv("home-project");
  const color = areaColor(ctx, firstArea(ctx.app, file));
  if (color) row.style.setProperty("--area-color", color);
  makeOpenable(ctx, row, file);

  const src = coverSrc(ctx, file);
  const art = row.createDiv("home-project-art");
  if (src) art.createEl("img", { attr: { src, alt: "" } });
  else art.setText(noteBullet(ctx.app, file));

  const main = row.createDiv("home-project-main");
  main.createDiv({ text: title(ctx, file), cls: "home-project-title" });
  const line = main.createDiv("home-project-line");
  return { tags: line.createDiv("home-project-tags"), sub: line.createDiv("home-project-next") };
}

function openTasks(app: App, file: TFile): { open: number; done: number; firstLine?: number } {
  let open = 0;
  let done = 0;
  let firstLine: number | undefined;
  for (const item of app.metadataCache.getFileCache(file)?.listItems ?? []) {
    if (item.task === " ") {
      open += 1;
      firstLine ??= item.position.start.line;
    } else if (item.task === "x" || item.task === "X") {
      done += 1;
    }
  }
  return { open, done, firstLine };
}

function lineCount(app: App, file: TFile): number {
  const sections = app.metadataCache.getFileCache(file)?.sections;
  return sections?.length ? sections[sections.length - 1].position.end.line + 1 : 0;
}

function todayNote(app: App): TFile | null {
  return app.vault.getFileByPath(`Days/${isoDay(new Date())}.md`);
}

function commandsOf(app: App): { executeCommandById(id: string): boolean } {
  return (app as App & { commands: { executeCommandById(id: string): boolean } }).commands;
}

export function openToday(ctx: WidgetContext): void {
  const note = todayNote(ctx.app);
  if (note) ctx.open(note);
  else commandsOf(ctx.app).executeCommandById("daily-notes");
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  let state = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const projects: HomeWidget = {
  id: "projects",
  title: `${FOLDER_ICONS["Projects/Active"]} Active Projects`,
  count: (app) => activeProjects(app).length,
  column: "main",
  async render(el, ctx) {
    const { app } = ctx;
    const order = areaOrder(app);
    const rank = new Map(activeProjects(app).map((f) => [f, areaRank(app, order, firstArea(app, f))]));
    const files = [...rank.keys()].sort(
      (a, b) => (rank.get(a) as number) - (rank.get(b) as number) || a.basename.localeCompare(b.basename),
    );
    if (files.length === 0) {
      el.createEl("p", { text: "No active projects.", cls: "home-widget-empty" });
      return;
    }

    const list = el.createDiv("home-projects");
    const pending: Promise<void>[] = [];
    for (const file of files) {
      const area = firstArea(app, file);
      const { tags, sub } = projectRow(ctx, list, file);
      const { open, done, firstLine } = openTasks(app, file);
      if (firstLine != null && !isPrivate(ctx, file)) {
        pending.push(
          app.vault.cachedRead(file).then((content) => {
            const line = content.split("\n")[firstLine] ?? "";
            sub.setText(`→ ${stripMarkdown(line.replace(/^\s*[-*]\s*\[ \]\s*/, ""))}`);
          }),
        );
      }

      if (area) tags.createSpan({ text: area, cls: "home-project-area" });
      const deadline = formatRelativeDeadline(frontmatter(app, file).deadline as string);
      if (deadline) tags.createSpan({ text: deadline, cls: "home-project-tag" });

      const total = open + done;
      if (total > 0) {
        const progress = tags.createDiv("home-project-progress");
        const ring = progress.createDiv("home-project-ring");
        ring.style.setProperty("--pct", String(Math.round((done / total) * 100)));
        progress.createSpan({ text: `${done}/${total}`, cls: "home-project-count" });
      }
    }
    await Promise.all(pending);
  },
};

export async function renderToday(
  el: HTMLElement,
  ctx: WidgetContext,
  onEvent?: (event: CalendarEvent, background: boolean) => void,
): Promise<void> {
  const { app } = ctx;
  const now = new Date();

  const events = await fetchEventsForDate(now);
  const ul = el.createEl("ul", { cls: "home-timeline" });

  if (events === null) {
    const notes = filesIn(app, "Events").filter((f) =>
      isSameLocalDay(eventNoteWhen(app, f).date, now),
    );
    if (notes.length === 0) {
      el.createEl("p", { text: "No events today.", cls: "home-widget-empty" });
      return;
    }
    for (const file of notes) {
      const { date, hasTime } = eventNoteWhen(app, file);
      listRow(ctx, ul, file, formatEventNoteWhen(date, hasTime));
    }
    return;
  }

  if (events.length === 0) {
    el.createEl("p", { text: "Nothing on the calendar.", cls: "home-widget-empty" });
    return;
  }

  const hidden = (calendar: string) =>
    ctx.plugin.privateMode &&
    areasForCalendar(app, calendar).some((name) => {
      const file = areaFile(app, name);
      return file ? isFilePrivate(app, file) : false;
    });

  const sorted = [...events].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.startDate.getTime() - b.startDate.getTime(),
  );
  let nowPlaced = false;
  let nextMarked = false;
  for (const event of sorted) {
    if (!event.allDay && !nowPlaced && event.startDate > now) {
      ul.createEl("li", { cls: "home-now", text: `now · ${clock(now)}` });
      nowPlaced = true;
    }
    const li = ul.createEl("li", { cls: "home-event" });
    if (onEvent) {
      li.addClass("is-clickable");
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        onEvent(event, false);
      });
      onMiddleClick(li, () => onEvent(event, true));
    }
    const isLive = !event.allDay && event.startDate <= now && event.endDate > now;
    li.createDiv({ text: event.allDay ? "all day" : clock(event.startDate), cls: "home-event-time" });
    const body = li.createDiv("home-event-body");
    body.createDiv({
      text: hidden(event.calendar) ? redactText(event.title) : event.title,
      cls: "home-event-title",
    });
    const meta: string[] = [event.calendar];
    if (isLive) meta.unshift("happening now");
    if (!event.allDay && !nextMarked && event.startDate > now) {
      meta.unshift(rtf.format(Math.round((event.startDate.getTime() - now.getTime()) / 60_000), "minute"));
      nextMarked = true;
    }
    body.createDiv({ text: meta.join(" · "), cls: "dw-list-meta" });
  }
  if (!nowPlaced) ul.createEl("li", { cls: "home-now", text: `now · ${clock(now)}` });
}

const waiting: HomeWidget = {
  id: "waiting",
  title: `${FOLDER_ICONS["Projects/Waiting For"]} Waiting For`,
  count: (app) => filesIn(app, "Projects/Waiting For").length,
  column: "side",
  render(el, ctx) {
    const files = filesIn(ctx.app, "Projects/Waiting For").sort((a, b) => a.stat.ctime - b.stat.ctime);
    fileList(
      ctx,
      el,
      files,
      (file) => {
        const people = ctx.plugin.privateMode ? [] : links(frontmatter(ctx.app, file).with);
        return [people.join(", "), `waiting since ${ago(file.stat.ctime)}`].filter(Boolean).join(" · ");
      },
      "Nothing pending.",
    );
  },
};

const inbox: HomeWidget = {
  id: "inbox",
  title: `${FOLDER_ICONS.Inbox} Inbox`,
  count: (app) => filesIn(app, "Inbox").length,
  column: "side",
  onTitleClick: (ctx) => void ctx.plugin.activateFolderTriageView("Inbox"),
  render(el, ctx) {
    const files = filesIn(ctx.app, "Inbox").sort((a, b) => b.stat.ctime - a.stat.ctime);
    fileList(ctx, el, files, (file) => ago(file.stat.ctime), "Inbox zero. 🎉");
  },
};

export function renderRecent(el: HTMLElement, ctx: WidgetContext): void {
  const { app } = ctx;
  const skip = (file: TFile) => file.path.startsWith("Days/");
  const opened = app.workspace
    .getLastOpenFiles()
    .map((path) => app.vault.getFileByPath(path))
    .filter((f): f is TFile => f !== null && f.extension === "md" && !skip(f));
  const edited = app.vault
    .getMarkdownFiles()
    .filter((f) => !skip(f))
    .sort((a, b) => b.stat.mtime - a.stat.mtime)
    .slice(0, RECENT_LIMIT);

  const openedPaths = new Set(opened.map((f) => f.path));
  const editedPaths = new Set(edited.map((f) => f.path));
  const merged = [...opened, ...edited.filter((f) => !openedPaths.has(f.path))].slice(0, RECENT_LIMIT);

  if (merged.length === 0) {
    el.createEl("p", { text: "Nothing yet.", cls: "home-widget-empty" });
    return;
  }
  const ul = el.createEl("ul", { cls: "dw-list" });
  for (const file of merged) {
    const marks = `${openedPaths.has(file.path) ? "👁" : ""}${editedPaths.has(file.path) ? "✏️" : ""}`;
    const meta = editedPaths.has(file.path) ? `edited ${ago(file.stat.mtime)}` : "opened recently";
    listRow(ctx, ul, file, `${marks} ${meta}`);
  }
}

const recentEvents: HomeWidget = {
  id: "events",
  title: "🗓️ Recent Events",
  column: "side",
  render(el, ctx) {
    const { app } = ctx;
    const now = Date.now();
    const files = filesIn(app, "Events")
      .map((file) => ({ file, ...eventNoteWhen(app, file) }))
      .filter((e) => e.date.getTime() <= now)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((e) => e.file);
    fileList(
      ctx,
      el,
      files,
      (file) => {
        const { date, hasTime } = eventNoteWhen(app, file);
        const people = ctx.plugin.privateMode ? [] : links(frontmatter(app, file).with);
        return [formatEventNoteWhen(date, hasTime), people.slice(0, 3).join(", ")].filter(Boolean).join(" · ");
      },
      "No past events.",
    );
  },
};

const media: HomeWidget = {
  id: "media",
  title: "🍿 Media",
  count: (app) => activeMedia(app).length,
  column: "main",
  render(el, ctx) {
    const { app } = ctx;
    const media = activeMedia(app).sort(
        (a, b) =>
          MEDIA_ORDER.indexOf(a.type) - MEDIA_ORDER.indexOf(b.type) ||
          a.file.basename.localeCompare(b.file.basename),
      );
    if (media.length === 0) {
      el.createEl("p", { text: "Nothing in progress.", cls: "home-widget-empty" });
      return;
    }
    const row = el.createDiv("home-shelf");
    for (const { file, type } of media) {
      const ratio = MEDIA[type];
      const item = row.createDiv("home-shelf-item");
      item.style.setProperty("--cover-ratio", String(ratio));
      const cover = item.createDiv("home-shelf-frame");
      const src = coverSrc(ctx, file);
      if (src) cover.createEl("img", { cls: "home-shelf-cover", attr: { src, alt: "" } });
      else cover.createDiv({ text: noteBullet(app, file), cls: "home-shelf-cover is-placeholder" });
      const progress = frontmatter(app, file).progress;
      if ((typeof progress === "string" || typeof progress === "number") && !isPrivate(ctx, file)) {
        item.createDiv({ text: String(progress), cls: "home-shelf-progress" });
      }
      item.setAttr("aria-label", title(ctx, file));
      makeOpenable(ctx, item, file);
    }
  },
};

const wins: HomeWidget = {
  id: "wins",
  title: "🏆 Recent Wins",
  column: "side",
  render(el, ctx) {
    const files = filesIn(ctx.app, "Archives")
      .filter((f) => frontmatter(ctx.app, f).type === "project")
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    fileList(ctx, el, files, (file) => ago(file.stat.mtime), "Nothing archived yet.");
  },
};

const rediscover: HomeWidget = {
  id: "rediscover",
  title: `${FOLDER_ICONS["Projects/Someday Maybe"]} Rediscover`,
  count: (app) => filesIn(app, "Projects/Someday Maybe").length,
  column: "main",
  onTitleClick: (ctx) => void ctx.plugin.activateSomedayMaybeView(),
  render(el, ctx) {
    const { app } = ctx;
    const someday = filesIn(app, "Projects/Someday Maybe")
      .filter((f) => !isPrivate(ctx, f))
      .sort((a, b) => a.path.localeCompare(b.path));

    const counts = new Map<string, number>();
    for (const file of someday) {
      const type = frontmatter(app, file).type;
      const key = typeof type === "string" ? type : "other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const chips = el.createDiv("home-chips");
    for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      chips.createSpan({ text: `${count} ${type}`, cls: "home-chip" });
    }

    const list = el.createDiv("home-projects");
    for (const file of seededShuffle(someday, isoDay(new Date())).slice(0, REDISCOVER_PICKS)) {
      const { tags, sub } = projectRow(ctx, list, file);
      sub.setText(`added ${ago(file.stat.ctime)}`);
      const area = firstArea(app, file);
      if (area) tags.createSpan({ text: area, cls: "home-project-area" });
      const type = frontmatter(app, file).type;
      if (typeof type === "string") tags.createSpan({ text: type, cls: "home-project-tag" });
    }
  },
};

const days: HomeWidget = {
  id: "days",
  title: `${FOLDER_ICONS.Days} Days`,
  column: "main",
  onTitleClick: openToday,
  render(el, ctx) {
    const { app } = ctx;
    const byDay = new Map(
      filesIn(app, "Days")
        .filter((f) => dayFileNameRegex.test(f.basename))
        .map((f) => [f.basename, f]),
    );

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (HEATMAP_WEEKS - 1) * 7 - ((start.getDay() + 6) % 7));

    const cells: { key: string; file?: TFile; lines: number }[] = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = isoDay(cursor);
      const file = byDay.get(key);
      cells.push({ key, file, lines: file ? lineCount(app, file) : 0 });
    }

    const sorted = cells.filter((c) => c.file).map((c) => c.lines).sort((a, b) => a - b);
    const quantile = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
    const thresholds = [quantile(0.25), quantile(0.5), quantile(0.75)];

    const weeks = Math.ceil(cells.length / 7);
    const grid = el.createDiv("home-heatmap");
    grid.style.setProperty("--weeks", String(weeks));

    let lastLabelWeek = Number.NEGATIVE_INFINITY;
    for (let week = 0; week < weeks; week++) {
      const days = cells.slice(week * 7, week * 7 + 7);
      const first = days.find((c) => c.key.endsWith("-01")) ?? (week === 0 ? days[0] : undefined);
      if (!first || week - lastLabelWeek < MIN_MONTH_LABEL_GAP) continue;
      const [year, month] = first.key.split("-").map(Number);
      const label = grid.createDiv({
        text: new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short" }),
        cls: "home-heatmap-month",
      });
      label.style.gridColumn = `${week + 2} / span ${MIN_MONTH_LABEL_GAP}`;
      lastLabelWeek = week;
    }

    for (const [row, name] of HEATMAP_DAY_LABELS) {
      const label = grid.createDiv({ text: name, cls: "home-heatmap-day" });
      label.style.gridRow = String(row + 2);
    }

    cells.forEach(({ key, file, lines }, index) => {
      const cell = grid.createDiv("home-heatmap-cell");
      cell.style.gridColumn = String(Math.floor(index / 7) + 2);
      cell.style.gridRow = String((index % 7) + 2);
      cell.setAttr("aria-label", file ? `${key} · ${lines} lines` : key);
      if (!file) return;
      const level = 1 + thresholds.filter((t) => lines > t).length;
      cell.addClass(`is-level-${level}`);
      makeOpenable(ctx, cell, file);
    });
  },
};

const people: HomeWidget = {
  id: "people",
  title: `${FOLDER_ICONS.Relationships} Recent Relationships`,
  column: "main",
  render(el, ctx) {
    const { app } = ctx;
    const now = Date.now();
    const sources = [
      ...filesIn(app, "Days")
        .filter((f) => dayFileNameRegex.test(f.basename))
        .map((file) => ({ file, date: new Date(`${file.basename}T00:00`) })),
      ...filesIn(app, "Events").map((file) => ({ file, date: eventNoteWhen(app, file).date })),
    ]
      .filter((s) => s.date.getTime() <= now)
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const recent: TFile[] = [];
    const seen = new Set<string>();
    for (const { file } of sources) {
      const cache = app.metadataCache.getFileCache(file);
      for (const link of [...(cache?.links ?? []), ...(cache?.frontmatterLinks ?? [])]) {
        const target = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (!target?.path.startsWith("Relationships/") || seen.has(target.path)) continue;
        seen.add(target.path);
        recent.push(target);
      }
      if (recent.length >= RECENT_PEOPLE) break;
    }

    if (recent.length === 0) {
      el.createEl("p", { text: "No relationships in your day notes or events yet.", cls: "home-widget-empty" });
      return;
    }

    const row = el.createDiv("home-shelf home-people");
    for (const person of recent.slice(0, RECENT_PEOPLE)) {
      const item = row.createDiv("home-shelf-item");
      item.style.setProperty("--cover-ratio", "1");
      const src = coverSrc(ctx, person);
      if (src) item.createEl("img", { cls: "home-shelf-cover", attr: { src, alt: "" } });
      else item.createDiv({ text: noteBullet(app, person), cls: "home-shelf-cover is-placeholder" });
      item.createDiv({ text: title(ctx, person), cls: "home-shelf-title" });
      item.setAttr("aria-label", title(ctx, person));
      makeOpenable(ctx, item, person);
    }
  },
};

const listens: HomeWidget = {
  id: "listens",
  title: "🎧 Recent Listens",
  column: "main",
  render(el, ctx) {
    const { app } = ctx;
    const dayNotes = filesIn(app, "Days")
      .filter((f) => dayFileNameRegex.test(f.basename))
      .sort((a, b) => b.basename.localeCompare(a.basename));

    const albums: { album: TFile; day: TFile }[] = [];
    const seen = new Set<string>();
    for (const day of dayNotes) {
      for (const link of [...(app.metadataCache.getFileCache(day)?.links ?? [])].reverse()) {
        const target = app.metadataCache.getFirstLinkpathDest(link.link, day.path);
        if (!target || seen.has(target.path) || frontmatter(app, target).type !== "album") continue;
        seen.add(target.path);
        albums.push({ album: target, day });
      }
      if (albums.length >= RECENT_LISTENS) break;
    }

    if (albums.length === 0) {
      el.createEl("p", { text: "No albums in your day notes yet.", cls: "home-widget-empty" });
      return;
    }

    const row = el.createDiv("home-shelf home-listens");
    for (const { album, day } of albums.slice(0, RECENT_LISTENS)) {
      const item = row.createDiv("home-shelf-item");
      item.style.setProperty("--cover-ratio", "1");
      const src = coverSrc(ctx, album);
      if (src) item.createEl("img", { cls: "home-shelf-cover", attr: { src, alt: "" } });
      else item.createDiv({ text: noteBullet(app, album), cls: "home-shelf-cover is-placeholder" });
      item.setAttr("aria-label", `${title(ctx, album)} · ${formatDayNoteTitle(day.basename)}`);
      makeOpenable(ctx, item, album);
    }
  },
};

export const HOME_WIDGETS: HomeWidget[] = [
  projects,
  listens,
  inbox,
  waiting,
  recentEvents,
  wins,
  people,
  media,
  days,
  rediscover,
];
