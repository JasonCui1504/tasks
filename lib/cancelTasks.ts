import { getDb } from "./db";
import { createTask, getTask, updateTask, deleteTask } from "./tasks";
import { formatDateKey, localDateKey, zonedToUtc } from "./time";
import type { Booking, Task, TripItinerary } from "./types";

// Free-cancellation deadlines become real tasks in Trips, marked Critical (so they
// reach the Urgent callout), reminding a day before. They come from bookings
// entered here (cancel_by) and from "Last day to cancel free" items on the
// travel.jascui.com itineraries. task_sources remembers which task each deadline
// made, so a moved deadline moves its task, and a task you delete or tick off
// is never made again. The travel app is only read.

export type CancelDeadline = {
  /** Stable id: "cancel:booking:<id>" or "cancel:trip:<tripId>:<name>". */
  source: string;
  /** What can be cancelled, e.g. "Rosen Inn Closest to Universal". */
  name: string;
  /** Last day to cancel for free, "YYYY-MM-DD". */
  date: string;
  tripId: number | null;
  /** Booking id when it came from a booking entered here. */
  bookingId: number | null;
};

const PREFIX = /^(Last day to cancel( free)?|Free cancellation ends|Cancel by):\s*/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every free-cancellation deadline, past or future, one per booking. */
export function cancelDeadlines(bookings: Booking[], itineraries: TripItinerary[] | null): CancelDeadline[] {
  const out: CancelDeadline[] = [];
  for (const b of bookings) {
    if (!b.cancelBy || b.status !== "booked") continue;
    const name = [b.name, b.number].filter(Boolean).join(" ") || [b.from, b.to].filter(Boolean).join(" → ") || "booking";
    out.push({ source: `cancel:booking:${b.id}`, name, date: b.cancelBy, tripId: b.tripId, bookingId: b.id });
  }
  const seen = new Set<string>();
  for (const it of itineraries ?? []) {
    for (const i of it.items) {
      if (i.kind !== "deadline") continue;
      const name = i.title.replace(PREFIX, "").trim() || i.title;
      const source = `cancel:trip:${it.id}:${norm(name)}`;
      if (seen.has(source)) continue;
      seen.add(source);
      // The same hotel entered here too: keep the booking's task only.
      const dup = out.some(
        (d) => d.bookingId != null && d.date === i.date && (norm(name).includes(norm(d.name)) || norm(d.name).includes(norm(name))),
      );
      if (!dup) out.push({ source, name, date: i.date, tripId: it.id, bookingId: null });
    }
  }
  return out;
}

/** The task a deadline makes: Trips, Critical, all-day on the date, reminding a day before. */
export function cancelTaskInput(d: CancelDeadline, tz: string) {
  const [y, m, day] = d.date.split("-").map(Number);
  return {
    title: `Last day to cancel: ${d.name}`,
    notes: `Free cancellation ends ${formatDateKey(d.date)}.`,
    category: "trip",
    urgency: 3 as const,
    dueAt: zonedToUtc(y, m, day, 9, 0, tz).toISOString(), // all-day tasks are stored at 9:00 local
    allDay: true,
    reminders: [1440],
    tripId: d.tripId,
  };
}

/**
 * Bring the deadline tasks in line. `itineraries` is null when they couldn't be
 * read: then travel deadlines are left alone. Returns whether any task changed.
 */
export async function syncCancelTasks(
  owner: string,
  bookings: Booking[],
  itineraries: TripItinerary[] | null,
  tz: string,
  now = new Date(),
): Promise<boolean> {
  const db = await getDb();
  const today = localDateKey(now, tz);
  const deadlines = cancelDeadlines(bookings, itineraries);
  const rs = await db.execute({ sql: "SELECT source, task_id, due_on FROM task_sources WHERE owner = ? AND source LIKE 'cancel:%'", args: [owner] });
  const known = new Map(rs.rows.map((r) => [String(r.source), { taskId: Number(r.task_id), dueOn: String(r.due_on) }]));
  let changed = false;

  for (const d of deadlines) {
    const row = known.get(d.source);
    if (!row) {
      if (d.date < today) continue; // already passed: nothing to do
      const task = await createTask(owner, cancelTaskInput(d, tz));
      await db.execute({
        sql: "INSERT OR REPLACE INTO task_sources (owner, source, task_id, due_on) VALUES (?, ?, ?, ?)",
        args: [owner, d.source, task.id, d.date],
      });
      changed = true;
    } else if (row.dueOn !== d.date) {
      // The deadline moved: move its task (if it's still open).
      const task = await getTask(owner, row.taskId);
      if (task?.status === "open") {
        await updateTask(owner, task.id, { dueAt: cancelTaskInput(d, tz).dueAt, notes: cancelTaskInput(d, tz).notes });
        changed = true;
      }
      await db.execute({ sql: "UPDATE task_sources SET due_on = ? WHERE owner = ? AND source = ?", args: [d.date, owner, d.source] });
    }
  }

  // Deadlines that went away (booking deleted, cancelled or its date cleared; gone from a trip
  // that was read fine): drop their task if it's still open.
  const current = new Set(deadlines.map((d) => d.source));
  const readTrips = new Set((itineraries ?? []).filter((i) => !i.error).map((i) => i.id));
  for (const [source, row] of known) {
    if (current.has(source)) continue;
    const trip = source.match(/^cancel:trip:(\d+):/);
    if (trip && !readTrips.has(Number(trip[1]))) continue;
    const task: Task | null = await getTask(owner, row.taskId);
    if (task?.status === "open") {
      await deleteTask(owner, task.id);
      changed = true;
    }
    await db.execute({ sql: "DELETE FROM task_sources WHERE owner = ? AND source = ?", args: [owner, source] });
  }
  return changed;
}
