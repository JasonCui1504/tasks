"use client";

import { daysBetween, formatDateKey, localDateKey, money, zonedParts } from "@/lib/time";
import { categoryInfo, contactDueOn, type ItineraryItem, type Trip } from "@/lib/types";
import type { Actions, Data } from "./shared";
import { TripLink } from "./TripLink";

// One day, hour by hour: your timed tasks and events, plus — on trip days —
// the actual itinerary from travel.jascui.com (each planned event with its
// place and booking status, flights, stays, cars and cancellation deadlines),
// read from the trip's calendar link. The day shown is the one picked on any
// calendar (data.selectedDay).

const HOUR_PX = 48;
const EVENT_COLOR = "#7fb894";
const TRIP_COLOR = "#0f9d8a";

type Block = {
  key: string;
  start: number; // hours from midnight, fractional
  end: number;
  title: string;
  color: string;
  sub?: string;
  detail?: React.ReactNode;
  onOpen?: () => void;
  href?: string;
  lane?: number;
  lanes?: number;
};

const STATUS_TONE: Record<string, string> = { Booked: "ok", "Not booked": "warn" };

/** "Map: https://…" style lines become links; the rest stay as text. */
function Details({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.slice(0, 4).map((l, i) => {
        const m = /^(Map|Reservation|Link):\s*(https?:\/\/\S+)$/.exec(l);
        if (m) {
          return (
            <span key={i} className="block-sub">
              <a href={m[2]} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{m[1]} ↗</a>
            </span>
          );
        }
        if (/^https?:\/\//.test(l)) {
          return (
            <span key={i} className="block-sub">
              <a href={l} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Link ↗</a>
            </span>
          );
        }
        return <span key={i} className="block-sub notes">{l.length > 140 ? l.slice(0, 140) + "…" : l}</span>;
      })}
    </>
  );
}

