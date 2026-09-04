import { type App, TFile } from "obsidian";

/** Bullet shown for a list item whose note has no `icon` frontmatter. */
export const DEFAULT_BULLET = "\u23FA\uFE0F";

/** Bullet for a calendar event that has not been captured as a note yet. */
export const DEFAULT_EVENT_BULLET = "\u{1F535}";

export function normalizeAreasFrontmatter(
  areas: string | string[],
): string[] {
  return typeof areas === "string" ? [areas] : areas;
}

/**
 * The `icon` frontmatter of an area note, when that area exists and declares
 * one. Lets an item with no icon of its own inherit its area's.
 */
export function areaIcon(app: App, areaName: string): string | undefined {
  const file = app.vault.getAbstractFileByPath(`Areas/${areaName}.md`);
  if (!(file instanceof TFile)) return undefined;
  const icon = app.metadataCache.getFileCache(file)?.frontmatter?.icon;
  return typeof icon === "string" && icon.length > 0 ? icon : undefined;
}

/**
 * The bullet a note renders with: its own `icon`, else the icon of the first
 * area it is filed under, else `fallback`. Inheriting the area's icon means an
 * unadorned note still reads as belonging somewhere.
 */
export function noteBullet(
  app: App,
  file: TFile,
  fallback: string = DEFAULT_BULLET,
): string {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const icon = frontmatter?.icon;
  if (typeof icon === "string" && icon.length > 0) return icon;

  const areas = normalizeAreasFrontmatter(frontmatter?.areas ?? []) ?? [];
  const firstArea = areas[0];
  return (
    (firstArea ? areaIcon(app, simplifyWikiLink(firstArea)) : undefined) ??
    fallback
  );
}

export function isFilePrivate(app: App, file: TFile): boolean {
  const metadata = app.metadataCache.getFileCache(file);
  if (metadata?.frontmatter?.private === true) return true;
  const areas = normalizeAreasFrontmatter(metadata?.frontmatter?.areas);
  if (!areas?.length) return false;
  for (const area of areas) {
    const areaName = simplifyWikiLink(area);
    const areaFile = app.vault
      .getFiles()
      .find((f) => f.path === `Areas/${areaName}.md`);
    if (!areaFile) continue;
    const areaMeta = app.metadataCache.getFileCache(areaFile);
    if (areaMeta?.frontmatter?.private === true) return true;
  }
  return false;
}

/**
 * Areas declare which calendars belong to them via a `calendars` frontmatter
 * key, so the mapping lives in the vault rather than in plugin settings:
 *
 *   Areas/Family.md
 *   ---
 *   calendars:
 *     - Josh/Diane
 *   ---
 *
 * Returns the area names owning `calendarName`, matched case-insensitively so
 * a rename that only changes capitalization in Calendar.app still resolves.
 * More than one area may claim the same calendar.
 */
export function areasForCalendar(app: App, calendarName: string): string[] {
  const wanted = calendarName.trim().toLowerCase();
  if (!wanted) return [];

  const matches: string[] = [];
  for (const file of app.vault.getFiles()) {
    if (!file.path.startsWith("Areas/") || file.extension !== "md") continue;

    const calendars = app.metadataCache.getFileCache(file)?.frontmatter
      ?.calendars;
    if (calendars == null) continue;

    const declared = (
      Array.isArray(calendars) ? calendars : [calendars]
    ).filter((entry): entry is string => typeof entry === "string");

    const owns = declared.some(
      (entry) => simplifyWikiLink(entry).toLowerCase() === wanted,
    );
    if (owns) matches.push(file.basename);
  }
  return matches;
}

export function simplifyWikiLink(link: string): string {
  // Strip the [[ ]] wrapper, then drop any alias (everything after the first |)
  // so aliased links like [[Child Note|My Alias]] resolve to their target path.
  return link.replace(/\[\[|\]\]/g, "").split("|")[0].trim();
}

const BLOCK = "\u2588";

