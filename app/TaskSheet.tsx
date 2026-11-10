"use client";

import { useEffect, useState } from "react";
import { formatDateKey } from "@/lib/time";
import { Field, MiniMonth, splitLocal } from "./form";
import {
  REMINDER_PRESETS,
  REPEATS,
  URGENCIES,
  categoryInfo,
  defaultReminders,
  type RepeatUnit,
  type Task,
  type TaskInput,
  type Trip,
  type Urgency,
} from "@/lib/types";

type Props = {
  task: Task | null;
  draft?: TaskInput;
  trips: Trip[];
  categories: string[];
  tz: string;
  onClose: () => void;
  onSave: (input: TaskInput, existing: Task | null) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onSnooze: (task: Task, minutes: number) => Promise<void>;
  onComplete: (task: Task) => Promise<void>;
};

const ALL_DAY_HOUR = "09:00";

function localInput(iso: string | null): string {
  if (!iso) return "";
  const { date, time } = splitLocal(iso, false);
  return `${date}T${time}`;
}

export default function TaskSheet({ task, draft, trips, categories, onClose, onSave, onDelete, onSnooze, onComplete }: Props) {
  const init = task ?? null;
  const initialCategory = init?.category ?? draft?.category ?? "personal";
  const due = splitLocal(init?.dueAt ?? draft?.dueAt ?? null, init?.allDay ?? true);

  const [title, setTitle] = useState(init?.title ?? draft?.title ?? "");
  const [category, setCategory] = useState(initialCategory);
  const [customCategory, setCustomCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [urgency, setUrgency] = useState<Urgency>(init?.urgency ?? draft?.urgency ?? 1);
  const [date, setDate] = useState(due.date);
  const [time, setTime] = useState(due.time);
  const [picking, setPicking] = useState(false);
  const [repeat, setRepeat] = useState<RepeatUnit>(init?.repeat ?? draft?.repeat ?? "none");
  const [repeatEvery, setRepeatEvery] = useState(init?.repeatEvery ?? 1);
  const [autoRenew, setAutoRenew] = useState(init?.autoRenew ?? false);
  const [amount, setAmount] = useState(init?.amount != null ? String(init.amount) : "");
  const [showAmount, setShowAmount] = useState(false);
  const [reminders, setReminders] = useState<number[]>(init?.reminders ?? defaultReminders(initialCategory));
  const [remindersTouched, setRemindersTouched] = useState(Boolean(init));
  const [remindAt, setRemindAt] = useState(localInput(init?.remindAt ?? null));
  const [tripId, setTripId] = useState<number | null>(init?.tripId ?? draft?.tripId ?? null);
  const [notes, setNotes] = useState(init?.notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("locked");
    };
  }, [onClose]);

  function pickCategory(id: string) {
    setCategory(id);
    // New tasks pick up sensible reminders for the kind of thing they are, until you choose your own.
    if (!remindersTouched) setReminders(defaultReminders(id));
    if (!init && (id === "subscription" || id === "payment") && repeat === "none") {
      setRepeat("month");
      if (id === "subscription") setAutoRenew(true);
    }
  }

  function toggleReminder(m: number) {
    setRemindersTouched(true);
    setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m].sort((a, b) => b - a)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const finalCategory = addingCategory ? customCategory.trim().toLowerCase() || category : category;
    const dueAt = date ? new Date(`${date}T${time || ALL_DAY_HOUR}`).toISOString() : null;
    if (!title.trim()) return setError("Give it a title.");
    if (repeat !== "none" && !dueAt) return setError("A repeating task needs a date to repeat from.");
    setBusy(true);
    setError("");
    try {
      await onSave(
        {
          title: title.trim(),
          category: finalCategory,
          urgency,
          dueAt,
          allDay: !time,
          repeat,
          repeatEvery,
          autoRenew: repeat !== "none" && autoRenew,
          amount: amount === "" ? null : Number(amount),
          reminders,
          remindAt: remindAt ? new Date(remindAt).toISOString() : null,
          tripId: tripId,
          notes,
        },
        init,
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const money = showAmount || category === "payment" || category === "subscription" || amount !== "";

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={submit} aria-label={init ? "Edit task" : "New task"}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <strong>{init ? "Edit task" : "New task"}</strong>
          <button className="link strong" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="sheet-body">
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus={!init}
            aria-label="Title"
          />

          <Field label="Category">
            <div className="chips wrap">
              {categories.map((id) => {
                const info = categoryInfo(id);
                return (
                  <button type="button" key={id} className={`chip ${category === id && !addingCategory ? "active" : ""}`} onClick={() => { setAddingCategory(false); pickCategory(id); }}>
                    <span className="dot" style={{ background: info.color }} />
                    {info.label}
                  </button>
                );
              })}
              {addingCategory ? (
                <input className="chip-input" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="New category" autoFocus />
              ) : (
                <button type="button" className="chip" onClick={() => setAddingCategory(true)}>+ New</button>
              )}
            </div>
          </Field>

          <Field label="Urgency">
            <div className="seg full" role="radiogroup">
              {URGENCIES.map((u) => (
                <button type="button" key={u.value} role="radio" aria-checked={urgency === u.value} className={`${urgency === u.value ? "on" : ""} u${u.value}`} onClick={() => setUrgency(u.value)}>
                  <span className={`udot u${u.value}`} />
                  {u.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="row2">
            <Field label="Due date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time" hint={date && !time ? "All day" : undefined}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
            </Field>
          </div>
          <div className="quick-dates">
            {([["Today", 0], ["Tomorrow", 1], ["In a week", 7]] as const).map(([label, days]) => {
              const d = new Date();
              d.setDate(d.getDate() + days);
              const k = splitLocal(d.toISOString(), true).date;
              return (
                <button type="button" key={label} className={`chip ${date === k ? "active" : ""}`} onClick={() => { setDate(k); setPicking(false); }}>
                  {label}
                </button>
              );
            })}
            <button type="button" className={`chip ${picking ? "active" : ""}`} onClick={() => setPicking(!picking)} aria-expanded={picking}>
              Pick a date
            </button>
            {date && <button type="button" className="link" onClick={() => { setDate(""); setTime(""); setPicking(false); }}>Clear date</button>}
            {date && time && <button type="button" className="link" onClick={() => setTime("")}>Make all-day</button>}
          </div>
          {picking && <MiniMonth value={date} onPick={(k) => { setDate(k); setPicking(false); }} />}

          <div className="row2">
            <Field label="Repeat">
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatUnit)}>
                {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            {repeat !== "none" && (
              <Field label="Every">
                <div className="inline">
                  <input type="number" min={1} max={365} value={repeatEvery} onChange={(e) => setRepeatEvery(Math.max(1, Number(e.target.value) || 1))} />
                  <span className="muted">{REPEATS.find((r) => r.value === repeat)?.noun}{repeatEvery > 1 ? "s" : ""}</span>
                </div>
              </Field>
            )}
          </div>
          {repeat !== "none" && (
            <label className="toggle block">
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              <span>
                Renews on its own
                <span className="muted small"> — rolls to the next date automatically (subscriptions, autopay). Otherwise it waits for you to tick it off.</span>
              </span>
            </label>
          )}

          {money ? (
            <Field label={category === "subscription" ? "Price" : "Amount"}>
              <div className="inline">
                <span className="muted">$</span>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </Field>
          ) : (
            <button type="button" className="link" onClick={() => setShowAmount(true)}>+ Add an amount</button>
          )}

          <Field label="Remind me" hint={!date ? "Reminders count back from the due date" : undefined}>
            <div className="chips wrap">
              {REMINDER_PRESETS.map((p) => (
                <button type="button" key={p.minutes} className={`chip ${reminders.includes(p.minutes) ? "active" : ""}`} onClick={() => toggleReminder(p.minutes)} disabled={!date}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Also remind me at" hint="A one-off reminder at a set moment">
            <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </Field>

          {trips.length > 0 && (
            <Field label="Trip" hint="Links it to a trip on travel.jascui.com">
              <select value={tripId ?? ""} onChange={(e) => setTripId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {formatDateKey(t.startDate)}</option>
                ))}
                {tripId != null && !trips.some((t) => t.id === tripId) && <option value={tripId}>Past trip</option>}
              </select>
            </Field>
          )}

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Links, account numbers, details…" />
          </Field>

          {error && <p className="error">{error}</p>}

          {init && (
            <div className="sheet-foot">
              {init.status === "open" && (
                <>
                  <div className="snooze">
                    <span className="muted small">Snooze</span>
                    <button type="button" className="chip" onClick={() => onSnooze(init, 60)}>1 hour</button>
                    <button type="button" className="chip" onClick={() => onSnooze(init, 24 * 60)}>1 day</button>
                    <button type="button" className="chip" onClick={() => onSnooze(init, 7 * 24 * 60)}>1 week</button>
                  </div>
                  <button type="button" className="btn" onClick={() => onComplete(init)}>
                    {init.repeat !== "none" ? "Done — move to next date" : "Mark done"}
                  </button>
                </>
              )}
              <button type="button" className="btn danger-text" onClick={() => confirm(`Delete “${init.title}”?`) && onDelete(init)}>
                Delete
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

