import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getDb } from "./db";
import { parseIcs, type IcsEvent, type IcsTime } from "./ics";
import { getSettings } from "./tasks";
import { localDateKey, zonedParts } from "./time";
import { getTrips, TRAVEL_URL } from "./travel";
import type { ItineraryItem, TripItinerary } from "./types";

// Trip itineraries for the Day view, read from travel.jascui.com while signed
// in there as the owner: each trip's calendar feed (/api/trips/<id>/calendar.ics,
// the one "Add to calendar" uses) accepts the travel app's own session. The
// travel app is only read, never changed. The owner connects once with their
// travel username and password; the session is kept in travel_link and renewed
// with the (encrypted) password when it expires.

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; items: ItineraryItem[]; tz: string }>();

const STATUSES = ["Booked", "Not booked", "Transit", "Booking unnecessary"];

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

// ---- the travel sign-in ----

function key(): Buffer {
  return createHash("sha256").update(`travel-link:${process.env.TASKS_SESSION_SECRET ?? ""}`).digest();
}

function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

function unseal(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Seconds left on a travel session token ("user:expires:sig"). */
function secondsLeft(token: string): number {
  const exp = Number(token.split(":")[1]);
  return Number.isFinite(exp) ? exp - Date.now() / 1000 : -1;
}

/** Sign in to the travel app; returns its session token. Throws a readable message. */
async function travelLogin(username: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${TRAVEL_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw "Couldn't reach travel.jascui.com. Try again in a moment.";
  }
  if (res.status === 401) throw "travel.jascui.com didn't accept that username and password.";
  if (res.status === 429) throw "Too many sign-in attempts on travel.jascui.com — wait 15 minutes.";
  if (!res.ok) throw `travel.jascui.com answered ${res.status}.`;
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("travel_session="));
  const token = cookie?.slice("travel_session=".length).split(";")[0];
  if (!token) throw "travel.jascui.com didn't start a session.";
  return token;
}

type Link = { username: string; secret: string; session: string };

async function getLink(owner: string): Promise<Link | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT username, secret, session FROM travel_link WHERE owner = ?", args: [owner] });
  return rs.rows.length ? { username: String(rs.rows[0].username), secret: String(rs.rows[0].secret), session: String(rs.rows[0].session) } : null;
}

/** A working session, renewed with the saved password when it's within a day of expiring (or `force`). */
async function session(owner: string, link: Link, force = false): Promise<string> {
  if (!force && secondsLeft(link.session) > 86_400) return link.session;
  const password = unseal(link.secret);
  if (!password) throw "Sign in to travel.jascui.com again.";
  const fresh = await travelLogin(link.username, password);
  const db = await getDb();
  await db.execute({ sql: "UPDATE travel_link SET session = ?, updated_at = ? WHERE owner = ?", args: [fresh, new Date().toISOString(), owner] });
  link.session = fresh;
  return fresh;
}

export async function connectTravel(owner: string, username: string, password: string): Promise<void> {
  const user = username.trim().toLowerCase();
  if (!user || !password) throw "Enter your travel.jascui.com username and password.";
  const token = await travelLogin(user, password);
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO travel_link (owner, username, secret, session, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner) DO UPDATE SET username = excluded.username, secret = excluded.secret,
            session = excluded.session, updated_at = excluded.updated_at`,
    args: [owner, user, seal(password), token, new Date().toISOString()],
  });
  for (const k of cache.keys()) if (k.startsWith(`${owner}|`)) cache.delete(k);
}

export async function disconnectTravel(owner: string): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM travel_link WHERE owner = ?", args: [owner] });
  for (const k of cache.keys()) if (k.startsWith(`${owner}|`)) cache.delete(k);
}

// ---- reading itineraries ----

function fetchCalendar(tripId: number, token: string): Promise<Response> {
  return fetch(`${TRAVEL_URL}/api/trips/${tripId}/calendar.ics`, {
    headers: { Cookie: `travel_session=${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function readTrip(owner: string, link: Link, tripId: number, viewerTz: string): Promise<{ items: ItineraryItem[]; tz: string }> {
  const cacheKey = `${owner}|${viewerTz}|${tripId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let res = await fetchCalendar(tripId, await session(owner, link));
  // The travel app answers 404 when it doesn't accept the session: renew once and retry.
  if (res.status === 404) res = await fetchCalendar(tripId, await session(owner, link, true));
  if (!res.ok) throw `travel.jascui.com answered ${res.status}.`;
  const text = await res.text();
  if (!text.includes("BEGIN:VCALENDAR")) throw "travel.jascui.com didn't return a calendar.";
  const cal = parseIcs(text);
  const value = { at: Date.now(), items: toItems(cal.events, cal.timeZone, viewerTz), tz: cal.timeZone };
  cache.set(cacheKey, value);
  return value;
}

export type TravelStatus = { connected: boolean; username: string; error?: string };

/** Every current/upcoming trip's itinerary, and whether the travel sign-in is set up. */
export async function listItineraries(owner: string): Promise<{ status: TravelStatus; itineraries: TripItinerary[] }> {
  const link = await getLink(owner);
  if (!link) return { status: { connected: false, username: "" }, itineraries: [] };
  const [trips, settings] = await Promise.all([getTrips(), getSettings(owner)]);
  const itineraries: TripItinerary[] = [];
  let error: string | undefined;
  for (const trip of trips) {
    try {
      const { items, tz } = await readTrip(owner, link, trip.id, settings.timeZone);
      itineraries.push({ id: trip.id, time_zone: tz, url: trip.url, items });
    } catch (err) {
      error = typeof err === "string" ? err : "Couldn't read itineraries from travel.jascui.com.";
      break; // the same problem would repeat for every trip
    }
  }
  return { status: { connected: true, username: link.username, error }, itineraries };
}
