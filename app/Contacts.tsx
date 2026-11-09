"use client";

import { useEffect, useMemo, useState } from "react";
import { daysBetween, formatDateKey, localDateKey } from "@/lib/time";
import { CONTACT_FREQUENCIES, contactDueOn, frequencyLabel, type Contact, type ContactInput, type ContactLog } from "@/lib/types";
import { api } from "./api-client";
import { Field, splitLocal, useSheet } from "./form";

function agoText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `over a year ago`;
}

/** Days until due (negative = overdue), or null when never logged. */
export function daysUntilDue(c: Contact, today: string): number | null {
  const due = contactDueOn(c);
  return due ? daysBetween(today, due) : null;
}

function dueText(days: number | null): { text: string; tone: "" | "warn" | "danger" } {
  if (days == null) return { text: "Not logged yet", tone: "warn" };
  if (days < -6) return { text: `${agoText(-days).replace(" ago", "")} overdue`, tone: "danger" };
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "warn" };
  if (days === 1) return { text: "Due tomorrow", tone: "" };
  return { text: days < 14 ? `Due in ${days} days` : `Due in ${Math.round(days / 7)} weeks`, tone: "" };
}

const todayKey = () => splitLocal(new Date().toISOString(), true).date;

type ViewProps = {
  contacts: Contact[];
  now: Date;
  tz: string;
  onOpen: (c: Contact) => void;
  onLog: (c: Contact) => void;
  onNew: () => void;
};

