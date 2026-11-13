import type { Row } from "@libsql/client";
import { getDb } from "./db";
import { addRepeat, nextOccurrenceAfter, validTimeZone } from "./time";
import { REPEATS, type Settings, type Task, type TaskInput, type Urgency, type SentNotification } from "./types";

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function rowToTask(r: Row): Task {
  let reminders: number[] = [];
  try {
    reminders = JSON.parse(String(r.reminders));
  } catch {}
  return {
    id: Number(r.id),
    title: String(r.title),
    notes: String(r.notes ?? ""),
    category: String(r.category),
    urgency: Number(r.urgency) as Urgency,
    dueAt: str(r.due_at),
    allDay: Boolean(Number(r.all_day)),
    repeat: String(r.repeat_unit) as Task["repeat"],
    repeatEvery: Number(r.repeat_every) || 1,
    amount: r.amount == null ? null : Number(r.amount),
    reminders,
    remindAt: str(r.remind_at),
    tripId: r.trip_id == null ? null : Number(r.trip_id),
    autoRenew: Boolean(Number(r.auto_renew)),
    status: String(r.status) === "done" ? "done" : "open",
    completedAt: str(r.completed_at),
    lastDoneAt: str(r.last_done_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    remindersFrom: String(r.reminders_from),
    quietUntil: str(r.quiet_until),
  };
}

function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Validates and normalises client input. Throws a message string on bad input. */
export function cleanInput(body: Record<string, unknown>, partial: boolean): TaskInput {
  const out: TaskInput = {};
  if ("title" in body || !partial) {
    const title = String(body.title ?? "").trim().slice(0, 300);
    if (!title) throw "A task needs a title.";
    out.title = title;
  }
  if ("notes" in body) out.notes = String(body.notes ?? "").slice(0, 5000);
  if ("category" in body) out.category = String(body.category ?? "").trim().toLowerCase().slice(0, 40) || "personal";
  if ("urgency" in body) {
    const u = Number(body.urgency);
    out.urgency = (u >= 0 && u <= 3 ? Math.round(u) : 1) as Urgency;
  }
  if ("dueAt" in body) out.dueAt = isoOrNull(body.dueAt);
  if ("allDay" in body) out.allDay = Boolean(body.allDay);
  if ("repeat" in body) {
    const r = String(body.repeat);
    out.repeat = REPEATS.some((x) => x.value === r) ? (r as Task["repeat"]) : "none";
  }
  if ("repeatEvery" in body) out.repeatEvery = Math.min(365, Math.max(1, Math.round(Number(body.repeatEvery)) || 1));
  if ("amount" in body) {
    const a = body.amount === "" || body.amount == null ? null : Number(body.amount);
    out.amount = a == null || Number.isNaN(a) ? null : Math.round(a * 100) / 100;
  }
  if ("reminders" in body) {
    const list = Array.isArray(body.reminders) ? body.reminders : [];
    out.reminders = [...new Set(list.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 60 * 24 * 60))]
      .map(Math.round)
      .sort((a, b) => b - a);
  }
  if ("remindAt" in body) out.remindAt = isoOrNull(body.remindAt);
  if ("tripId" in body) {
    const t = body.tripId == null || body.tripId === "" ? null : Number(body.tripId);
    out.tripId = t == null || Number.isNaN(t) ? null : t;
  }
  if ("autoRenew" in body) out.autoRenew = Boolean(body.autoRenew);
  return out;
}

export async function listTasks(owner: string): Promise<Task[]> {
  const db = await getDb();
  // Open tasks, plus anything finished in the last 30 days for the "Done" view.
  const rs = await db.execute({
    sql: `SELECT * FROM tasks WHERE owner = ? AND (status = 'open' OR completed_at >= ?)
          ORDER BY due_at IS NULL, due_at, urgency DESC, id`,
    args: [owner, new Date(Date.now() - 30 * 86_400_000).toISOString()],
  });
  return rs.rows.map(rowToTask);
}

export async function getTask(owner: string, id: number): Promise<Task | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM tasks WHERE owner = ? AND id = ?", args: [owner, id] });
  return rs.rows.length ? rowToTask(rs.rows[0]) : null;
}

const COLUMNS: Record<keyof TaskInput, string> = {
  title: "title",
  notes: "notes",
  category: "category",
  urgency: "urgency",
  dueAt: "due_at",
  allDay: "all_day",
  repeat: "repeat_unit",
  repeatEvery: "repeat_every",
  amount: "amount",
  reminders: "reminders",
  remindAt: "remind_at",
  tripId: "trip_id",
  autoRenew: "auto_renew",
};

