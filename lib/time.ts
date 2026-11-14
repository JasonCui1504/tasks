// Time-zone aware date math without a library. Shared with the browser.

import type { RepeatUnit } from "./types";

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function zonedParts(date: Date, tz: string): Parts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(date)) if (type !== "literal") p[type] = Number(value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at a wall-clock time in a zone. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetMs(new Date(guess), tz);
  let t = guess - off;
  const off2 = offsetMs(new Date(t), tz);
  if (off2 !== off) t = guess - off2;
  return new Date(t);
}

/** "YYYY-MM-DD" for the local date of an instant. */
export function localDateKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Whole local days from a to b ("YYYY-MM-DD" strings). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/** Advance an instant by n repeat units, keeping its local wall-clock time. Months clamp to the last day. */
export function addRepeat(iso: string, unit: RepeatUnit, every: number, tz: string): string {
  if (unit === "none") return iso;
  const p = zonedParts(new Date(iso), tz);
  let { y, m, d } = p;
  const n = Math.max(1, Math.floor(every) || 1);
  if (unit === "day") d += n;
  else if (unit === "week") d += 7 * n;
  else {
    if (unit === "month") m += n;
    else y += n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    d = Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  const norm = new Date(Date.UTC(y, m - 1, d));
  return zonedToUtc(norm.getUTCFullYear(), norm.getUTCMonth() + 1, norm.getUTCDate(), p.h, p.mi, tz).toISOString();
}

/** The first occurrence strictly after `after`. */
export function nextOccurrenceAfter(iso: string, unit: RepeatUnit, every: number, tz: string, after: Date): string {
  let cur = iso;
  for (let i = 0; i < 2000 && Date.parse(cur) <= after.getTime(); i++) cur = addRepeat(cur, unit, every, tz);
  return cur;
}

/** Approximate monthly cost of something that repeats every `every` units. */
export function monthlyCost(amount: number, unit: RepeatUnit, every: number): number {
  const n = Math.max(1, every || 1);
  const perMonth = { none: 0, day: 30.44, week: 30.44 / 7, month: 1, year: 1 / 12 }[unit];
  return (amount * perMonth) / n;
}

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * A span of whole days, exact rather than rounded: "5 days", "3 weeks, 4 days",
 * "2 months, 1 week", "1 year, 2 months". Never rounds up.
 */
export function spanText(days: number): string {
  days = Math.abs(Math.trunc(days));
  if (days < 14) return plural(days, "day");
  if (days < 60) {
    const w = Math.floor(days / 7);
    const d = days % 7;
    return d ? `${plural(w, "week")}, ${plural(d, "day")}` : plural(w, "week");
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    const w = Math.floor((days - m * 30) / 7);
    return w ? `${plural(m, "month")}, ${plural(w, "week")}` : plural(m, "month");
  }
  const y = Math.floor(days / 365);
  const m = Math.floor((days - y * 365) / 30);
  return m ? `${plural(y, "year")}, ${plural(m, "month")}` : plural(y, "year");
}

/** "today", "tomorrow", "in 3 days", "in 2 weeks, 4 days", "yesterday", or hours/minutes when within the day. */
export function relativeDue(due: Date, now: Date, tz: string, allDay: boolean): string {
  const diff = due.getTime() - now.getTime();
  const days = daysBetween(localDateKey(now, tz), localDateKey(due, tz));
  if (!allDay && Math.abs(diff) < 12 * 3_600_000 && (days === 0 || Math.abs(diff) < 3 * 3_600_000)) {
    const mins = Math.floor(Math.abs(diff) / 60_000);
    if (mins < 1) return "now";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const amount = h === 0 ? `${m} min` : m ? `${plural(h, "hour")} ${m} min` : plural(h, "hour");
    return diff >= 0 ? `in ${amount}` : `${amount} ago`;
  }
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${spanText(days)}` : `${spanText(days)} ago`;
}

export function formatDue(due: Date, tz: string, allDay: boolean, withWeekday = true): string {
  const date = due.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: withWeekday ? "short" : undefined,
    month: "short",
    day: "numeric",
  });
  if (allDay) return date;
  const time = due.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function formatDateKey(key: string): string {
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
