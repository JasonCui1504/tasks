"use client";

import { useEffect, useMemo, useState } from "react";
import { daysBetween, formatDateKey, localDateKey, money, monthlyCost, relativeDue } from "@/lib/time";
import { categoryInfo, contactDueOn, frequencyLabel } from "@/lib/types";
import { CalendarView } from "./CalendarView";
import { byDue, capitalize, TaskRow, type Actions, type Data } from "./shared";
import { TripsView } from "./Trips";

// The side panels of the workspace. Each side holds a stack of panels; each
// panel shows one view (a task category, trips, events, a calendar, people,
// gift cards) that you pick from its menu. The layout is remembered per device.

export type PanelView = "trips" | "calendar" | "events" | "people" | "cards" | `cat:${string}`;

const DEFAULTS: Record<"left" | "right", PanelView[]> = {
  left: ["trips", "calendar"],
  right: ["cat:work", "cat:subscription"],
};
const MAX_PANELS = 4;

function viewLabel(v: PanelView): string {
  if (v.startsWith("cat:")) return categoryInfo(v.slice(4)).label;
  return { trips: "Trips", calendar: "Calendar", events: "Events", people: "Stay in touch", cards: "Gift cards" }[v as Exclude<PanelView, `cat:${string}`>];
}

function useStoredPanels(side: "left" | "right"): [PanelView[], (p: PanelView[]) => void] {
  const key = `tasks.panels.${side}`;
  const [panels, setPanels] = useState<PanelView[]>(DEFAULTS[side]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved layout is only readable after mount
      if (Array.isArray(saved)) setPanels(saved.slice(0, MAX_PANELS));
    } catch {}
  }, [key]);
  const save = (next: PanelView[]) => {
    setPanels(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [panels, save];
}

export function SideColumn({ side, data, actions }: { side: "left" | "right"; data: Data; actions: Actions }) {
  const [panels, setPanels] = useStoredPanels(side);
  const options: PanelView[] = useMemo(
    () => ["trips", "calendar", "events", "people", "cards", ...data.categories.map((c) => `cat:${c}` as PanelView)],
    [data.categories],
  );

  return (
    <aside className={`ws-side ws-${side}`} aria-label={`${side === "left" ? "Left" : "Right"} panels`}>
      {panels.map((view, i) => (
        <Panel
          key={`${i}-${view}`}
          view={view}
          options={options}
          data={data}
          actions={actions}
          onChange={(v) => setPanels(panels.map((p, j) => (j === i ? v : p)))}
          onRemove={() => setPanels(panels.filter((_, j) => j !== i))}
        />
      ))}
      {panels.length < MAX_PANELS && (
        <AddPanel options={options} onAdd={(v) => setPanels([...panels, v])} />
      )}
    </aside>
  );
}

function AddPanel({ options, onAdd }: { options: PanelView[]; onAdd: (v: PanelView) => void }) {
  return (
    <label className="add-panel">
      <span>+ Add a panel</span>
      <select value="" onChange={(e) => e.target.value && onAdd(e.target.value as PanelView)} aria-label="Add a panel">
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{viewLabel(o)}</option>
        ))}
      </select>
    </label>
  );
}