function dbValue(key: keyof TaskInput, v: unknown): string | number | null {
  if (v == null) return null;
  if (key === "reminders") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as string | number;
}

export async function createTask(owner: string, input: TaskInput): Promise<Task> {
  const db = await getDb();
  const now = new Date().toISOString();
  const keys = Object.keys(input) as (keyof TaskInput)[];
  const cols = keys.map((k) => COLUMNS[k]);
  const rs = await db.execute({
    sql: `INSERT INTO tasks (owner, ${cols.join(", ")}, reminders_from, created_at, updated_at)
          VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?) RETURNING *`,
    args: [owner, ...keys.map((k) => dbValue(k, input[k])), now, now, now],
  });
  return rowToTask(rs.rows[0]);
}

export async function updateTask(owner: string, id: number, input: TaskInput): Promise<Task | null> {
  const keys = Object.keys(input) as (keyof TaskInput)[];
  if (!keys.length) return getTask(owner, id);
  const db = await getDb();
  const now = new Date().toISOString();
  // Changing when it's due or how it reminds re-arms the reminders from now on.
  let rearm = keys.some((k) => k === "dueAt" || k === "reminders" || k === "remindAt");
  if (rearm) {
    // A save that leaves them as they were (the sheet sends every field) changes nothing.
    const before = await getTask(owner, id);
    const minute = (v: string | null | undefined) => (v ? Math.floor(Date.parse(v) / 60_000) : null);
    if (before)
      rearm =
        ("dueAt" in input && minute(input.dueAt) !== minute(before.dueAt)) ||
        ("reminders" in input && JSON.stringify([...(input.reminders ?? [])].sort()) !== JSON.stringify([...before.reminders].sort())) ||
        ("remindAt" in input && minute(input.remindAt) !== minute(before.remindAt));
  }
  const sets = keys.map((k) => `${COLUMNS[k]} = ?`);
  // …and brings back an acknowledged or deferred reminder.
  if (rearm) sets.push("reminders_from = ?", "quiet_until = NULL");
  const rs = await db.execute({
    sql: `UPDATE tasks SET ${sets.join(", ")}, updated_at = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [...keys.map((k) => dbValue(k, input[k])), ...(rearm ? [now] : []), now, owner, id],
  });
  return rs.rows.length ? rowToTask(rs.rows[0]) : null;
}

export async function deleteTask(owner: string, id: number): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM tasks WHERE owner = ? AND id = ?", args: [owner, id] });
}

/**
 * Tick a task off. A repeating task moves to its next occurrence and stays
 * open; anything else is marked done.
 */
export async function completeTask(owner: string, id: number, tz: string): Promise<Task | null> {
  const task = await getTask(owner, id);
  if (!task) return null;
  const db = await getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  if (task.repeat !== "none" && task.dueAt) {
    // Next occurrence after the one just done (or after today, if it was long overdue).
    let next = addRepeat(task.dueAt, task.repeat, task.repeatEvery, tz);
    if (Date.parse(next) < now.getTime()) next = nextOccurrenceAfter(next, task.repeat, task.repeatEvery, tz, now);
    const rs = await db.execute({
      sql: `UPDATE tasks SET due_at = ?, last_done_at = ?, remind_at = NULL, reminders_from = ?, quiet_until = NULL, updated_at = ?
            WHERE owner = ? AND id = ? RETURNING *`,
      args: [next, nowIso, nowIso, nowIso, owner, id],
    });
    return rowToTask(rs.rows[0]);
  }
  const rs = await db.execute({
    sql: `UPDATE tasks SET status = 'done', completed_at = ?, last_done_at = ?, updated_at = ?
          WHERE owner = ? AND id = ? RETURNING *`,
    args: [nowIso, nowIso, nowIso, owner, id],
  });
  return rowToTask(rs.rows[0]);
}

export async function reopenTask(owner: string, id: number): Promise<Task | null> {
  const db = await getDb();
  const now = new Date().toISOString();
  const rs = await db.execute({
    sql: `UPDATE tasks SET status = 'open', completed_at = NULL, reminders_from = ?, updated_at = ?
          WHERE owner = ? AND id = ? RETURNING *`,
    args: [now, now, owner, id],
  });
  return rs.rows.length ? rowToTask(rs.rows[0]) : null;
}

/**
 * Acknowledge a payment/subscription reminder. A repeating one moves to its
 * next date and stays greyed out and quiet until that date's first reminder
 * (or the date itself, with no reminders). A one-off one is marked done.
 */
export async function acknowledgeTask(owner: string, id: number, tz: string): Promise<Task | null> {
  const task = await completeTask(owner, id, tz);
  if (!task || task.status !== "open" || !task.dueAt) return task;
  const lead = Math.max(0, ...task.reminders);
  const back = Date.parse(task.dueAt) - lead * 60_000;
  if (back <= Date.now()) return task;
  const at = new Date(back).toISOString();
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE tasks SET quiet_until = ?, reminders_from = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [at, at, owner, id],
  });
  return rowToTask(rs.rows[0]);
}

/**
 * Defer a reminder: the date stays put, it goes quiet (greyed out, no
 * reminders or nags) for `minutes`, then a reminder fires.
 */
export async function deferTask(owner: string, id: number, minutes: number): Promise<Task | null> {
  const at = new Date(Date.now() + minutes * 60_000).toISOString();
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE tasks SET quiet_until = ?, reminders_from = ?, remind_at = ?, updated_at = ? WHERE owner = ? AND id = ? AND status = 'open' RETURNING *`,
    args: [at, at, at, new Date().toISOString(), owner, id],
  });
  return rs.rows.length ? rowToTask(rs.rows[0]) : null;
}

