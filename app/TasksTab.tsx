"use client";

import { useMemo, useState } from "react";
import { daysBetween, localDateKey, money, monthlyCost } from "@/lib/time";
import { URGENCIES, categoryInfo } from "@/lib/types";
import { BUCKET_LABELS, BUCKET_ORDER, Chip, Stat, TaskRow, bucketOf, byDue, type Actions, type Data } from "./shared";

export type When = "all" | "overdue" | "today" | "week";


export type Counts = { overdue: number; today: number; week: number };

export function taskCounts(data: Data): Counts {
  const c = { overdue: 0, today: 0, week: 0 };
  for (const t of data.tasks) {
    if (t.status !== "open") continue;
    const b = bucketOf(t, data.now, data.tz);
    if (b === "overdue") c.overdue++;
    else if (b === "today") c.today++;
    else if (b === "tomorrow" || b === "week") c.week++;
  }
  return c;
}

/** The four numbers: overdue, today, next 7 days, and the countdown to the next event. Tapping one filters (or opens Events). */
export function SummaryStats({ data, actions, when, onWhen }: { data: Data; actions: Actions; when?: When; onWhen?: (w: When) => void }) {
  const { now, tz, events } = data;
  const counts = taskCounts(data);
  const today = localDateKey(now, tz);
  const nextEvent = events.find((e) => (e.allDay ? localDateKey(new Date(e.startsAt), tz) >= today : Date.parse(e.startsAt) > now.getTime()));
  const nextEventDays = nextEvent ? daysBetween(today, localDateKey(new Date(nextEvent.startsAt), tz)) : null;
  const pick = (w: When) => onWhen?.(when === w ? "all" : w);
  return (
    <section className="stats" aria-label="Summary">
      <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? "critical" : undefined} active={when === "overdue"} onClick={onWhen ? () => pick("overdue") : undefined} />
      <Stat label="Today" value={counts.today} active={when === "today"} onClick={onWhen ? () => pick("today") : undefined} />
      <Stat label="Next 7 days" value={counts.week} active={when === "week"} onClick={onWhen ? () => pick("week") : undefined} />
      <Stat
        label={nextEvent ? `Until ${nextEvent.title}` : "Next event"}
        value={nextEventDays == null ? "—" : nextEventDays === 0 ? "Today" : `${nextEventDays}d`}
        onClick={() => actions.goTab("events")}
      />
    </section>
  );
}

