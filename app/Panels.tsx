"use client";

import { useState } from "react";
import { daysBetween, formatDateKey, localDateKey, money, monthlyCost, relativeDue } from "@/lib/time";
import { categoryInfo, contactDueOn, frequencyLabel } from "@/lib/types";
import { byDue, capitalize, TaskRow, type Actions, type Data } from "./shared";

// Compact list views used inside workspace boxes.

export function CategoryPanel({ cat, data, actions }: { cat: string; data: Data; actions: Actions }) {
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

export function EventsPanel({ data, actions }: { data: Data; actions: Actions }) {
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

export function PeoplePanel({ data, actions }: { data: Data; actions: Actions }) {
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

export function CardsPanel({ data, actions }: { data: Data; actions: Actions }) {
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