function clock(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${hh < 12 ? "AM" : "PM"}`;
}

function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Side-by-side lanes for overlapping blocks. */
function layLanes(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let group: Block[] = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const b of group) {
      let lane = laneEnds.findIndex((e) => e <= b.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = b.end;
      b.lane = lane;
    }
    for (const b of group) b.lanes = laneEnds.length;
    out.push(...group);
    group = [];
  };
  for (const b of sorted) {
    if (b.start >= groupEnd) flush();
    group.push(b);
    groupEnd = Math.max(groupEnd, b.end);
  }
  flush();
  return out;
}

function tripBlock(item: ItineraryItem, tripUrl: string, key: string): Block {
  return {
    key,
    start: item.start_hour!,
    end: Math.max(item.end_hour ?? item.start_hour! + 1, item.start_hour! + 0.5),
    title: item.title,
    color: TRIP_COLOR,
    href: tripUrl,
    detail: (
      <>
        {(item.location || item.status) && (
          <span className="block-sub">
            {item.status && <span className={`pill ${STATUS_TONE[item.status] ?? ""}`}>{item.status}</span>}
            {item.location && <span>⌖ {item.location}</span>}
          </span>
        )}
        <Details lines={item.details} />
      </>
    ),
  };
}

export function DayView({ data, actions }: { data: Data; actions: Actions }) {
  const date = data.selectedDay;
  const today = localDateKey(data.now, data.tz);
  const rel = daysBetween(today, date);
  const tz = data.tz;
  const hourOf = (iso: string) => {
    const p = zonedParts(new Date(iso), tz);
    return p.h + p.mi / 60;
  };

  // ---- all-day things ----
  const allDay: { key: string; title: string; color: string; onOpen: () => void }[] = [];
  const timed: Block[] = [];
  for (const t of data.tasks) {
    if (t.status !== "open" || !t.dueAt || localDateKey(new Date(t.dueAt), tz) !== date) continue;
    const info = categoryInfo(t.category);
    if (t.allDay) allDay.push({ key: `t${t.id}`, title: t.title, color: info.color, onOpen: () => actions.openTask(t) });
    else {
      const h = hourOf(t.dueAt);
      timed.push({ key: `t${t.id}`, start: h, end: h + 0.5, title: t.title, color: info.color, sub: `${clock(h)} · ${info.label}${t.amount != null ? ` · ${money(t.amount)}` : ""}`, onOpen: () => actions.openTask(t) });
    }
  }
  for (const e of data.events) {
    if (localDateKey(new Date(e.startsAt), tz) !== date) continue;
    if (e.allDay) allDay.push({ key: `e${e.id}`, title: e.title, color: EVENT_COLOR, onOpen: () => actions.openEvent(e) });
    else {
      const h = hourOf(e.startsAt);
      timed.push({ key: `e${e.id}`, start: h, end: h + 1, title: e.title, color: EVENT_COLOR, sub: `${clock(h)}${e.location ? ` · ${e.location}` : ""}`, onOpen: () => actions.openEvent(e) });
    }
  }
  for (const c of data.cards) {
    if (c.status === "active" && c.expiresOn === date) allDay.push({ key: `c${c.id}`, title: `${c.store} gift card expires (${money(c.balance)})`, color: "#f0a440", onOpen: () => actions.openCard(c) });
  }
  for (const c of data.contacts) {
    if (contactDueOn(c) === date) allDay.push({ key: `p${c.id}`, title: `Reach out to ${c.name}`, color: "#d0558b", onOpen: () => actions.openContact(c) });
  }

  // ---- trip days: trips covering this day, plus any linked itinerary with items on it (e.g. a flight the night before) ----
  const tripIds = new Set<number>(data.trips.filter((t) => t.startDate <= date && date <= t.endDate).map((t) => t.id));
  for (const it of data.itineraries) if (it.items.some((i) => i.date === date)) tripIds.add(it.id);
  const tripDays = [...tripIds].map((id) => {
    const trip: Trip = data.trips.find((t) => t.id === id) ?? { id, name: "Trip", startDate: date, endDate: date, url: data.itineraries.find((i) => i.id === id)!.url.split("/api/")[0] + `/trips/${id}` };
    const itin = data.itineraries.find((i) => i.id === id);
    const items = itin?.items.filter((i) => i.date === date) ?? [];
    return { trip, itin, items };
  });
  let tripClockNote = "";
  for (const { trip, itin, items } of tripDays) {
    items.forEach((it, i) => it.start_hour != null && timed.push(tripBlock(it, trip.url, `ti${trip.id}-${i}`)));
    if (itin?.time_zone && itin.time_zone !== tz && items.some((i) => i.start_hour != null && i.kind !== "flight")) {
      tripClockNote = `${trip.name} plans are in local time there (${itin.time_zone.split("/").pop()!.replace(/_/g, " ")}); flights are on your clock.`;
    }
  }

  const blocks = layLanes(timed);
  const first = Math.min(7, ...blocks.map((b) => Math.floor(b.start)));
  const last = Math.max(22, ...blocks.map((b) => Math.ceil(b.end)));
  const hours = Array.from({ length: Math.min(24, last) - first }, (_, i) => first + i);
  const nowHour = rel === 0 ? hourOf(data.now.toISOString()) : null;

  return (
    <div className="dayview">
      <div className="cal-head">
        <h3>
          {formatDateKey(date)}
          <span className="muted"> {rel === 0 ? "· Today" : rel === 1 ? "· Tomorrow" : rel === -1 ? "· Yesterday" : ""}</span>
        </h3>
        <div className="cal-nav">
          <button className="icon-btn sm" onClick={() => actions.selectDay(addDays(date, -1))} aria-label="Previous day">‹</button>
          <button className="btn small-btn" onClick={() => actions.selectDay(today)}>Today</button>
          <button className="icon-btn sm" onClick={() => actions.selectDay(addDays(date, 1))} aria-label="Next day">›</button>
        </div>
      </div>

      {tripDays.map(({ trip, itin, items }) => {
        const inTrip = trip.startDate <= date && date <= trip.endDate;
        const n = daysBetween(trip.startDate, date) + 1;
        const total = daysBetween(trip.startDate, trip.endDate) + 1;
        const allDayItems = items.filter((i) => i.start_hour == null);
        const label = { stay: "Stay", car: "Car", deadline: "Deadline", event: "All day", flight: "Flight" } as const;
        return (
          <div key={trip.id} className="trip-day">
            <div className="trip-day-head">
              <span>
                ✈ <strong>{trip.name}</strong> {inTrip && <span className="muted">· day {n} of {total}</span>}
              </span>
              <a className="link small" href={trip.url} target="_blank" rel="noreferrer">Itinerary ↗</a>
            </div>
            {allDayItems.length > 0 && (
              <dl className="trip-day-facts">
                {allDayItems.map((i, k) => (
                  <div key={k} className="fact">
                    <dt>{label[i.kind]}</dt>
                    <dd>
                      {i.title.replace(/^(Stay|Rental car):\s*/, "")}
                      {i.status && <span className={`pill ${STATUS_TONE[i.status] ?? ""}`}>{i.status}</span>}
                      {i.details.length > 0 && <span className="muted"> · {i.details.filter((l) => !/^https?:/.test(l)).join(" · ")}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {itin && !itin.error && items.length === 0 && <p className="muted small">Nothing planned on the itinerary this day.</p>}
            {(!itin || itin.error) && <TripLink trip={trip} data={data} actions={actions} />}
          </div>
        );
      })}

      {allDay.length > 0 && (
        <ul className="allday">
          {allDay.map((a) => (
            <li key={a.key}>
              <button onClick={a.onOpen} style={{ "--c": a.color } as React.CSSProperties}>
                {a.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tripClockNote && <p className="muted small">{tripClockNote}</p>}

      <div className="timeline" style={{ height: hours.length * HOUR_PX }}>
        {hours.map((h) => (
          <div key={h} className="hour" style={{ top: (h - first) * HOUR_PX }}>
            <span>{clock(h)}</span>
          </div>
        ))}
        {nowHour != null && nowHour >= first && nowHour <= first + hours.length && (
          <div className="now-line" style={{ top: (nowHour - first) * HOUR_PX }} />
        )}
        <div className="timeline-lanes">
          {blocks.map((b) => {
            const style = {
              top: (b.start - first) * HOUR_PX + 1,
              height: Math.max(22, (b.end - b.start) * HOUR_PX - 2),
              left: `${((b.lane ?? 0) / (b.lanes ?? 1)) * 100}%`,
              width: `calc(${100 / (b.lanes ?? 1)}% - 4px)`,
              "--c": b.color,
            } as React.CSSProperties;
            const inner = (
              <>
                <span className="block-title">{b.title}</span>
                {b.sub && <span className="block-sub">{b.sub}</span>}
                {b.detail}
              </>
            );
            return b.href ? (
              // A div, not a link: the block holds its own links (map, reservation).
              <div key={b.key} className="block trip" style={style} role="link" tabIndex={0} onClick={() => window.open(b.href, "_blank", "noopener")} onKeyDown={(e) => e.key === "Enter" && window.open(b.href, "_blank", "noopener")}>
                <span className="block-sub">{clock(b.start)}–{clock(b.end)}</span>
                {inner}
              </div>
            ) : (
              <button key={b.key} className="block" style={style} onClick={b.onOpen}>
                {inner}
              </button>
            );
          })}
        </div>
      </div>

      <div className="agenda-actions">
        <button className="btn small-btn" onClick={() => actions.newTask({ dueAt: new Date(`${date}T09:00`).toISOString() })}>+ Task this day</button>
        <button className="btn small-btn" onClick={() => actions.newEvent(date)}>+ Event this day</button>
      </div>
    </div>
  );
}