/** The full task list with filters. `noStats` drops the numbers (a workspace box can show them separately). */
export function TasksTab({ data, actions, noStats }: { data: Data; actions: Actions; noStats?: boolean }) {
  const { tasks, now, tz, trips, categories } = data;
  const [category, setCategory] = useState<string>("all");
  const [when, setWhen] = useState<When>("all");
  const [minUrgency, setMinUrgency] = useState(0);
  const [sort, setSort] = useState<"due" | "urgency">("due");
  const [showDone, setShowDone] = useState(false);
  const [quick, setQuick] = useState("");

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of open) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, [open]);

  const visible = useMemo(() => {
    const pool = showDone ? tasks.filter((t) => t.status === "done") : open;
    return pool.filter((t) => {
      if (category !== "all" && t.category !== category && !(category === "trip" && t.tripId != null)) return false;
      if (t.urgency < minUrgency) return false;
      if (!showDone && when !== "all") {
        const b = bucketOf(t, now, tz);
        if (when === "overdue" && b !== "overdue") return false;
        if (when === "today" && b !== "today" && b !== "overdue") return false;
        if (when === "week" && !["overdue", "today", "tomorrow", "week"].includes(b)) return false;
      }
      return true;
    });
  }, [tasks, open, showDone, category, minUrgency, when, now, tz]);

  const groups = useMemo(() => {
    if (showDone) {
      const done = [...visible].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
      return done.length ? [{ key: "done", label: "Completed in the last 30 days", items: done }] : [];
    }
    if (sort === "urgency") {
      return [...URGENCIES]
        .reverse()
        .map((u) => ({ key: `u${u.value}`, label: u.label, items: visible.filter((t) => t.urgency === u.value).sort(byDue) }))
        .filter((g) => g.items.length);
    }
    return BUCKET_ORDER.map((b) => ({
      key: b,
      label: BUCKET_LABELS[b],
      items: visible.filter((t) => bucketOf(t, now, tz) === b).sort((a, c) => (b === "none" ? c.urgency - a.urgency || a.id - c.id : byDue(a, c))),
    })).filter((g) => g.items.length);
  }, [visible, sort, showDone, now, tz]);

  const recurring = useMemo(() => {
    if (category !== "subscription" && category !== "payment") return null;
    const items = open.filter((t) => t.category === category && t.repeat !== "none" && t.amount != null);
    if (!items.length) return null;
    const perMonth = items.reduce((s, t) => s + monthlyCost(t.amount!, t.repeat, t.repeatEvery), 0);
    return { perMonth, count: items.length };
  }, [open, category]);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    await actions.addTask({ title, category: category === "all" ? "personal" : category });
  }

  const filtering = category !== "all" || when !== "all" || minUrgency > 0;

  return (
    <>
      {!noStats && <SummaryStats data={data} actions={actions} when={when} onWhen={setWhen} />}

      <form className="quick" onSubmit={quickAdd}>
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder={`Add a task${category !== "all" ? ` to ${categoryInfo(category).label}` : ""}…`}
          aria-label="Quick add a task"
          enterKeyHint="done"
        />
        {quick.trim() && (
          <button type="button" className="link" onClick={() => { actions.newTask({ title: quick.trim(), category: category === "all" ? undefined : category }); setQuick(""); }}>
            Details
          </button>
        )}
      </form>

      <nav className="chips" aria-label="Categories">
        <Chip active={category === "all"} onClick={() => setCategory("all")} label="All" count={open.length} />
        {categories.map((id) => {
          const info = categoryInfo(id);
          const n = categoryCounts.get(id) ?? 0;
          if (!n && category !== id && !["work", "trip", "subscription", "payment", "personal"].includes(id)) return null;
          return <Chip key={id} active={category === id} color={info.color} onClick={() => setCategory(category === id ? "all" : id)} label={info.label} count={n} />;
        })}
      </nav>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Sort">
          <button className={sort === "due" ? "on" : ""} onClick={() => setSort("due")}>By date</button>
          <button className={sort === "urgency" ? "on" : ""} onClick={() => setSort("urgency")}>By urgency</button>
        </div>
        <select value={minUrgency} onChange={(e) => setMinUrgency(Number(e.target.value))} aria-label="Minimum urgency">
          <option value={0}>Any urgency</option>
          <option value={2}>High &amp; critical</option>
          <option value={3}>Critical only</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Done
        </label>
        {filtering && (
          <button className="link" onClick={() => { setCategory("all"); setWhen("all"); setMinUrgency(0); }}>
            Clear filters
          </button>
        )}
      </div>

      {recurring && (
        <p className="recurring">
          {recurring.count} recurring {category === "subscription" ? "subscriptions" : "payments"} ≈ <strong>{money(recurring.perMonth)}</strong>/month · {money(recurring.perMonth * 12)}/year
        </p>
      )}

      <div className="list">
        {groups.length === 0 && (
          <div className="empty">
            <p>{showDone ? "Nothing completed recently." : filtering ? "Nothing matches these filters." : "All clear. Nothing outstanding."}</p>
            {!showDone && <button className="btn" onClick={() => actions.newTask()}>Add a task</button>}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key} className="group">
            <h2 className={g.key === "overdue" ? "danger" : ""}>
              {g.label} <span className="muted">{g.items.length}</span>
            </h2>
            <ul>
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  now={now}
                  tz={tz}
                  trip={t.tripId != null ? trips.find((x) => x.id === t.tripId) : undefined}
                  onToggle={() => actions.toggleTask(t)}
                  onOpen={() => actions.openTask(t)}
                  onDefer={() => actions.deferTask(t, 24 * 60)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
