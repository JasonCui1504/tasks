"use client";

import { useEffect, useRef, useState } from "react";
import { daysBetween, formatDateKey, localDateKey, money, zonedParts } from "@/lib/time";
import { categoryInfo, contactDueOn, type ItineraryItem, type Trip } from "@/lib/types";
import type { Actions, Data } from "./shared";
import { TravelConnect } from "./TravelConnect";

// One day, midnight to midnight: your timed tasks and events, plus — on trip
// days — the actual itinerary from travel.jascui.com (each planned event with
// its place and booking status, flights, stays, cars and cancellation
// deadlines). Drag on empty space to pick a time in 30-minute steps and type a
// task or event right there; drag a task or event to move it. On touch screens
// both start with a press-and-hold, so scrolling past never triggers them. A
// red line marks the current time. The day shown is the one picked on any
// calendar (data.selectedDay).

const HOUR_PX = 48;
const SLOT = 0.5; // hours
const SLOT_PX = HOUR_PX * SLOT;
const HOLD_MS = 450; // press-and-hold before a touch picks or moves
const HOLD_SLOP = 8; // px a finger may wander during the hold
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
  /** Saves a new start (hours) when the block is dragged; absent = can't be moved. */
  moveTo?: (start: number) => void;
  lane?: number;
  lanes?: number;
};

