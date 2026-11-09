"use client";

import { daysBetween, formatDateKey, localDateKey } from "@/lib/time";
import type { ItineraryItem } from "@/lib/types";
import type { Actions, Data } from "./shared";
import { TravelConnect } from "./TravelConnect";

// Two read-only views of the trip itineraries already loaded from
// travel.jascui.com (see lib/itinerary.ts):
// - Tracking: what's booked and coming up — flights, trains and other transit,
//   hotels, rental cars, and free-cancellation deadlines.
// - Still to book: everything marked "Not booked" on the travel app, grouped by
//   trip, like its own "Still to book" list.
// Rows pick that day for the Day view (and open the Calendar tab on a phone).

type Row = {
  key: string;
  icon: string;
  title: string;
  /** Second line: flight times, cancellation terms, location. */
  sub: string;
  date: string;
  /** Last day, for stays and cars spanning several days. */
  to: string;
  hour?: number;
  /** Flights print their local departure time in `sub`, so the date alone is shown. */
  dateOnly?: boolean;
  /** Cancellation deadlines are coloured by how close they are. */
  deadline?: boolean;
};

type Group = { tripId: number; name: string; url: string; rows: Row[] };

function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hourLabel(h: number) {
  const min = Math.round(h * 60) % (24 * 60);
  const hh = Math.floor(min / 60);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(min % 60).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

function shortDate(key: string) {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

function transitIcon(title: string) {
  if (/train|rail|amtrak|eurostar|shinkansen|metro|subway|tgv|ice\b/i.test(title)) return "🚆";
  if (/ferry|boat|cruise/i.test(title)) return "⛴";
  if (/bus|coach|shuttle/i.test(title)) return "🚌";
  if (/transfer|taxi|uber|lyft|car service|pick ?up/i.test(title)) return "🚐";
  return "🚉";
}

/** Notes worth a second line: flight times, cancellation terms, else the location. */
function subLine(i: ItineraryItem) {
  const pick = i.details.find((d) => /^Departs |^Free cancellation until|^Non-refundable/.test(d));
  if (!pick) return i.location;
  return pick.replace(/\d{4}-\d{2}-\d{2}/, (d) => formatDateKey(d));
}

/** Turns per-day all-day items back into one row per booking (consecutive days with the same title). */
function toRows(items: ItineraryItem[], tripId: number): Row[] {
  const rows: Row[] = [];
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.start_hour ?? -1) - (b.start_hour ?? -1));
  for (const i of sorted) {
    const allDay = i.start_hour == null;
    const prev = rows.find((r) => allDay && r.hour == null && r.title === stripTitle(i) && addDays(r.to, 1) === i.date);
    if (prev) {
      prev.to = i.date;
      continue;
    }
    rows.push({
      key: `${tripId}|${i.kind}|${i.date}|${i.start_hour ?? ""}|${i.title}`,
      icon:
        i.kind === "flight" ? "✈️"
        : i.kind === "stay" ? "🏨"
        : i.kind === "car" ? "🚗"
        : i.kind === "deadline" ? "⏳"
        : i.status === "Transit" ? transitIcon(i.title)
        : "🎟",
      title: stripTitle(i),
      sub: subLine(i),
      date: i.date,
      to: i.date,
      hour: i.start_hour,
      deadline: i.kind === "deadline",
      dateOnly: i.kind === "flight" && /^Departs /.test(subLine(i)),
    });
  }
  return rows;
}

function stripTitle(i: ItineraryItem) {
  return i.title
    .replace(/^✈\s*/, "")
    .replace(/^(Stay|Rental car):\s*/, "")
    .replace(/^Last day to cancel free:\s*/, "Free cancellation ends: ");
}

