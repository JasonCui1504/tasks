"use client";

import { useMemo, useState } from "react";
import { daysBetween, formatDateKey, localDateKey, money } from "@/lib/time";
import { categoryInfo, contactDueOn } from "@/lib/types";
import type { Actions, Data } from "./shared";

type Entry = { key: string; title: string; color: string; time?: string; at?: string; kind: "task" | "event" | "trip" | "card" | "person"; onOpen: () => void };

const EVENT_COLOR = "#7fb894";
const TRIP_COLOR = "#0f9d8a";

/** Everything with a date, keyed by local "YYYY-MM-DD". */
function useEntries(d: Data, a: Actions): Map<string, Entry[]> {
  return useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (date: string, e: Entry) => {
      const list = map.get(date);
      if (list) list.push(e);
      else map.set(date, [e]);
    };
    const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: d.tz, hour: "numeric", minute: "2-digit" });

    for (const t of d.tasks) {
      if (t.status !== "open" || !t.dueAt) continue;
      add(localDateKey(new Date(t.dueAt), d.tz), {
        key: `t${t.id}`,
        title: t.title,
        color: categoryInfo(t.category).color,
        time: t.allDay ? undefined : timeOf(t.dueAt),
        at: t.allDay ? undefined : t.dueAt,
        kind: "task",
        onOpen: () => a.openTask(t),
      });
    }
    for (const e of d.events) {
      add(localDateKey(new Date(e.startsAt), d.tz), {
        key: `e${e.id}`,
        title: e.title,
        color: EVENT_COLOR,
        time: e.allDay ? undefined : timeOf(e.startsAt),
        at: e.allDay ? undefined : e.startsAt,
        kind: "event",
        onOpen: () => a.openEvent(e),
      });
    }
    for (const trip of d.trips) {
      const len = Math.min(60, daysBetween(trip.startDate, trip.endDate));
      for (let i = 0; i <= len; i++) {
        const day = new Date(trip.startDate + "T12:00:00Z");
        day.setUTCDate(day.getUTCDate() + i);
        add(day.toISOString().slice(0, 10), {
          key: `trip${trip.id}-${i}`,
          title: i === 0 ? `✈ ${trip.name}` : trip.name,
          color: TRIP_COLOR,
          kind: "trip",
          onOpen: () => a.goTab("trips", { trip: trip.id }),
        });
      }
    }
    for (const c of d.cards) {
      if (c.status !== "active" || !c.expiresOn) continue;
      add(c.expiresOn, { key: `c${c.id}`, title: `${c.store} card expires (${money(c.balance)})`, color: "#f0a440", kind: "card", onOpen: () => a.openCard(c) });
    }
    const today = localDateKey(d.now, d.tz);
    for (const c of d.contacts) {
      const due = contactDueOn(c);
      if (!due || due < today) continue;
      add(due, { key: `p${c.id}`, title: `Reach out to ${c.name}`, color: "#d0558b", kind: "person", onOpen: () => a.openContact(c) });
    }
    // Timed things in order, all-day things first.
    for (const list of map.values()) list.sort((x, y) => (x.at ? 1 : 0) - (y.at ? 1 : 0) || (x.at ?? "").localeCompare(y.at ?? ""));
    return map;
  }, [d, a]);
}

function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay()); // back to Sunday
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push(d.toISOString().slice(0, 10));
  }
  // Drop a trailing week that's entirely next month.
  return cells[35].slice(0, 7) !== month ? cells.slice(0, 35) : cells;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthTitle(month: string): string {
  return new Date(month + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Agenda({ date, entries, actions, today }: { date: string; entries: Entry[]; actions: Actions; today: string }) {
  const rel = daysBetween(today, date);
  return (
    <div className="agenda">
      <div className="agenda-head">
        <h3>
          {formatDateKey(date)}
          {rel === 0 ? " · Today" : rel === 1 ? " · Tomorrow" : ""}
        </h3>
        <div className="agenda-actions">
          <button className="btn small-btn" onClick={() => actions.newTask({ dueAt: new Date(`${date}T09:00`).toISOString() })}>+ Task</button>
          <button className="btn small-btn" onClick={() => actions.newEvent(date)}>+ Event</button>
        </div>
      </div>
      {entries.length ? (
        <ul className="agenda-list">
          {entries.map((e) => (
            <li key={e.key}>
              <button onClick={e.onOpen}>
                <span className="dot" style={{ background: e.color }} />
                <span className="agenda-time">{e.time ?? (e.kind === "trip" ? "Trip" : "All day")}</span>
                <span className="agenda-title">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing on this day.</p>
      )}
    </div>
  );
}

/** The Calendar tab (full) or the side-panel calendar (`mini`). */
export function CalendarView({ data, actions, mini }: { data: Data; actions: Actions; mini?: boolean }) {
  const today = localDateKey(data.now, data.tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const entries = useEntries(data, actions);
  const cells = monthDays(month);

  return (
    <div className={mini ? "cal mini" : "cal"}>
      <div className="cal-head">
        <h3>{monthTitle(month)}</h3>
        <div className="cal-nav">
          <button className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <button className="btn small-btn" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button>
          <button className="icon-btn sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-weekday">{mini ? w[0] : w}</span>
        ))}
        {cells.map((date) => {
          const list = entries.get(date) ?? [];
          const outside = date.slice(0, 7) !== month;
          return (
            <button
              key={date}
              role="gridcell"
              aria-selected={date === selected}
              className={`cal-cell ${outside ? "outside" : ""} ${date === today ? "today" : ""} ${date === selected ? "selected" : ""} ${date < today ? "past" : ""}`}
              onClick={() => setSelected(date)}
              onDoubleClick={() => actions.newTask({ dueAt: new Date(`${date}T09:00`).toISOString() })}
            >
              <span className="cal-day">{Number(date.slice(8))}</span>
              {mini || list.length === 0 ? (
                <span className="cal-dots">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.key} className="dot" style={{ background: e.color }} />
                  ))}
                </span>
              ) : (
                <span className="cal-entries">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.key} className={`cal-entry ${e.kind}`} style={{ "--c": e.color } as React.CSSProperties}>
                      {e.title}
                    </span>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                  <span className="cal-dots phone-only">
                    {list.slice(0, 3).map((e) => (
                      <span key={e.key} className="dot" style={{ background: e.color }} />
                    ))}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Agenda date={selected} entries={entries.get(selected) ?? []} actions={actions} today={today} />
    </div>
  );
}
