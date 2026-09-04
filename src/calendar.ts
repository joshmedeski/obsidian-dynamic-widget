import { execFile } from "node:child_process";

const ICAL_BINARY = "/Users/joshmedeski/go/bin/ical";
const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 30_000;

export type CalendarAttendee = {
  name: string;
  email: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  calendar: string;
  location?: string;
  status?: string;
  availability?: string;
  notes?: string;
  attendees?: CalendarAttendee[];
  organizer?: string;
};

type IcalEventJson = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  calendar: string;
  location?: string;
  status?: string;
  availability?: string;
  notes?: string;
  attendees?: CalendarAttendee[];
  organizer?: string;
};

type CacheEntry = {
  events: CalendarEvent[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function runIcal(from: string, to: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      ICAL_BINARY,
      ["list", "--from", from, "--to", to, "--output", "json"],
      { timeout: FETCH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseEvents(stdout: string): CalendarEvent[] {
  const raw = stdout.trim();
  if (!raw) return [];

  let json: IcalEventJson[];
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(json)) return [];

  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  for (const ev of json) {
    if (ev.status === "canceled") continue;
    if (ev.calendar === "Birthdays") continue;

    const dedupeKey = `${ev.title}|${ev.start_date}|${ev.all_day ? "d" : "t"}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    events.push({
      id: ev.id,
      title: ev.title,
      startDate: new Date(ev.start_date),
      endDate: new Date(ev.end_date),
      allDay: ev.all_day,
      calendar: ev.calendar,
      location: ev.location,
      status: ev.status,
      availability: ev.availability,
      notes: ev.notes,
      attendees: ev.attendees,
      organizer: ev.organizer,
    });
  }

  events.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.startDate.getTime() - b.startDate.getTime();
  });

  return events;
}

export async function fetchEventsForDate(
  date: Date,
): Promise<CalendarEvent[] | null> {
  if (process.platform !== "darwin") return null;

  const key = formatDate(date);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.events;
  }

  try {
    const stdout = await runIcal(key, key);
    const events = parseEvents(stdout);
    cache.set(key, { events, expiresAt: now + CACHE_TTL_MS });
    return events;
  } catch {
    return null;
  }
}

export function clearCalendarCache(): void {
  cache.clear();
}
