"use client";

import { daysBetween, formatDateKey, localDateKey } from "@/lib/time";
import { bookingKind, type Booking, type ItineraryItem } from "@/lib/types";
import type { Actions, Data } from "./shared";
import { TravelConnect } from "./TravelConnect";

// Tracking: every flight, train, rental car, hotel and free-cancellation
// deadline coming up, in one list grouped by trip. Two sources, merged:
// - bookings entered here (the bookings table; click one to edit it), and
// - the trip itineraries read from travel.jascui.com (read-only; click one to
//   see that day). A flight on both shows once, as the one entered here.
// Still to book: bookings entered here as "Still to book", plus everything
// marked "Not booked" on travel.jascui.com.

type Row = {
  key: string;
  /** Small text label in front: FLIGHT, TRAIN, HOTEL… */
  tag: string;
  title: string;
  /** Second line: times, places, confirmation, cancellation terms. */
  sub: string;
  date: string;
  /** Last day, for stays and cars spanning several days. */
  to: string;
  /** Time shown next to the date, "5:05 PM", or "". */
  time: string;
  /** The date that decides which trip it's grouped under (a deadline goes with its booking). */
  anchor: string;
  /** Sorts rows on the same day. */
  sortHour: number;
  deadline?: boolean;
  booking?: Booking;
  /** Set for travel.jascui.com rows (read-only). */
  fromTravel?: boolean;
  tripId: number | null;
};

type Group = { key: string; name: string; url: string; rows: Row[] };

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

const timeLabel = (hhmm: string) => (hhmm ? hourLabel(Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5)) / 60) : "");
const toHour = (hhmm: string) => (hhmm ? Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5)) / 60 : -1);

function shortDate(key: string) {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

const normNumber = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

// ---- rows from bookings entered here ----

function bookingRows(b: Booking): Row[] {
  const k = bookingKind(b.kind);
  const travel = b.kind === "flight" || b.kind === "train" || b.kind === "bus";
  const route = b.from && b.to ? `${b.from} → ${b.to}` : "";
  const title = travel
    ? join(b.number || b.name, route) || k.label
    : b.name || b.number || k.label;
  const nextDay = b.endDate && b.endDate > b.startDate;
  const times = travel
    ? join(
        b.number && b.name,
        b.endTime && `Arrives ${timeLabel(b.endTime)}${nextDay ? ` (${shortDate(b.endDate!)})` : ""}`,
      )
    : b.kind === "hotel"
      ? join(b.from, b.startTime && `Check in ${timeLabel(b.startTime)}`, b.endTime && `out ${timeLabel(b.endTime)}`)
      : b.kind === "car"
        ? join(b.from, b.to && b.to !== b.from && `return to ${b.to}`, b.number)
        : join(b.from, b.number && b.name ? b.number : "");
  const sub = join(times, b.confirmation && `Conf. ${b.confirmation}`, !b.cancelBy ? "" : `Free cancellation until ${formatDateKey(b.cancelBy)}`);
  const multiDay = !travel && b.endDate && b.endDate > b.startDate;
  // A hotel's check-out day isn't a night there.
  const to = multiDay ? (b.kind === "hotel" ? addDays(b.endDate!, -1) : b.endDate!) : b.startDate;
  const rows: Row[] = [
    {
      key: `b${b.id}`,
      tag: b.kind === "car" ? "Car" : b.kind === "bus" ? "Bus" : k.label,
      title,
      sub,
      date: b.startDate,
      to: to < b.startDate ? b.startDate : to,
      anchor: b.startDate,
      time: multiDay ? "" : timeLabel(b.startTime),
      sortHour: toHour(b.startTime),
      booking: b,
      tripId: b.tripId,
    },
  ];
  if (b.cancelBy && b.status === "booked") {
    rows.push({
      key: `b${b.id}-cancel`,
      tag: "Cancel by",
      title: `Free cancellation ends: ${b.name || title}`,
      sub: "",
      date: b.cancelBy,
      to: b.cancelBy,
      anchor: b.startDate,
      time: "",
      sortHour: -2,
      deadline: true,
      booking: b,
      tripId: b.tripId,
    });
  }
  return rows;
}

// ---- rows from travel.jascui.com itineraries ----

function transitTag(title: string) {
  if (/train|rail|amtrak|eurostar|shinkansen|tgv/i.test(title)) return "Train";
  if (/ferry|boat|cruise/i.test(title)) return "Ferry";
  if (/bus|coach|shuttle/i.test(title)) return "Bus";
  if (/transfer|taxi|uber|lyft|car service|pick ?up/i.test(title)) return "Transfer";
  return "Transit";
}

function stripTitle(i: ItineraryItem) {
  return i.title
    .replace(/^✈\s*/, "")
    .replace(/^(Stay|Rental car):\s*/, "")
    .replace(/^Last day to cancel free:\s*/, "Free cancellation ends: ");
}

/** Flight times, cancellation terms, else the location; dates printed nicely. */
function travelSub(i: ItineraryItem) {
  const pick = i.details.find((d) => /^Departs |^Free cancellation until|^Non-refundable/.test(d)) ?? i.location;
  return pick.replace(/\d{4}-\d{2}-\d{2}/, (d) => formatDateKey(d));
}

/** One row per booking: per-day all-day items (stays, cars) are joined back together. */
function travelRows(items: ItineraryItem[], tripId: number): Row[] {
  const rows: Row[] = [];
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.start_hour ?? -1) - (b.start_hour ?? -1));
  for (const i of sorted) {
    const allDay = i.start_hour == null;
    const title = stripTitle(i);
    const prev = allDay ? rows.find((r) => r.time === "" && r.sortHour === -1 && r.title === title && addDays(r.to, 1) === i.date) : undefined;
    if (prev) {
      prev.to = i.date;
      continue;
    }
    const sub = travelSub(i);
    rows.push({
      key: `t${tripId}|${i.kind}|${i.date}|${i.start_hour ?? ""}|${i.title}`,
      tag:
        i.kind === "flight" ? "Flight"
        : i.kind === "stay" ? "Hotel"
        : i.kind === "car" ? "Car"
        : i.kind === "deadline" ? "Cancel by"
        : i.status === "Transit" ? transitTag(i.title)
        : "Plan",
      title,
      sub,
      date: i.date,
      to: i.date,
      anchor: i.date,
      // Flights print their local departure time in `sub`; the hour here is on the viewer's clock.
      time: i.start_hour == null || (i.kind === "flight" && sub.startsWith("Departs")) ? "" : hourLabel(i.start_hour),
      sortHour: i.start_hour ?? (i.kind === "deadline" ? -2 : -1),
      deadline: i.kind === "deadline",
      fromTravel: true,
      tripId,
    });
  }
  return rows;
}