/** "HH:MM" for hours from midnight. */
const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** The instant at hours-from-midnight on a "YYYY-MM-DD", in this device's zone. */
function at(date: string, h: number): string {
  const base = new Date(`${date}T00:00`);
  return new Date(base.getTime() + h * 3_600_000).toISOString();
}

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
  const lanesRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Picking a time: while dragging (`pick`), then the composer for the picked range.
  const [pick, setPick] = useState<{ anchor: number; current: number } | null>(null);
  const [compose, setCompose] = useState<{ start: number; end: number } | null>(null);
  // A clicked itinerary block: asks before leaving for travel.jascui.com, or adds something at its time.
  const [menu, setMenu] = useState<{ key: string; title: string; href: string; start: number; end: number } | null>(null);
  // Moving a block: its key and preview start.
  const [moving, setMoving] = useState<{ key: string; startY: number; orig: number; dur: number; preview: number; moveTo: (s: number) => void; onOpen?: () => void } | null>(null);
  // A touch press waiting out HOLD_MS; and a short guard so the tap that ends a touch move doesn't also open the item.
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const justMoved = useRef(false);

  // The current time, for the red line: refreshed every 30 seconds.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function beginHold(e: React.PointerEvent, fire: () => void) {
    cancelHold();
    const { clientX: x, clientY: y } = e;
    hold.current = {
      x,
      y,
      timer: setTimeout(() => {
        hold.current = null;
        navigator.vibrate?.(12);
        fire();
      }, HOLD_MS),
    };
  }
  function cancelHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }
  function holdMoved(e: React.PointerEvent) {
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > HOLD_SLOP) cancelHold();
  }

  // While a touch is picking or moving, the page mustn't scroll under the finger.
  const touching = !!(pick || moving);
  useEffect(() => {
    if (!touching) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, [touching]);

  // Open on the morning (or the current hour) rather than midnight.
  useEffect(() => {
    const tl = timelineRef.current;
    const scroller = tl?.closest(".box-body") as HTMLElement | null;
    if (!tl || !scroller) return;
    const focusHour = rel === 0 ? Math.max(0, hourOf(new Date().toISOString()) - 1.5) : 7;
    scroller.scrollTop += tl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + focusHour * HOUR_PX - 8;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the day changes
  }, [date]);

  const slotAt = (clientY: number) => {
    const top = lanesRef.current!.getBoundingClientRect().top;
    return Math.max(0, Math.min(47, Math.floor((clientY - top) / SLOT_PX)));
  };

  // Mouse/pen: press on empty space and drag to cover a range. Touch: press and hold, then drag.
  function startPick(e: React.PointerEvent) {
    if (e.target !== lanesRef.current) return;
    const slot = slotAt(e.clientY);
    if (e.pointerType === "touch") {
      beginHold(e, () => {
        setCompose(null);
        setMenu(null);
        setPick({ anchor: slot, current: slot });
      });
      return;
    }
    setCompose(null);
    setMenu(null);
    e.preventDefault();
    setPick({ anchor: slot, current: slot });
  }

  useEffect(() => {
    if (!pick) return;
    const onMove = (e: PointerEvent) => {
      const current = slotAt(e.clientY);
      if (current !== pick.current) setPick({ ...pick, current });
    };
    const onUp = () => {
      const a = Math.min(pick.anchor, pick.current);
      const b = Math.max(pick.anchor, pick.current);
      // A single click picks an hour; a drag picks exactly what was covered.
      setCompose({ start: a * SLOT, end: a === b ? a * SLOT + 1 : (b + 1) * SLOT });
      setPick(null);
    };
    const onCancel = () => setPick(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [pick]);

  useEffect(() => {
    if (!moving) return;
    const onMove = (e: PointerEvent) => {
      const delta = Math.round((e.clientY - moving.startY) / SLOT_PX) * SLOT;
      const preview = Math.max(0, Math.min(24 - moving.dur, moving.orig + delta));
      if (preview !== moving.preview) setMoving({ ...moving, preview });
    };
    const onUp = (e: PointerEvent) => {
      if (moving.preview !== moving.orig) moving.moveTo(moving.preview);
      else if (e.pointerType !== "touch") moving.onOpen?.();
      if (e.pointerType === "touch") {
        justMoved.current = true;
        setTimeout(() => (justMoved.current = false), 400);
      }
      setMoving(null);
    };
    const onCancel = () => setMoving(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [moving]);

  // ---- what's on the day ----
  const allDay: { key: string; title: string; color: string; onOpen: () => void }[] = [];
  const timed: Block[] = [];
  for (const t of data.tasks) {
    if (t.status !== "open" || !t.dueAt || localDateKey(new Date(t.dueAt), tz) !== date) continue;
    const info = categoryInfo(t.category);
    if (t.allDay) allDay.push({ key: `t${t.id}`, title: t.title, color: info.color, onOpen: () => actions.openTask(t) });
    else {
      const h = hourOf(t.dueAt);
      timed.push({
        key: `t${t.id}`,
        start: h,
        end: h + SLOT,
        title: t.title,
        color: info.color,
        sub: `${clock(h)} · ${info.label}${t.amount != null ? ` · ${money(t.amount)}` : ""}`,
        onOpen: () => actions.openTask(t),
        moveTo: (s) => actions.updateTask(t, { dueAt: at(date, s), allDay: false }),
      });
    }
  }
  for (const e of data.events) {
    if (localDateKey(new Date(e.startsAt), tz) !== date) continue;
    if (e.allDay) allDay.push({ key: `e${e.id}`, title: e.title, color: EVENT_COLOR, onOpen: () => actions.openEvent(e) });
    else {
      const h = hourOf(e.startsAt);
      const dur = e.endsAt ? Math.max(SLOT, (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 3_600_000) : 1;
      timed.push({
        key: `e${e.id}`,
        start: h,
        end: Math.min(24, h + dur),
        title: e.title,
        color: EVENT_COLOR,
        sub: `${clock(h)}${e.endsAt ? `–${clock(h + dur)}` : ""}${e.location ? ` · ${e.location}` : ""}`,
        onOpen: () => actions.openEvent(e),
        moveTo: (s) => actions.updateEvent(e, { startsAt: at(date, s), endsAt: e.endsAt ? at(date, s + dur) : null }),
      });
    }
  }
  for (const c of data.cards) {
    if (c.status === "active" && c.expiresOn === date) allDay.push({ key: `c${c.id}`, title: `${c.store} gift card expires (${money(c.balance)})`, color: "#f0a440", onOpen: () => actions.openCard(c) });
  }
  for (const c of data.contacts) {
    if (contactDueOn(c) === date) allDay.push({ key: `p${c.id}`, title: `Reach out to ${c.name}`, color: "#d0558b", onOpen: () => actions.openContact(c) });
  }

  // ---- trip days: trips covering this day, plus any itinerary with items on it (e.g. a flight the night before) ----
  const tripIds = new Set<number>(data.trips.filter((t) => t.startDate <= date && date <= t.endDate).map((t) => t.id));
  for (const it of data.itineraries) if (it.items.some((i) => i.date === date)) tripIds.add(it.id);
  const tripDays = [...tripIds].map((id) => {
    const trip: Trip = data.trips.find((t) => t.id === id) ?? { id, name: "Trip", startDate: date, endDate: date, url: data.itineraries.find((i) => i.id === id)!.url };
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
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowIso = new Date(nowTick).toISOString();
  const nowHour = localDateKey(new Date(nowTick), tz) === date ? hourOf(nowIso) : null;
  const picked = pick ? { start: Math.min(pick.anchor, pick.current) * SLOT, end: (Math.max(pick.anchor, pick.current) + 1) * SLOT } : compose;

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
            {itin && items.length === 0 && <p className="muted small">Nothing planned on the itinerary this day.</p>}
            {(!data.travelLink.connected || data.travelLink.error) && <TravelConnect data={data} actions={actions} compact />}
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
      <p className="muted small hint">Drag on the timeline to add a task or event — the strip on the right is always free, even beside an event. Drag one to move it.</p>

      <div ref={timelineRef} className="timeline" style={{ height: 24 * HOUR_PX }}>
        {hours.map((h) => (
          <div key={h} className="hour" style={{ top: h * HOUR_PX }}>
            <span>{clock(h)}</span>
          </div>
        ))}
        {hours.map((h) => (
          <div key={`h${h}`} className="half-hour" style={{ top: (h + SLOT) * HOUR_PX }} />
        ))}
        {nowHour != null && (
          <div className="now-line" style={{ top: nowHour * HOUR_PX }} aria-label="Now">
            <span className="now-label">{clock(Math.floor(nowHour * 60) / 60)}</span>
          </div>
        )}
        <div
          ref={lanesRef}
          className={`timeline-lanes ${pick ? "picking" : ""}`}
          onPointerDown={startPick}
          onPointerMove={holdMoved}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={(e) => e.preventDefault()}
        >
          {picked && (
            <div className="pick" style={{ top: picked.start * HOUR_PX, height: (picked.end - picked.start) * HOUR_PX }}>
              <span>
                {clock(picked.start)} – {clock(picked.end)}
              </span>
            </div>
          )}
          {blocks.map((b) => {
            const start = moving?.key === b.key ? moving.preview : b.start;
            const height = Math.max(22, (b.end - b.start) * HOUR_PX - 2);
            const style = {
              top: start * HOUR_PX + 1,
              height,
              "--h": `${height}px`,
                      // Blocks leave a strip free on the right, so there's always room to drag in something new.
              left: `calc((100% - var(--free)) * ${(b.lane ?? 0) / (b.lanes ?? 1)})`,
              width: `calc((100% - var(--free)) / ${b.lanes ?? 1} - 4px)`,
              "--c": b.color,
            } as React.CSSProperties;
            const inner = (
              <>
                <span className="block-title">{b.title}</span>
                {moving?.key === b.key ? <span className="block-sub">{clock(start)}</span> : b.sub && <span className="block-sub">{b.sub}</span>}
                {b.detail}
              </>
            );
            if (b.href) {
              return (
                // A div, not a link: the block holds its own links (map, reservation).
                <div
                  key={b.key}
                  className={`block trip ${menu?.key === b.key ? "chosen" : ""}`}
                  style={style}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setCompose(null);
                    setMenu({ key: b.key, title: b.title, href: b.href!, start: b.start, end: b.end });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setMenu({ key: b.key, title: b.title, href: b.href!, start: b.start, end: b.end })}
                >
                  <span className="block-sub">{clock(b.start)}–{clock(b.end)}</span>
                  {inner}
                </div>
              );
            }
            return (
              <button
                key={b.key}
                className={`block ${moving?.key === b.key ? "moving" : ""}`}
                style={style}
                onPointerDown={(e) => {
                  if (!b.moveTo || e.button !== 0) return;
                  const begin = (startY: number) =>
                    setMoving({ key: b.key, startY, orig: b.start, dur: b.end - b.start, preview: b.start, moveTo: b.moveTo!, onOpen: b.onOpen });
                  if (e.pointerType === "touch") {
                    const y = e.clientY;
                    beginHold(e, () => begin(y));
                    return;
                  }
                  e.preventDefault();
                  begin(e.clientY);
                }}
                onPointerMove={holdMoved}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onClick={(e) => {
                  // Mouse clicks open through the drag handler (no movement = open); touch taps and keyboard open here.
                  if (justMoved.current) return;
                  if ((e.nativeEvent as PointerEvent).pointerType === "touch" || e.detail === 0) b.onOpen?.();
                }}
              >
                {inner}
              </button>
            );
          })}
          {menu && (
            <div
              className="composer block-menu"
              style={{ top: Math.min(menu.end * HOUR_PX + 4, 24 * HOUR_PX - 150) }}
              role="dialog"
              aria-label={menu.title}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === "Escape" && setMenu(null)}
            >
              <p className="block-menu-title">{menu.title}</p>
              <p className="muted small">
                {clock(menu.start)} – {clock(menu.end)} · from travel.jascui.com
              </p>
              <div className="block-menu-actions">
                <button
                  className="btn primary small-btn"
                  autoFocus
                  onClick={() => {
                    setCompose({ start: menu.start, end: Math.min(24, Math.max(menu.end, menu.start + SLOT)) });
                    setMenu(null);
                  }}
                >
                  + Add task or event at this time
                </button>
                <button
                  className="btn small-btn"
                  onClick={() => {
                    window.open(menu.href, "_blank", "noopener");
                    setMenu(null);
                  }}
                >
                  Open on travel.jascui.com ↗
                </button>
                <button className="link small" onClick={() => setMenu(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {compose && <Composer date={date} range={compose} actions={actions} onClose={() => setCompose(null)} />}
        </div>
      </div>

      <div className="agenda-actions">
        <button className="btn small-btn" onClick={() => actions.newTask({ dueAt: at(date, 9) })}>+ Task this day</button>
        <button className="btn small-btn" onClick={() => actions.newEvent(date)}>+ Event this day</button>
      </div>
    </div>
  );
}

/** Type a task or event into the picked time range. */
function Composer({ date, range, actions, onClose }: { date: string; range: { start: number; end: number }; actions: Actions; onClose: () => void }) {
  const [kind, setKind] = useState<"event" | "task">("event");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    if (kind === "event") await actions.createEvent({ title: title.trim(), startsAt: at(date, range.start), endsAt: at(date, range.end), allDay: false });
    else await actions.addTask({ title: title.trim(), dueAt: at(date, range.start), allDay: false });
    onClose();
  }

  function more() {
    if (kind === "event") actions.newEvent(date, { start: hhmm(range.start), end: hhmm(range.end), title: title.trim() });
    else actions.newTask({ title: title.trim(), dueAt: at(date, range.start), allDay: false });
    onClose();
  }

  return (
    <form
      className="composer"
      style={{ top: Math.min(range.end * HOUR_PX + 4, 24 * HOUR_PX - 120) }}
      onSubmit={save}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="composer-head">
        <div className="seg" role="radiogroup" aria-label="Add as">
          <button type="button" className={kind === "event" ? "on" : ""} onClick={() => setKind("event")}>Event</button>
          <button type="button" className={kind === "task" ? "on" : ""} onClick={() => setKind("task")}>Task</button>
        </div>
        <span className="muted small">
          {clock(range.start)}
          {kind === "event" ? ` – ${clock(range.end)}` : ""}
        </span>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "event" ? "What's happening?" : "What needs doing?"} autoFocus aria-label="Title" />
      <div className="composer-actions">
        <button type="button" className="link small" onClick={onClose}>Cancel</button>
        <button type="button" className="link small" onClick={more}>More options</button>
        <button className="btn primary small-btn" disabled={!title.trim() || busy}>Add</button>
      </div>
    </form>
  );
}
