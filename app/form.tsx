"use client";

import { useEffect, useState } from "react";

/** "YYYY-MM-DD" and "HH:MM" in the device's zone. */
export function splitLocal(iso: string | null, allDay: boolean): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = allDay ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

/** Close on Escape and stop the page behind a sheet from scrolling. */
export function useSheet(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("locked");
    };
  }, [onClose]);
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    // A div, not a label: a label would forward stray taps to its first chip.
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">
        {label}
        {hint && <span className="muted"> · {hint}</span>}
      </span>
      {children}
    </div>
  );
}

/** A small month grid: click a day to pick it ("YYYY-MM-DD"). */
export function MiniMonth({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const todayKey = splitLocal(new Date().toISOString(), true).date;
  const [month, setMonth] = useState(() => (value || todayKey).slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const key = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="mini-month" role="group" aria-label="Pick a date">
      <div className="mini-month-head">
        <button type="button" className="panel-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong>{first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</strong>
        <button type="button" className="panel-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="mini-month-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="mini-month-dow">{d}</span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const k = key(i + 1);
          return (
            <button
              type="button"
              key={k}
              className={`${k === value ? "on" : ""} ${k === todayKey ? "today" : ""} ${k < todayKey ? "past" : ""}`}
              onClick={() => onPick(k)}
              aria-pressed={k === value}
              aria-label={new Date(k + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