function groups(data: Data, keep: (i: ItineraryItem) => boolean): Group[] {
  const today = localDateKey(data.now, data.tz);
  const out: Group[] = [];
  for (const it of data.itineraries) {
    const trip = data.trips.find((t) => t.id === it.id);
    const rows = toRows(it.items.filter(keep), it.id).filter((r) => r.to >= today);
    if (rows.length) out.push({ tripId: it.id, name: trip?.name ?? "Trip", url: it.url, rows });
  }
  return out;
}

const isTracked = (i: ItineraryItem) =>
  i.kind === "flight" || i.kind === "stay" || i.kind === "car" || i.kind === "deadline" || i.status === "Transit";

const isUnbooked = (i: ItineraryItem) => i.status === "Not booked";

const notReady = (data: Data) => !data.travelConfigured || !data.travelLink.connected || Boolean(data.travelLink.error);

/** Shown instead of a list until itineraries can be read. */
function Gate({ data, actions }: { data: Data; actions: Actions }) {
  if (!data.travelConfigured) return <p className="muted small panel-empty">Trips come from travel.jascui.com. Set TRAVEL_FEED_SECRET to connect it.</p>;
  return (
    <div className="panel-empty">
      <TravelConnect data={data} actions={actions} />
    </div>
  );
}

function TripGroups({ list, actions, today }: { list: Group[]; actions: Actions; today: string }) {
  function pick(date: string) {
    actions.selectDay(date < today ? today : date);
    actions.goTab("calendar");
  }
  return (
    <div className="trk">
      {list.map((g) => (
        <section key={g.tripId} className="trk-group">
          <a className="trk-trip" href={g.url} target="_blank" rel="noreferrer">
            {g.name} →
          </a>
          <ul className="plain-list">
            {g.rows.map((r) => {
              const days = daysBetween(today, r.date);
              const tone = r.deadline ? (days <= 3 ? "danger" : days <= 7 ? "warn" : "") : "";
              const when =
                r.to !== r.date
                  ? r.date < today
                    ? `Until ${shortDate(r.to)}`
                    : `${shortDate(r.date)} – ${shortDate(r.to)}`
                  : `${formatDateKey(r.date)}${r.hour != null && !r.dateOnly ? `, ${hourLabel(r.hour)}` : ""}`;
              const rel = r.date <= today ? (r.to !== r.date && r.date < today ? "Now" : "Today") : days === 1 ? "Tomorrow" : `In ${days}d`;
              return (
                <li key={r.key}>
                  <button className="trk-row" onClick={() => pick(r.date)} title="Show this day">
                    <span className="trk-icon" aria-hidden>
                      {r.icon}
                    </span>
                    <span className="trk-main">
                      <span className="trk-title">{r.title}</span>
                      {r.sub && <span className="trk-sub">{r.sub}</span>}
                    </span>
                    <span className={`trk-when ${tone}`}>
                      <span>{when}</span>
                      <span className="trk-rel">{rel}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Booked travel coming up: flights, trains, hotels, rental cars and cancellation deadlines. */
export function TrackingView({ data, actions }: { data: Data; actions: Actions }) {
  if (notReady(data)) return <Gate data={data} actions={actions} />;
  const today = localDateKey(data.now, data.tz);
  const list = groups(data, isTracked);
  if (!list.length) return <p className="muted small panel-empty">No flights, trains, stays or cancellation deadlines coming up.</p>;
  return <TripGroups list={list} actions={actions} today={today} />;
}

/** Everything marked "Not booked" on upcoming trips. */
export function ToBookView({ data, actions }: { data: Data; actions: Actions }) {
  if (notReady(data)) return <Gate data={data} actions={actions} />;
  const today = localDateKey(data.now, data.tz);
  const list = groups(data, isUnbooked);
  const total = list.reduce((s, g) => s + g.rows.length, 0);
  if (!total) return <p className="muted small panel-empty">All booked — nothing marked “Not booked” on upcoming trips.</p>;
  return (
    <>
      <p className="panel-summary">
        <strong>{total}</strong> still to book
      </p>
      <TripGroups list={list} actions={actions} today={today} />
    </>
  );
}