const isTracked = (i: ItineraryItem) =>
  i.kind === "flight" || i.kind === "stay" || i.kind === "car" || i.kind === "deadline" || i.status === "Transit";

const isUnbooked = (i: ItineraryItem) => i.status === "Not booked";

/** Rows grouped by trip (by the booking's trip, else the trip its date falls in), soonest first. */
function groupRows(data: Data, rows: Row[]): Group[] {
  const today = localDateKey(data.now, data.tz);
  const groups = new Map<string, Group>();
  for (const r of rows.filter((r) => r.to >= today)) {
    const trip =
      data.trips.find((t) => t.id === r.tripId) ??
      (r.booking && r.tripId == null ? data.trips.find((t) => r.anchor >= t.startDate && r.anchor <= t.endDate) : undefined);
    const key = trip ? `trip${trip.id}` : "other";
    if (!groups.has(key)) groups.set(key, { key, name: trip?.name ?? "Other travel", url: trip?.url ?? "", rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const list = [...groups.values()];
  for (const g of list) g.rows.sort((a, b) => a.date.localeCompare(b.date) || a.sortHour - b.sortHour);
  return list.sort((a, b) => a.rows[0].date.localeCompare(b.rows[0].date));
}

function trackingRows(data: Data): Row[] {
  const mine = data.bookings.filter((b) => b.status === "booked").flatMap(bookingRows);
  // A flight entered here and on the travel site shows once.
  const mineFlights = new Set(
    data.bookings.filter((b) => b.kind === "flight" && b.number).map((b) => `${normNumber(b.number)}|${b.startDate}`),
  );
  const travel = data.itineraries.flatMap((it) =>
    travelRows(it.items.filter(isTracked), it.id).filter((r) => {
      const no = r.tag === "Flight" ? /\(([^)]+)\)\s*$/.exec(r.title)?.[1] : undefined;
      return !(no && [r.date, addDays(r.date, -1), addDays(r.date, 1)].some((d) => mineFlights.has(`${normNumber(no)}|${d}`)));
    }),
  );
  return [...mine, ...travel];
}

function toBookRows(data: Data): Row[] {
  const mine = data.bookings.filter((b) => b.status === "to_book").map((b) => bookingRows(b)[0]);
  const travel = data.itineraries.flatMap((it) => travelRows(it.items.filter(isUnbooked), it.id));
  return [...mine, ...travel];
}

// ---- views ----

function TravelNote({ data, actions }: { data: Data; actions: Actions }) {
  if (!data.travelConfigured) return null;
  return <TravelConnect data={data} actions={actions} compact />;
}

function TripGroups({ list, actions, today }: { list: Group[]; actions: Actions; today: string }) {
  function open(r: Row) {
    if (r.booking) return actions.openBooking(r.booking);
    actions.selectDay(r.date < today ? today : r.date);
    actions.goTab("calendar");
  }
  return (
    <div className="trk">
      {list.map((g) => (
        <section key={g.key} className="trk-group">
          {g.url ? (
            <a className="trk-trip" href={g.url} target="_blank" rel="noreferrer">
              {g.name} →
            </a>
          ) : (
            <span className="trk-trip">{g.name}</span>
          )}
          <ul className="plain-list">
            {g.rows.map((r) => {
              const days = daysBetween(today, r.date);
              const tone = r.deadline ? (days <= 2 ? "danger" : days <= 7 ? "warn" : "") : "";
              const when =
                r.to !== r.date
                  ? r.date < today
                    ? `Until ${shortDate(r.to)}`
                    : `${shortDate(r.date)} – ${shortDate(r.to)}`
                  : `${formatDateKey(r.date)}${r.time ? `, ${r.time}` : ""}`;
              const rel = r.date <= today ? (r.to !== r.date && r.date < today ? "Now" : "Today") : days === 1 ? "Tomorrow" : `In ${days}d`;
              return (
                <li key={r.key}>
                  <button className="trk-row" onClick={() => open(r)} title={r.booking ? "Edit" : "From travel.jascui.com — show this day"}>
                    <span className={`trk-tag ${r.deadline ? "deadline" : ""}`}>{r.tag}</span>
                    <span className="trk-main">
                      <span className="trk-title">{r.title}</span>
                      {r.sub && <span className="trk-sub">{r.sub}</span>}
                    </span>
                    <span className={`trk-when ${tone}`}>
                      <span>{when}</span>
                      <span className="trk-rel">
                        {rel}
                        {r.fromTravel && " · travel site"}
                      </span>
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

function AddBooking({ actions, status }: { actions: Actions; status?: Booking["status"] }) {
  return (
    <div className="trk-add">
      {(["flight", "train", "car", "hotel"] as const).map((kind) => (
        <button key={kind} className="chip" onClick={() => actions.newBooking({ kind, status })}>
          + {bookingKind(kind).label}
        </button>
      ))}
      <button className="chip" onClick={() => actions.newBooking({ kind: "other", status })}>
        + Other
      </button>
    </div>
  );
}

/** Flights, trains, rental cars, hotels and cancellation deadlines coming up. */
export function TrackingView({ data, actions }: { data: Data; actions: Actions }) {
  const today = localDateKey(data.now, data.tz);
  const list = groupRows(data, trackingRows(data));
  return (
    <div className="trk-view">
      <AddBooking actions={actions} />
      {list.length ? (
        <TripGroups list={list} actions={actions} today={today} />
      ) : (
        <p className="muted small panel-empty">Nothing coming up. Add a flight, train, rental car or hotel above to keep its details here.</p>
      )}
      <TravelNote data={data} actions={actions} />
    </div>
  );
}

/** Everything still to book: entered here as "Still to book", or "Not booked" on travel.jascui.com. */
export function ToBookView({ data, actions }: { data: Data; actions: Actions }) {
  const today = localDateKey(data.now, data.tz);
  const list = groupRows(data, toBookRows(data));
  const total = list.reduce((s, g) => s + g.rows.length, 0);
  return (
    <div className="trk-view">
      {total > 0 ? (
        <>
          <p className="panel-summary">
            <strong>{total}</strong> still to book
          </p>
          <TripGroups list={list} actions={actions} today={today} />
        </>
      ) : (
        <p className="muted small panel-empty">All booked.</p>
      )}
      <AddBooking actions={actions} status="to_book" />
      <TravelNote data={data} actions={actions} />
    </div>
  );
}

/** Upcoming tracked items, for the phone tab badge. */
export function trackingCount(data: Data): number {
  return groupRows(data, toBookRows(data)).reduce((s, g) => s + g.rows.length, 0);
}
