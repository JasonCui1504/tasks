"use client";

import { useState } from "react";
import { localDateKey } from "@/lib/time";
import { bucketOf, byDue, TaskRow, type Actions, type Data } from "./shared";

/** The day's to-do list: overdue + due today, today's events, and a box to add to today. */
export function TodayList({ data, actions, compact }: { data: Data; actions: Actions; compact?: boolean }) {
  const [quick, setQuick] = useState("");
  const today = localDateKey(data.now, data.tz);
  const open = data.tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => bucketOf(t, data.now, data.tz) === "overdue").sort(byDue);
  const due = open.filter((t) => bucketOf(t, data.now, data.tz) === "today").sort(byDue);
  const doneToday = data.tasks.filter((t) => (t.status === "done" && t.completedAt && localDateKey(new Date(t.completedAt), data.tz) === today) || (t.lastDoneAt && localDateKey(new Date(t.lastDoneAt), data.tz) === today && t.status === "open"));
  const events = data.events.filter((e) => localDateKey(new Date(e.startsAt), data.tz) === today);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    // Due today, all day.
    await actions.addTask({ title, dueAt: new Date(`${today}T09:00`).toISOString(), allDay: true });
  }

  const section = (label: string, list: typeof open, danger?: boolean) =>
    list.length > 0 && (
      <div className="today-section">
        <h4 className={danger ? "danger" : ""}>
          {label} <span className="muted">{list.length}</span>
        </h4>
        <ul className="plain-list">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} now={data.now} tz={data.tz} compact={compact} onToggle={() => actions.toggleTask(t)} onOpen={() => actions.openTask(t)} />
          ))}
        </ul>
      </div>
    );

  return (
    <div className="today-list">
      <form className="inline-add" onSubmit={add}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add something for today…" aria-label="Add a task for today" enterKeyHint="done" />
      </form>

      {events.length > 0 && (
        <div className="today-section">
          <h4>
            Events <span className="muted">{events.length}</span>
          </h4>
          <ul className="plain-list">
            {events.map((e) => (
              <li key={e.id} className="mini-row">
                <button onClick={() => actions.openEvent(e)}>
                  <span className="mini-title">{e.title}</span>
                  <span className="mini-meta">
                    {e.allDay ? "All day" : new Date(e.startsAt).toLocaleTimeString("en-US", { timeZone: data.tz, hour: "numeric", minute: "2-digit" })}
                    {e.location && ` · ${e.location}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section("Overdue", overdue, true)}
      {section("Today", due)}

      {!overdue.length && !due.length && <p className="muted small panel-empty">Nothing due today.{doneToday.length ? ` ${doneToday.length} done so far.` : ""}</p>}
      {(overdue.length > 0 || due.length > 0) && doneToday.length > 0 && <p className="muted small">✓ {doneToday.length} done today</p>}
    </div>
  );
}