export function redactText(original: string): string {
  return original.replace(/\S/g, BLOCK);
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isValidHex(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR.test(v.trim());
}

export function formatDate(timestamp: number): string {
  const formatted = new Date(timestamp).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return formatted.replace(/\s?(AM|PM)$/i, (_, p) => p.toLowerCase());
}

export function formatRelativeDeadline(
  deadline: string | number | Date,
): string | null {
  const dueDay = deadlineToLocalDay(deadline);
  if (!dueDay) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000,
  );

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  return `🏁 ${rtf.format(days, "day")}`;
}

// YAML `deadline: 2026-04-21` (unquoted) is parsed as a JS Date at UTC midnight,
// which falls on the previous local day in timezones west of UTC. Pin to the
// calendar day the user wrote, regardless of timezone.
function deadlineToLocalDay(
  deadline: string | number | Date,
): Date | null {
  if (typeof deadline === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
      );
    }
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    );
  }
  if (deadline instanceof Date) {
    if (Number.isNaN(deadline.getTime())) return null;
    return new Date(
      deadline.getUTCFullYear(),
      deadline.getUTCMonth(),
      deadline.getUTCDate(),
    );
  }
  if (typeof deadline === "number") {
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    );
  }
  return null;
}

/**
 * Notes captured from a calendar event carry `calendar_id`; ones written by
 * hand only declare `type: event` / `type: meeting`. Either marks the note as
 * belonging in the Events section rather than the Inbox.
 */
export function isEventNote(app: App, file: TFile): boolean {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return false;
  if (typeof frontmatter.calendar_id === "string") return true;
  if (frontmatter.type === "event" || frontmatter.type === "meeting") {
    return true;
  }
  // Older meeting notes (Granola imports especially) predate `type`, but
  // attendees plus a timestamp is a meeting either way. `with` alone is not
  // enough -- projects name the people they involve too.
  const attendees = frontmatter.with;
  const hasAttendees = Array.isArray(attendees)
    ? attendees.length > 0
    : typeof attendees === "string" && attendees.length > 0;
  return hasAttendees && frontmatter.when != null;
}

/**
 * When an event note happened, from its `when` frontmatter. Falls back to the
 * file's creation time so a hand-written note with no `when` still sorts.
 * `hasTime` is false for all-day events (`when: 2026-09-04`), which should
 * render without a clock.
 */
export function eventNoteWhen(
  app: App,
  file: TFile,
): { date: Date; hasTime: boolean } {
  const when = app.metadataCache.getFileCache(file)?.frontmatter?.when;
  const parsed = parseEventWhen(when);
  return parsed ?? { date: new Date(file.stat.ctime), hasTime: true };
}

function parseEventWhen(
  when: unknown,
): { date: Date; hasTime: boolean } | null {
  if (typeof when === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when.trim());
    if (dateOnly) {
      return {
        date: new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        ),
        hasTime: false,
      };
    }
    // `2026-09-04T09:30:00` with no offset is parsed as local time, which is
    // how this plugin writes it.
    const parsed = new Date(when);
    return Number.isNaN(parsed.getTime())
      ? null
      : { date: parsed, hasTime: true };
  }
  // Unquoted YAML dates arrive as Date objects pinned to UTC midnight, which
  // is the previous local day west of UTC -- read the UTC fields back out.
  if (when instanceof Date) {
    if (Number.isNaN(when.getTime())) return null;
    const isMidnightUtc =
      when.getUTCHours() === 0 &&
      when.getUTCMinutes() === 0 &&
      when.getUTCSeconds() === 0;
    if (isMidnightUtc) {
      return {
        date: new Date(
          when.getUTCFullYear(),
          when.getUTCMonth(),
          when.getUTCDate(),
        ),
        hasTime: false,
      };
    }
    return { date: when, hasTime: true };
  }
  if (typeof when === "number") {
    const parsed = new Date(when);
    return Number.isNaN(parsed.getTime())
      ? null
      : { date: parsed, hasTime: true };
  }
  return null;
}

/** "Tue, Sep 2" for an all-day event, "Tue, Sep 2 · 9:30am" otherwise. */
export function formatEventNoteWhen(date: Date, hasTime: boolean): string {
  const day = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    // Only worth the space once the event is outside the current year.
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  if (!hasTime) return day;
  const time = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s?(AM|PM)$/i, (_, p) => p.toLowerCase());
  return `${day} · ${time}`;
}

/** Whether two dates land on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
