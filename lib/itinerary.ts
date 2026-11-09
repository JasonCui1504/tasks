import { getDb } from "./db";
import { parseIcs, type IcsEvent, type IcsTime } from "./ics";
import { localDateKey, zonedParts } from "./time";
import { getSettings } from "./tasks";
import { TRAVEL_URL } from "./travel";
import type { ItineraryItem, TripItinerary } from "./types";

// Trip itineraries for the Day view, read from each trip's calendar link on
// travel.jascui.com (trip page → menu → Add to calendar). That link is the
// travel app's own read-only calendar feed, so nothing changes there; we only
// fetch it. Links are saved per trip in trip_calendars.

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; items: ItineraryItem[]; tz: string }>();

const STATUSES = ["Booked", "Not booked", "Transit", "Booking unnecessary"];

/**
 * Accepts the link as copied (webcal://… or https://…) and returns its https
 * form and trip id. Only the travel app's own calendar links are allowed.
 */
export function normaliseCalendarLink(raw: string): { url: string; tripId: number } {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));
  } catch {
    throw "That doesn't look like a link.";
  }
  const travelHost = new URL(TRAVEL_URL).host;
  const m = /^\/api\/(?:travel\/)?trips\/(\d+)\/calendar\.ics$/.exec(u.pathname);
  if (u.host !== travelHost || !m || !u.searchParams.get("token")) {
    throw `Paste the trip's calendar link from ${travelHost} (trip page → menu → Add to calendar → copy the Apple Calendar link).`;
  }
  const url = `${TRAVEL_URL.startsWith("http://") ? "http" : "https"}://${u.host}${u.pathname}?token=${encodeURIComponent(u.searchParams.get("token")!)}`;
  return { url, tripId: Number(m[1]) };
}

function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A time as a date + hour on the trip's clock. */
function onTripClock(t: IcsTime, tz: string): { date: string; hour?: number } {
  if (t.kind === "date") return { date: t.date };
  if (t.kind === "local") {
    if (!t.tz || t.tz === tz || !tz) return { date: t.date, hour: t.hour };
    // A time pinned to another zone: convert through UTC.
    const guess = new Date(`${t.date}T${String(Math.floor(t.hour)).padStart(2, "0")}:${String(Math.round((t.hour % 1) * 60)).padStart(2, "0")}:00Z`);
    const off = zonedParts(guess, t.tz);
    const shift = Date.UTC(off.y, off.m - 1, off.d, off.h, off.mi) - guess.getTime();
    return onTripClock({ kind: "utc", iso: new Date(guess.getTime() - shift).toISOString() }, tz);
  }
  const d = new Date(t.iso);
  const zone = tz || "UTC";
  const p = zonedParts(d, zone);
  return { date: localDateKey(d, zone), hour: p.h + p.mi / 60 };
}

/** Events go on the trip's clock; flights (exact instants) on the viewer's, since you're usually at the departure end when you look. */
function toItems(events: IcsEvent[], tz: string, viewerTz: string): ItineraryItem[] {
  const items: ItineraryItem[] = [];
  const seenFlights = new Set<string>();
  for (const e of events) {
    const uid = e.uid.split("@")[0];
    const kind: ItineraryItem["kind"] = uid.startsWith("flight-")
      ? "flight"
      : uid.startsWith("stay-")
        ? "stay"
        : uid.startsWith("car-cancel") || uid.startsWith("cancel-")
          ? "deadline"
          : uid.startsWith("car-")
            ? "car"
            : "event";
    const lines = e.description.split("\n").map((l) => l.trim()).filter(Boolean);
    const status = lines[0] && STATUSES.includes(lines[0]) ? lines.shift()! : "";
    let title = e.summary;

    if (kind === "flight") {
      // One entry per traveller: show each flight once, without the traveller's name.
      title = title.replace(/^✈\s*[^:]*:\s*/, "✈ ");
      const key = `${title}|${e.start.kind === "utc" ? e.start.iso : ""}`;
      if (seenFlights.has(key)) continue;
      seenFlights.add(key);
    }

    if (e.start.kind === "date") {
      // All-day: one item per day it covers (DTEND is exclusive).
      const last = e.end?.kind === "date" ? addDays(e.end.date, -1) : e.start.date;
      for (let d = e.start.date, i = 0; d <= last && i < 60; d = addDays(d, 1), i++) {
        items.push({ kind, title, location: e.location, details: lines, status, date: d });
      }
      continue;
    }
    const clockTz = kind === "flight" ? viewerTz : tz;
    const start = onTripClock(e.start, clockTz);
    const end = e.end ? onTripClock(e.end, clockTz) : null;
    let endHour = (start.hour ?? 0) + 1;
    if (end?.hour != null) endHour = end.hour + (end.date > start.date ? 24 * Math.round((Date.parse(end.date) - Date.parse(start.date)) / 86_400_000) : 0);
    items.push({ kind, title, location: e.location, details: lines, status, date: start.date, start_hour: start.hour, end_hour: endHour });
  }
  return items;
}

async function readCalendar(url: string, viewerTz: string): Promise<{ items: ItineraryItem[]; tz: string }> {
  const hit = cache.get(`${viewerTz}|${url}`);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw res.status === 404 ? "The travel app no longer accepts this link — copy it again from the trip page." : `The travel app answered ${res.status}.`;
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw "That link didn't return a calendar.";
  const cal = parseIcs(text);
  const value = { at: Date.now(), items: toItems(cal.events, cal.timeZone, viewerTz), tz: cal.timeZone };
  cache.set(`${viewerTz}|${url}`, value);
  return value;
}

export async function listItineraries(owner: string): Promise<TripItinerary[]> {
  const db = await getDb();
  const [rs, settings] = await Promise.all([
    db.execute({ sql: "SELECT trip_id, url FROM trip_calendars WHERE owner = ? ORDER BY trip_id", args: [owner] }),
    getSettings(owner),
  ]);
  return Promise.all(
    rs.rows.map(async (r) => {
      const id = Number(r.trip_id);
      const url = String(r.url);
      try {
        const { items, tz } = await readCalendar(url, settings.timeZone);
        return { id, time_zone: tz, url, items };
      } catch (err) {
        return { id, time_zone: "", url, items: [], error: typeof err === "string" ? err : "Couldn't reach the travel app." };
      }
    }),
  );
}

/** Save a trip's calendar link after checking that it works. */
export async function saveCalendarLink(owner: string, raw: string): Promise<TripItinerary> {
  const { url, tripId } = normaliseCalendarLink(raw);
  const viewerTz = (await getSettings(owner)).timeZone;
  cache.delete(`${viewerTz}|${url}`);
  const { items, tz } = await readCalendar(url, viewerTz);
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO trip_calendars (owner, trip_id, url) VALUES (?, ?, ?)
          ON CONFLICT(owner, trip_id) DO UPDATE SET url = excluded.url`,
    args: [owner, tripId, url],
  });
  return { id: tripId, time_zone: tz, url, items };
}

export async function removeCalendarLink(owner: string, tripId: number): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM trip_calendars WHERE owner = ? AND trip_id = ?", args: [owner, tripId] });
}
