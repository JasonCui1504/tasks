import type { Trip } from "./types";

// Upcoming trips come from travel.jascui.com's read-only feed — the same one
// Llamabear uses. It returns only trip names and dates, authenticated by the
// shared TRAVEL_FEED_SECRET. Nothing is ever written back to the travel app.

const TRAVEL_ORIGIN = (process.env.TRAVEL_ORIGIN || "https://travel.jascui.com").replace(/\/$/, "");
const TTL_MS = 5 * 60_000;

let cache: { at: number; trips: Trip[] } | null = null;

export function travelConfigured(): boolean {
  return Boolean(process.env.TRAVEL_FEED_SECRET);
}

type FeedTrip = { id: number; name: string; start_date: string; end_date: string };

/** Trips that haven't ended yet, soonest first. Empty when the feed isn't configured or is down. */
export async function getTrips(): Promise<Trip[]> {
  const secret = process.env.TRAVEL_FEED_SECRET;
  if (!secret) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.trips;
  try {
    const res = await fetch(`${TRAVEL_ORIGIN}/api/feed`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`travel feed ${res.status}`);
    const data = (await res.json()) as { trips?: FeedTrip[] };
    const today = new Date().toISOString().slice(0, 10);
    const trips = (data.trips ?? [])
      .filter((t) => t.end_date >= today)
      .map((t) => ({
        id: t.id,
        name: t.name,
        startDate: t.start_date,
        endDate: t.end_date,
        url: `${TRAVEL_ORIGIN}/trips/${t.id}`,
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    cache = { at: Date.now(), trips };
    return trips;
  } catch (err) {
    console.warn("Couldn't load trips from the travel app", err);
    return cache?.trips ?? [];
  }
}

export const TRAVEL_URL = TRAVEL_ORIGIN;
