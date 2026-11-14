"use client";

import { useState } from "react";
import { buildBrief, type BriefItem, type BriefMode } from "@/lib/brief";
import { money } from "@/lib/time";
import { useSheet } from "./form";
import type { Actions, Data } from "./shared";

// The daily summary in the app: the same brief the 9 AM / 9 PM notification sums up
// (lib/brief.ts), with every line tappable. A box view, and the sheet a
// summary notification opens (/?brief=morning|evening).

export function defaultBriefMode(now: Date, tz: string): BriefMode {
  const h = Number(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }));
  return h >= 15 ? "evening" : "morning";
}

function open(item: BriefItem, data: Data, actions: Actions) {
  const { kind, id } = item.ref;
  if (kind === "task") {
    const t = data.tasks.find((x) => x.id === id);
    if (t) actions.openTask(t);
  } else if (kind === "event") {
    const e = data.events.find((x) => x.id === id);
    if (e) actions.openEvent(e);
  } else if (kind === "card") {
    const c = data.cards.find((x) => x.id === id);
    if (c) actions.openCard(c);
  } else if (kind === "person") {
    const c = data.contacts.find((x) => x.id === id);
    if (c) actions.openContact(c);
  } else if (kind === "booking") {
    const b = data.bookings.find((x) => x.id === id);
    if (b) actions.openBooking(b);
  } else {
    actions.goTab("trips", { trip: id });
  }
}

export function BriefView({ data, actions, mode: fixed, onPicked }: { data: Data; actions: Actions; mode?: BriefMode; onPicked?: () => void }) {
  const [picked, setPicked] = useState<BriefMode | null>(null);
  const mode = picked ?? fixed ?? defaultBriefMode(data.now, data.tz);
  const brief = buildBrief(data, mode);

  return (
    <div className="brief">
      <div className="seg" role="group" aria-label="Summary">
        <button className={mode === "morning" ? "on" : ""} onClick={() => setPicked("morning")}>Morning</button>
        <button className={mode === "evening" ? "on" : ""} onClick={() => setPicked("evening")}>Evening</button>
      </div>
      {brief.empty && (
        <p className="muted small panel-empty">
          {mode === "morning" ? "Nothing due today and nothing coming up this week." : "All clear today, and nothing coming up tomorrow."}
        </p>
      )}
      {brief.sections.map((s) => (
        <section key={s.key} className="brief-section">
          <h4 className={s.key === "overdue" ? "danger" : ""}>
            {s.label} <span className="muted">{s.items.length}</span>
            {s.total ? <span className="brief-total">{money(s.total)}</span> : null}
          </h4>
          <ul className="plain-list">
            {s.items.map((i) => (
              <li key={`${i.ref.kind}${i.ref.id}${i.text}`} className="mini-row">
                <button
                  onClick={() => {
                    onPicked?.();
                    open(i, data, actions);
                  }}
                >
                  <span className="mini-title">{i.text}</span>
                  <span className={`mini-meta ${i.tone ?? ""}`}>{i.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The summary as a sheet, opened from a summary notification. */
export function BriefSheet({ data, actions, mode, onClose }: { data: Data; actions: Actions; mode: BriefMode; onClose: () => void }) {
  useSheet(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Daily summary">
        <div className="sheet-head">
          <span />
          <strong>{mode === "morning" ? "Morning summary" : "Evening summary"}</strong>
          <button type="button" className="link strong" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-body">
          <BriefView data={data} actions={actions} mode={mode} onPicked={onClose} />
        </div>
      </div>
    </div>
  );
}