/** Bring an acknowledged or deferred reminder back now (keeps the date; reminders already past stay skipped). */
export async function unquietTask(owner: string, id: number): Promise<Task | null> {
  const now = new Date().toISOString();
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE tasks SET quiet_until = NULL, remind_at = CASE WHEN remind_at = quiet_until THEN NULL ELSE remind_at END,
            reminders_from = ?, updated_at = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [now, now, owner, id],
  });
  return rs.rows.length ? rowToTask(rs.rows[0]) : null;
}

/** Push a task's due date (and so its reminders) later. */
export async function snoozeTask(owner: string, id: number, minutes: number): Promise<Task | null> {
  const task = await getTask(owner, id);
  if (!task) return null;
  const now = Date.now();
  const base = task.dueAt && Date.parse(task.dueAt) > now ? Date.parse(task.dueAt) : now;
  return updateTask(owner, id, { dueAt: new Date(base + minutes * 60_000).toISOString(), allDay: false });
}

// ---- settings ----

const DEFAULT_SETTINGS: Settings = {
  timeZone: validTimeZone(process.env.DEFAULT_TIME_ZONE) ? process.env.DEFAULT_TIME_ZONE! : "America/New_York",
  quietStart: 22,
  quietEnd: 7,
  digestHour: 8,
  tripAlerts: true,
};

export async function getSettings(owner: string): Promise<Settings> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM settings WHERE owner = ?", args: [owner] });
  if (!rs.rows.length) return { ...DEFAULT_SETTINGS };
  const r = rs.rows[0];
  return {
    timeZone: validTimeZone(r.time_zone) ? String(r.time_zone) : DEFAULT_SETTINGS.timeZone,
    quietStart: Number(r.quiet_start),
    quietEnd: Number(r.quiet_end),
    digestHour: r.digest_hour == null ? null : Number(r.digest_hour),
    tripAlerts: Boolean(Number(r.trip_alerts)),
  };
}

export async function saveSettings(owner: string, patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings(owner);
  const hour = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
  };
  const next: Settings = {
    timeZone: validTimeZone(patch.timeZone) ? patch.timeZone : cur.timeZone,
    quietStart: "quietStart" in patch ? hour(patch.quietStart, cur.quietStart) : cur.quietStart,
    quietEnd: "quietEnd" in patch ? hour(patch.quietEnd, cur.quietEnd) : cur.quietEnd,
    digestHour:
      "digestHour" in patch ? (patch.digestHour == null ? null : hour(patch.digestHour, 8)) : cur.digestHour,
    tripAlerts: "tripAlerts" in patch ? Boolean(patch.tripAlerts) : cur.tripAlerts,
  };
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO settings (owner, time_zone, quiet_start, quiet_end, digest_hour, trip_alerts)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner) DO UPDATE SET time_zone = excluded.time_zone, quiet_start = excluded.quiet_start,
            quiet_end = excluded.quiet_end, digest_hour = excluded.digest_hour, trip_alerts = excluded.trip_alerts`,
    args: [owner, next.timeZone, next.quietStart, next.quietEnd, next.digestHour, next.tripAlerts ? 1 : 0],
  });
  return next;
}

export async function recentNotifications(owner: string, limit = 30): Promise<SentNotification[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT id, title, body, url, sent_at FROM notification_log
          WHERE owner = ? AND sent = 1 ORDER BY sent_at DESC, id DESC LIMIT ?`,
    args: [owner, limit],
  });
  return rs.rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    body: String(r.body),
    url: String(r.url),
    sentAt: String(r.sent_at),
  }));
}