export function ContactsView({ contacts, now, tz, onOpen, onLog, onNew }: ViewProps) {
  const today = localDateKey(now, tz);

  const groups = useMemo(() => {
    const withDue = contacts.map((c) => ({ c, days: daysUntilDue(c, today) }));
    // Most overdue first; people never logged sit at the end of "Reach out".
    const rank = (d: number | null) => (d == null ? 0.5 : d);
    withDue.sort((a, b) => rank(a.days) - rank(b.days) || a.c.name.localeCompare(b.c.name));
    return [
      { key: "now", label: "Reach out", items: withDue.filter((x) => x.days == null || x.days <= 0) },
      { key: "soon", label: "Coming up", items: withDue.filter((x) => x.days != null && x.days > 0 && x.days <= 14) },
      { key: "later", label: "Later", items: withDue.filter((x) => x.days != null && x.days > 14) },
    ].filter((g) => g.items.length);
  }, [contacts, today]);

  const dueNow = contacts.filter((c) => {
    const d = daysUntilDue(c, today);
    return d == null || d <= 0;
  }).length;
  const week = contacts.filter((c) => {
    const d = daysUntilDue(c, today);
    return d != null && d > 0 && d <= 7;
  }).length;

  return (
    <>
      <section className="stats three" aria-label="Stay in touch summary">
        <div className={`stat static ${dueNow ? "critical" : ""}`}>
          <span className="stat-value">{dueNow}</span>
          <span className="stat-label">Reach out now</span>
        </div>
        <div className="stat static">
          <span className="stat-value">{week}</span>
          <span className="stat-label">This week</span>
        </div>
        <div className="stat static">
          <span className="stat-value">{contacts.length}</span>
          <span className="stat-label">{contacts.length === 1 ? "Person" : "People"}</span>
        </div>
      </section>

      {groups.length === 0 && (
        <div className="empty">
          <p>Add the people you want to keep up with — family, old friends, mentors — and how often. You&apos;ll get a nudge when it&apos;s been too long.</p>
          <button className="btn" onClick={onNew}>Add someone</button>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="group">
          <h2 className={g.key === "now" ? "danger" : ""}>
            {g.label} <span className="muted">{g.items.length}</span>
          </h2>
          <ul>
            {g.items.map(({ c, days }) => {
              const due = dueText(days);
              return (
                <li key={c.id} className={`task person-row ${due.tone === "danger" ? "u3" : ""}`}>
                  <span className="avatar" aria-hidden>{c.name.trim()[0]?.toUpperCase()}</span>
                  <button className="task-main" onClick={() => onOpen(c)}>
                    <span className="task-title">{c.name}</span>
                    <span className="task-meta">
                      <span className={due.tone}>{due.text}</span>
                      <span>
                        {c.lastContactOn ? `Last ${agoText(daysBetween(c.lastContactOn, today))} · ` : ""}
                        {frequencyLabel(c.everyDays).replace("Every ", "every ")}
                      </span>
                    </span>
                  </button>
                  <button className="btn small-btn" onClick={() => onLog(c)} disabled={c.lastContactOn === today} title="Log that you reached out today">
                    {c.lastContactOn === today ? "✓ Today" : "Reached out"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

type SheetProps = {
  contact: Contact | null;
  onClose: () => void;
  onSave: (input: ContactInput, existing: Contact | null) => Promise<void>;
  onDelete: (c: Contact) => Promise<void>;
  /** A catch-up was logged or removed from inside the sheet. */
  onChanged: (c: Contact) => void;
};

export function ContactSheet({ contact, onClose, onSave, onDelete, onChanged }: SheetProps) {
  useSheet(onClose);
  const [name, setName] = useState(contact?.name ?? "");
  const [everyDays, setEveryDays] = useState(contact?.everyDays ?? 30);
  const [custom, setCustom] = useState(contact ? !CONTACT_FREQUENCIES.some((f) => f.days === contact.everyDays) : false);
  const [lastOn, setLastOn] = useState("");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [log, setLog] = useState<ContactLog[] | null>(null);
  const [logOn, setLogOn] = useState(todayKey);
  const [logNote, setLogNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contact) return;
    api<{ log: ContactLog[] }>(`/api/contacts/${contact.id}`, "GET")
      .then((r) => setLog(r.log))
      .catch(() => setLog([]));
  }, [contact]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Who is it?");
    setBusy(true);
    setError("");
    try {
      await onSave({ name: name.trim(), everyDays, notes, ...(contact ? {} : { lastContactOn: lastOn || null }) }, contact);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function addLog() {
    if (!contact || !logOn) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ contact: Contact; logId: number }>(`/api/contacts/${contact.id}`, "PATCH", { action: "log", on: logOn, note: logNote });
      onChanged(r.contact);
      setLog((l) => [{ id: r.logId, contactId: contact.id, on: logOn, note: logNote.trim() }, ...(l ?? [])].sort((a, b) => b.on.localeCompare(a.on) || b.id - a.id));
      setLogNote("");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function removeLog(entry: ContactLog) {
    if (!contact) return;
    const r = await api<{ contact: Contact }>(`/api/contacts/${contact.id}`, "PATCH", { action: "unlog", logId: entry.id });
    onChanged(r.contact);
    setLog((l) => (l ?? []).filter((x) => x.id !== entry.id));
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={submit} aria-label={contact ? "Edit person" : "New person"}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>Cancel</button>
          <strong>{contact ? contact.name : "Stay in touch with…"}</strong>
          <button className="link strong" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>

        <div className="sheet-body">
          {contact && (
            <div className="card spend">
              <div className="setting-row">
                <span className="field-label">Log a catch-up</span>
                {contact.lastContactOn && <span className="muted small">Last: {formatDateKey(contact.lastContactOn)}</span>}
              </div>
              <div className="row2">
                <input type="date" value={logOn} max={todayKey()} onChange={(e) => setLogOn(e.target.value)} aria-label="When" />
                <input
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLog();
                    }
                  }}
                  placeholder="Called, texted, coffee…"
                  aria-label="Note"
                />
              </div>
              <button type="button" className="btn primary" onClick={addLog} disabled={busy || !logOn}>
                Log it
              </button>
            </div>
          )}

          <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus={!contact} aria-label="Name" />

          <Field label="Reach out">
            <div className="chips wrap">
              {CONTACT_FREQUENCIES.map((f) => (
                <button type="button" key={f.days} className={`chip ${!custom && everyDays === f.days ? "active" : ""}`} onClick={() => { setCustom(false); setEveryDays(f.days); }}>
                  {f.label}
                </button>
              ))}
              <button type="button" className={`chip ${custom ? "active" : ""}`} onClick={() => setCustom(true)}>Custom</button>
            </div>
            {custom && (
              <div className="inline">
                <span className="muted">Every</span>
                <input type="number" min={1} max={730} value={everyDays} onChange={(e) => setEveryDays(Math.max(1, Math.min(730, Number(e.target.value) || 1)))} />
                <span className="muted">days</span>
              </div>
            )}
          </Field>

          {!contact && (
            <Field label="Last reached out" hint={lastOn ? undefined : "optional"}>
              <input type="date" value={lastOn} max={todayKey()} onChange={(e) => setLastOn(e.target.value)} />
              <div className="quick-dates">
                <button type="button" className="chip" onClick={() => setLastOn(todayKey())}>Today</button>
                {lastOn && <button type="button" className="link" onClick={() => setLastOn("")}>Not sure</button>}
              </div>
            </Field>
          )}

          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Kids' names, what they're up to, things to ask about…" />
          </Field>

          {contact && (
            <Field label="History">
              {log == null ? (
                <p className="muted small">Loading…</p>
              ) : log.length === 0 ? (
                <p className="muted small">Nothing logged yet.</p>
              ) : (
                <ul className="history contact-history">
                  {log.map((entry) => (
                    <li key={entry.id}>
                      <span>
                        <strong>{formatDateKey(entry.on)}</strong>
                        {entry.note && <span className="muted"> · {entry.note}</span>}
                      </span>
                      <button type="button" className="link" aria-label="Remove" onClick={() => removeLog(entry)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}

          {error && <p className="error">{error}</p>}

          {contact && (
            <div className="sheet-foot">
              <span />
              <button type="button" className="btn danger-text" onClick={() => confirm(`Remove ${contact.name} and their history?`) && onDelete(contact)}>
                Delete
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
