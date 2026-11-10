"use client";

import { useMemo, useState } from "react";
import { daysBetween, localDateKey, relativeDue } from "@/lib/time";
import { DEFAULT_EVENT_REMINDERS, REMINDER_PRESETS, type CalendarEvent, type CalendarEventInput } from "@/lib/types";
import { DateChips, Field, splitLocal, useSheet } from "./form";

type Item = { key: string; date: string; sort: string; event: CalendarEvent };

function groupLabel(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= 7) return "Next 7 days";
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
}

type ViewProps = {
  events: CalendarEvent[];
  now: Date;
  tz: string;
  onOpen: (event: CalendarEvent) => void;
  onNew: () => void;
};

export function EventsView({ events, now, tz, onOpen, onNew }: ViewProps) {
  const [past, setPast] = useState(false);
  const today = localDateKey(now, tz);

  const items = useMemo(() => {
    const list: Item[] = events.map((e) => ({ key: `e${e.id}`, date: localDateKey(new Date(e.startsAt), tz), sort: e.startsAt, event: e }));
    // An event counts as upcoming for the rest of the day it's on (an all-day one, or one that's still to start).
    const upcoming = (i: Item) => (i.event.allDay ? i.date >= today : Date.parse(i.event.startsAt) > now.getTime() - 60 * 60_000);
    return list
      .filter((i) => (past ? !upcoming(i) : upcoming(i)))
      .sort((a, b) => (past ? b.sort.localeCompare(a.sort) : a.sort.localeCompare(b.sort)));
  }, [events, past, today, now, tz]);

  const groups = useMemo(() => {
    const out: { label: string; items: Item[] }[] = [];
    for (const i of items) {
      const label = past ? monthLabel(i.date) : groupLabel(i.date < today ? today : i.date, today);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(i);
      else out.push({ label, items: [i] });
    }
    return out;
  }, [items, past, today]);

  const counts = useMemo(() => {
    let todayN = 0;
    let week = 0;
    let month = 0;
    for (const e of events) {
      const d = daysBetween(today, localDateKey(new Date(e.startsAt), tz));
      if (d === 0) todayN++;
      if (d >= 0 && d <= 7) week++;
      if (d >= 0 && d <= 30) month++;
    }
    return { todayN, week, month };
  }, [events, today, tz]);

  return (
    <>
      <section className="stats three" aria-label="Events summary">
        <div className="stat static">
          <span className="stat-value">{counts.todayN}</span>
          <span className="stat-label">Today</span>
        </div>
        <div className="stat static">
          <span className="stat-value">{counts.week}</span>
          <span className="stat-label">Next 7 days</span>
        </div>
        <div className="stat static">
          <span className="stat-value">{counts.month}</span>
          <span className="stat-label">Next 30 days</span>
        </div>
      </section>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Show">
          <button className={!past ? "on" : ""} onClick={() => setPast(false)}>Upcoming</button>
          <button className={past ? "on" : ""} onClick={() => setPast(true)}>Past</button>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="empty">
          <p>{past ? "Nothing in the last 60 days." : "Nothing coming up. Add birthdays, appointments, concerts… (Trips have their own tab.)"}</p>
          {!past && <button className="btn" onClick={onNew}>Add an event</button>}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label} className="group">
          <h2>
            {g.label} <span className="muted">{g.items.length}</span>
          </h2>
          <ul>
            {g.items.map((i) => (
              <EventRow key={i.key} event={i.event} date={i.date} now={now} tz={tz} onOpen={() => onOpen(i.event)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function monthLabel(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

function DateBlock({ date }: { date: string }) {
  const d = new Date(date + "T12:00:00Z");
  return (
    <span className="date-block" aria-hidden>
      <span>{d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}</span>
      <strong>{d.getUTCDate()}</strong>
    </span>
  );
}

function EventRow({ event: e, date, now, tz, onOpen }: { event: CalendarEvent; date: string; now: Date; tz: string; onOpen: () => void }) {
  const start = new Date(e.startsAt);
  const time = e.allDay ? "All day" : start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const rel = relativeDue(start, now, tz, e.allDay);
  return (
    <li className="task event-row">
      <DateBlock date={date} />
      <button className="task-main" onClick={onOpen}>
        <span className="task-title">{e.title}</span>
        <span className="task-meta">
          <span>{time}</span>
          <span>{rel[0].toUpperCase() + rel.slice(1)}</span>
          {e.location && <span>⌖ {e.location}</span>}
          {e.reminders.length > 0 && Date.parse(e.startsAt) > now.getTime() && <span className="bell" title="Reminders on">🔔</span>}
        </span>
      </button>
    </li>
  );
}

type SheetProps = {
  event: CalendarEvent | null;
  /** For a new event: the day to start on, "YYYY-MM-DD". */
  draftDate?: string;
  /** For a new event: preset "HH:MM" start and end (e.g. from dragging on the Day view). */
  draftTimes?: { start: string; end?: string; title?: string };
  onClose: () => void;
  onSave: (input: CalendarEventInput, existing: CalendarEvent | null) => Promise<void>;
  onDelete: (event: CalendarEvent) => Promise<void>;
};

export function EventSheet({ event, draftDate, draftTimes, onClose, onSave, onDelete }: SheetProps) {
  useSheet(onClose);
  const start = splitLocal(event?.startsAt ?? null, event?.allDay ?? false);
  const [title, setTitle] = useState(event?.title ?? draftTimes?.title ?? "");
  const [date, setDate] = useState(start.date || draftDate || "");
  const [time, setTime] = useState(start.time || draftTimes?.start || "");
  const [endTime, setEndTime] = useState(event?.endsAt && !event.allDay ? splitLocal(event.endsAt, false).time : (draftTimes?.end ?? ""));
  const [location, setLocation] = useState(event?.location ?? "");
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? DEFAULT_EVENT_REMINDERS);
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Give it a name.");
    if (!date) return setError("Pick a date.");
    setBusy(true);
    setError("");
    const startsAt = new Date(`${date}T${time || "09:00"}`);
    let endsAt: Date | null = time && endTime ? new Date(`${date}T${endTime}`) : null;
    // An end earlier than the start runs past midnight.
    if (endsAt && endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);
    try {
      await onSave(
        {
          title: title.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt ? endsAt.toISOString() : null,
          allDay: !time,
          location,
          reminders,
          notes,
        },
        event,
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={submit} aria-label={event ? "Edit event" : "New event"}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <strong>{event ? "Edit event" : "New event"}</strong>
          <button className="link strong" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="sheet-body">
          <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's happening?" autoFocus={!event} aria-label="Name" />

          <div className="row2">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Starts" hint={date && !time ? "All day" : undefined}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
            </Field>
          </div>
          <DateChips value={date} onChange={setDate} quick />
          {time && (
            <div className="row2">
              <Field label="Ends" hint="optional">
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </Field>
              <div className="quick-dates end-actions">
                <button type="button" className="link" onClick={() => { setTime(""); setEndTime(""); }}>Make all-day</button>
              </div>
            </div>
          )}

          <Field label="Where" hint="optional">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Place or address" />
          </Field>

          <Field label="Remind me">
            <div className="chips wrap">
              {REMINDER_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.minutes}
                  className={`chip ${reminders.includes(p.minutes) ? "active" : ""}`}
                  onClick={() => setReminders((r) => (r.includes(p.minutes) ? r.filter((x) => x !== p.minutes) : [...r, p.minutes].sort((a, b) => b - a)))}
                >
                  {p.minutes === 0 ? "When it starts" : p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Tickets, who's coming, what to bring…" />
          </Field>

          {error && <p className="error">{error}</p>}

          {event && (
            <div className="sheet-foot">
              <span />
              <button type="button" className="btn danger-text" onClick={() => confirm(`Delete “${event.title}”?`) && onDelete(event)}>
                Delete
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