function Panel({
  view,
  options,
  data,
  actions,
  onChange,
  onRemove,
}: {
  view: PanelView;
  options: PanelView[];
  data: Data;
  actions: Actions;
  onChange: (v: PanelView) => void;
  onRemove: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const cat = view.startsWith("cat:") ? view.slice(4) : null;
  const add =
    view === "events" ? () => actions.newEvent()
    : view === "people" ? actions.newContact
    : view === "cards" ? actions.newCard
    : view === "trips" ? () => actions.newTask({ category: "trip" })
    : cat ? () => actions.newTask({ category: cat })
    : null;

  return (
    <section className={`panel ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-head">
        {cat && <span className="dot" style={{ background: categoryInfo(cat).color }} />}
        <select className="panel-select" value={view} onChange={(e) => onChange(e.target.value as PanelView)} aria-label="What this panel shows">
          {options.map((o) => (
            <option key={o} value={o}>{viewLabel(o)}</option>
          ))}
        </select>
        <div className="panel-tools">
          {add && <button className="panel-btn" onClick={add} aria-label={`Add to ${viewLabel(view)}`} title="Add">+</button>}
          <button className="panel-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand" : "Collapse"} title={collapsed ? "Expand" : "Collapse"}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden style={{ transform: collapsed ? "rotate(180deg)" : undefined }}>
              <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="panel-btn" onClick={onRemove} aria-label="Remove panel" title="Remove panel">×</button>
        </div>
      </header>
      {!collapsed && (
        <div className="panel-body">
          {view === "trips" && <TripsView data={data} actions={actions} compact />}
          {view === "calendar" && <CalendarView data={data} actions={actions} mini />}
          {view === "events" && <EventsPanel data={data} actions={actions} />}
          {view === "people" && <PeoplePanel data={data} actions={actions} />}
          {view === "cards" && <CardsPanel data={data} actions={actions} />}
          {cat && <CategoryPanel cat={cat} data={data} actions={actions} />}
        </div>
      )}
    </section>
  );
}

function CategoryPanel({ cat, data, actions }: { cat: string; data: Data; actions: Actions }) {
  const [quick, setQuick] = useState("");
  const items = data.tasks.filter((t) => t.status === "open" && t.category === cat).sort(byDue);
  const recurring = items.filter((t) => t.repeat !== "none" && t.amount != null);
  const perMonth = recurring.reduce((s, t) => s + monthlyCost(t.amount!, t.repeat, t.repeatEvery), 0);
  const label = categoryInfo(cat).label;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    await actions.addTask({ title, category: cat });
  }

  return (
    <>
      {(cat === "subscription" || cat === "payment") && recurring.length > 0 && (
        <p className="panel-summary">
          <strong>{money(perMonth)}</strong>/month · {money(perMonth * 12)}/year
        </p>
      )}
      {items.length ? (
        <ul className="plain-list">
          {items.map((t) => (
            <TaskRow key={t.id} task={t} now={data.now} tz={data.tz} compact hideCategory onToggle={() => actions.toggleTask(t)} onOpen={() => actions.openTask(t)} />
          ))}
        </ul>
      ) : (
        <p className="muted small panel-empty">Nothing open in {label}.</p>
      )}
      <form className="inline-add" onSubmit={add}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Add to ${label}…`} aria-label={`Add a task to ${label}`} enterKeyHint="done" />
        {quick.trim() && (
          <button type="button" className="link" onClick={() => { actions.newTask({ title: quick.trim(), category: cat }); setQuick(""); }}>
            Details
          </button>
        )}
      </form>
    </>
  );
}

function EventsPanel({ data, actions }: { data: Data; actions: Actions }) {
  const upcoming = data.events.filter((e) => Date.parse(e.startsAt) > data.now.getTime() - 60 * 60_000 || localDateKey(new Date(e.startsAt), data.tz) >= localDateKey(data.now, data.tz)).slice(0, 12);
  if (!upcoming.length) return <p className="muted small panel-empty">No upcoming events.</p>;
  return (
    <ul className="plain-list">
      {upcoming.map((e) => {
        const start = new Date(e.startsAt);
        return (
          <li key={e.id} className="mini-row">
            <button onClick={() => actions.openEvent(e)}>
              <span className="mini-title">{e.title}</span>
              <span className="mini-meta">
                {formatDateKey(localDateKey(start, data.tz))}
                {!e.allDay && ` · ${start.toLocaleTimeString("en-US", { timeZone: data.tz, hour: "numeric", minute: "2-digit" })}`} · {relativeDue(start, data.now, data.tz, e.allDay)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PeoplePanel({ data, actions }: { data: Data; actions: Actions }) {
  const today = localDateKey(data.now, data.tz);
  const people = [...data.contacts]
    .map((c) => ({ c, due: contactDueOn(c) }))
    .sort((a, b) => (a.due ?? "0000") .localeCompare(b.due ?? "0000"));
  if (!people.length) return <p className="muted small panel-empty">No one added yet.</p>;
  return (
    <ul className="plain-list">
      {people.map(({ c, due }) => {
        const days = due ? daysBetween(today, due) : null;
        const text = days == null ? "Not logged yet" : days < 0 ? `${-days}d overdue` : days === 0 ? "Due today" : `In ${days}d`;
        return (
          <li key={c.id} className="mini-row with-action">
            <button onClick={() => actions.openContact(c)}>
              <span className="mini-title">{c.name}</span>
              <span className="mini-meta">
                <span className={days == null || days <= 0 ? (days != null && days < 0 ? "danger" : "warn") : ""}>{text}</span> · {capitalize(frequencyLabel(c.everyDays).toLowerCase())}
              </span>
            </button>
            {c.lastContactOn !== today && (
              <button className="panel-btn text" onClick={() => actions.logContact(c)} title="Log that you reached out today">
                ✓ Done
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CardsPanel({ data, actions }: { data: Data; actions: Actions }) {
  const today = localDateKey(data.now, data.tz);
  const active = data.cards.filter((c) => c.status === "active");
  if (!active.length) return <p className="muted small panel-empty">No gift cards.</p>;
  const total = active.reduce((s, c) => s + c.balance, 0);
  return (
    <>
      <p className="panel-summary">
        <strong>{money(total)}</strong> left to spend
      </p>
      <ul className="plain-list">
        {active.map((c) => {
          const days = c.expiresOn ? daysBetween(today, c.expiresOn) : null;
          return (
            <li key={c.id} className="mini-row with-action">
              <button onClick={() => actions.openCard(c)}>
                <span className="mini-title">{c.store}</span>
                <span className="mini-meta">
                  <span className={days != null && days <= 7 ? "danger" : days != null && days <= 30 ? "warn" : ""}>
                    {days == null ? "No expiry" : days < 0 ? "Expired" : `Expires in ${days}d`}
                  </span>
                  {c.location && ` · ${c.location}`}
                </span>
              </button>
              <button className="panel-btn text" onClick={() => actions.openCard(c, true)} title="Spend">
                {money(c.balance)}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
