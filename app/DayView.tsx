"use client";

import { daysBetween, formatDateKey, localDateKey, money, zonedParts } from "@/lib/time";
import { categoryInfo, contactDueOn, type ItineraryEvent, type TripItinerary } from "@/lib/types";
import type { Actions, Data } from "./shared";

// One day, hour by hour: your timed tasks and events, plus — on trip days —
// the actual itinerary from travel.jascui.com (each planned event with its
// place, booking status and flights, and where you're staying / eating).
// The day shown is the one picked on any calendar (data.selectedDay).

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

const STATUS: Record<string, { label: string; tone: string }> = {
  booked: { label: "Booked", tone: "ok" },
  not_booked: { label: "Not booked", tone: "warn" },
  transit: { label: "Transit", tone: "" },
  unnecessary: { label: "No booking needed", tone: "" },
};

function clock(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${hh < 12 ? "AM" : "PM"}`;
}

const flightTime = (s: string) => {
  const [h, m] = s.slice(11, 16).split(":").map(Number);
  return clock(h + m / 60);
};

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

function tripEventBlock(e: ItineraryEvent, trip: TripItinerary, i: number): Block {
  const status = STATUS[e.status];
  return {
    key: `ti${trip.id}-${i}`,
    start: e.start_hour,
    end: Math.max(e.end_hour, e.start_hour + 0.5),
    title: e.title,
    color: TRIP_COLOR,
    href: trip.url,
    detail: (
      <>
        {(e.location || status) && (
          <span className="block-sub">
            {status && <span className={`pill ${status.tone}`}>{status.label}</span>}
            {e.location && <span>⌖ {e.location}</span>}
          </span>
        )}
        {e.flights.map((f, j) => (
          <span key={j} className="block-sub flight">
            ✈ {f.flight_no && <strong>{f.flight_no}</strong>} {f.from_code} {flightTime(f.depart)} → {f.to_code} {flightTime(f.arrive)}
            {f.arrive.slice(0, 10) !== f.depart.slice(0, 10) ? " (+1)" : ""}
          </span>
        ))}
        {e.notes && <span className="block-sub notes">{e.notes.slice(0, 140)}</span>}
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

  // ---- trip days ----
  const trips = data.trips.filter((t) => t.startDate <= date && date <= t.endDate);
  const itineraries = trips.map((t) => ({ trip: t, itin: data.itineraries.find((i) => i.id === t.id) }));
  let tripClockNote = "";
  for (const { itin } of itineraries) {
    if (!itin) continue;
    itin.events.forEach((e, i) => e.date === date && timed.push(tripEventBlock(e, itin, i)));
    if (itin.time_zone && itin.time_zone !== tz && itin.events.some((e) => e.date === date)) {
      tripClockNote = `${itin.name} items are in local time there (${itin.time_zone.split("/").pop()!.replace(/_/g, " ")}).`;
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

      {itineraries.map(({ trip, itin }) => {
        const day = itin?.days.find((d) => d.date === date);
        const n = daysBetween(trip.startDate, date) + 1;
        const total = daysBetween(trip.startDate, trip.endDate) + 1;
        return (
          <div key={trip.id} className="trip-day">
            <div className="trip-day-head">
              <span>
                ✈ <strong>{trip.name}</strong> <span className="muted">· day {n} of {total}</span>
              </span>
              <a className="link small" href={trip.url} target="_blank" rel="noreferrer">Itinerary ↗</a>
            </div>
            {day && (day.accommodation || day.breakfast || day.lunch || day.dinner || day.car || day.notes) ? (
              <dl className="trip-day-facts">
                {day.accommodation && (
                  <>
                    <dt>Stay</dt>
                    <dd>
                      {day.stay_link ? <a href={day.stay_link} target="_blank" rel="noreferrer">{day.accommodation}</a> : day.accommodation}
                      {day.accommodation_status && <span className={`pill ${day.accommodation_status === "booked" ? "ok" : "warn"}`}>{STATUS[day.accommodation_status]?.label ?? day.accommodation_status}</span>}
                      {day.stay_address && <span className="muted"> · {day.stay_address}</span>}
                    </dd>
                  </>
                )}
                {(day.breakfast || day.lunch || day.dinner) && (
                  <>
                    <dt>Meals</dt>
                    <dd>{[day.breakfast && `B: ${day.breakfast}`, day.lunch && `L: ${day.lunch}`, day.dinner && `D: ${day.dinner}`].filter(Boolean).join(" · ")}</dd>
                  </>
                )}
                {day.car && (
                  <>
                    <dt>Car</dt>
                    <dd>{day.car}</dd>
                  </>
                )}
                {day.notes && (
                  <>
                    <dt>Notes</dt>
                    <dd>{day.notes}</dd>
                  </>
                )}
              </dl>
            ) : (
              !itin && <p className="muted small">Itinerary details appear here once travel.jascui.com shares them.</p>
            )}
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
              <a key={b.key} className="block trip" style={style} href={b.href} target="_blank" rel="noreferrer">
                <span className="block-sub">{clock(b.start)}–{clock(b.end)}</span>
                {inner}
              </a>
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
