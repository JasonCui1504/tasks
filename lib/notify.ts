import { getDb } from "./db";
import { sendToUser, type PushPayload } from "./push";
import { getSettings, listTasks } from "./tasks";
import { getTrips } from "./travel";
import { listBookings, listContacts, listEvents, listGiftCards } from "./lists";
import {
  daysBetween,
  formatDateKey,
  formatDue,
  localDateKey,
  money,
  nextOccurrenceAfter,
  relativeDue,
  zonedParts,
} from "./time";
import {
  GIFT_CARD_ALERT_DAYS,
  REPEATS,
  URGENCIES,
  bookingKind,
  CANCEL_ALERT_DAYS,
  categoryInfo,
  contactDueOn,
  frequencyLabel,
  type CalendarEvent,
  type Contact,
  type Booking,
  type GiftCard,
  type Settings,
  type Task,
  type Trip,
} from "./types";

// Decides which notifications are due right now and sends each exactly once.
// Runs from /api/cron every few minutes. Every decision is recorded in
// notification_log under a key (task + due date + which reminder), so a
// reminder never repeats, and editing a task's due date re-arms it.
//
// Rules:
// - Reminders fire at (due − offset). If several have come due since the last
//   run (e.g. the app was set up late), only the latest one is sent.
// - Reminders that were already in the past when the task was saved are skipped.
// - Overdue tasks nag: Critical every 4 hours, High once a day.
// - Quiet hours hold everything except Critical reminders until they end.
// - Repeating tasks set to auto-renew (subscriptions, autopay bills) roll
//   forward on their own once the date passes, with a "renewed" note.
// - Trips from travel.jascui.com get a heads-up 2 weeks, 3 days and 1 day out.
// - Events remind at (start − offset), like tasks.
// - Gift cards with money left get a heads-up 30, 7 and 1 day before they expire.
// - Tracked bookings with a free-cancellation date get a heads-up 7 and 2 days before, and on the day.
// - Stay in touch: a nudge the day someone is due, then once a week until you log it.
// - A morning summary lists what's due today and overdue, and today's events.

export type Candidate = { key: string; taskId: number | null; payload: PushPayload; critical: boolean };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TRIP_OFFSETS = [14, 3, 1]; // days before a trip starts

function inQuiet(hour: number, s: Settings): boolean {
  if (s.quietStart === s.quietEnd) return false;
  return s.quietStart < s.quietEnd
    ? hour >= s.quietStart && hour < s.quietEnd
    : hour >= s.quietStart || hour < s.quietEnd;
}

function taskUrl(t: Task): string {
  return `/?task=${t.id}`;
}

function amountText(t: Task): string {
  if (t.amount == null) return "";
  const per = t.repeat !== "none" ? `/${t.repeatEvery > 1 ? `${t.repeatEvery} ` : ""}${REPEATS.find((r) => r.value === t.repeat)?.noun}${t.repeatEvery > 1 ? "s" : ""}` : "";
  return `${money(t.amount)}${per}`;
}

function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/** The words for a reminder about a task that is due at `due`, seen at `now`. */
export function reminderMessage(t: Task, now: Date, tz: string, trips: Trip[]): { title: string; body: string } {
  const due = new Date(t.dueAt!);
  // Within half an hour either side (a cron run lands a few minutes late) it's simply "now".
  const near = Math.abs(due.getTime() - now.getTime()) < 30 * 60_000 && !t.allDay;
  const rel = near ? "now" : relativeDue(due, now, tz, t.allDay);
  const when = formatDue(due, tz, t.allDay);
  const urgency = t.urgency >= 2 ? `${URGENCIES[t.urgency].label} urgency` : "";
  const trip = t.tripId != null ? trips.find((x) => x.id === t.tripId) : undefined;
  const overdue = !near && due.getTime() < now.getTime() && rel !== "today";

  if (t.category === "payment") {
    return overdue
      ? { title: `Payment overdue: ${t.title}`, body: join(`Was due ${rel} (${when})`, amountText(t), "Pay it now to avoid late fees.") }
      : { title: `Payment due ${rel}: ${t.title}`, body: join(amountText(t), when, urgency) };
  }
  if (t.category === "subscription") {
    return overdue
      ? { title: `${t.title} renewed ${rel}`, body: join(amountText(t), "Mark it done to move it to the next renewal.") }
      : {
          title: `${t.title} renews ${rel}`,
          body: join(amountText(t), when, rel === "now" ? "" : "Cancel before then if you don't want it."),
        };
  }
  const prefix = trip ? `${trip.name} prep: ` : "";
  if (overdue) {
    return {
      title: `Needs attention: ${prefix}${t.title}`,
      body: join(`Overdue — was due ${rel} (${when})`, urgency, amountText(t)),
    };
  }
  const word = t.urgency >= 2 ? "Deadline" : "Due";
  return {
    title: rel === "now" ? `${prefix}${t.title} is due now` : `${word} ${rel}: ${prefix}${t.title}`,
    body: join(when, urgency, amountText(t), categoryInfo(t.category).label, t.notes && t.notes.slice(0, 80)),
  };
}

export function taskCandidates(t: Task, now: Date, s: Settings, trips: Trip[]): Candidate[] {
  const out: Candidate[] = [];
  const from = Date.parse(t.remindersFrom);
  const tag = `task-${t.id}`;
  const url = taskUrl(t);

  if (t.remindAt) {
    const at = Date.parse(t.remindAt);
    if (at <= now.getTime() && at >= from - 60_000) {
      const due = t.dueAt ? ` — due ${relativeDue(new Date(t.dueAt), now, s.timeZone, t.allDay)}` : "";
      out.push({
        key: `c:${t.id}:${t.remindAt}`,
        taskId: t.id,
        critical: t.urgency === 3,
        payload: { title: `Reminder: ${t.title}`, body: join(`You asked to be reminded about this${due}`, amountText(t)), url, tag },
      });
    }
  }

  if (!t.dueAt) return out;
  const due = Date.parse(t.dueAt);

  // Scheduled reminders: the latest that has come due, provided it wasn't already past when set.
  const fired = t.reminders
    .map((m) => ({ m, at: due - m * 60_000 }))
    .filter((r) => r.at <= now.getTime() && r.at >= from - 60_000)
    .sort((a, b) => b.at - a.at);
  if (fired.length) {
    const msg = reminderMessage(t, now, s.timeZone, trips);
    // Mark the earlier ones too, so a late run doesn't send them one by one afterwards.
    fired.forEach((r, i) =>
      out.push({
        key: `r:${t.id}:${t.dueAt}:${r.m}`,
        taskId: t.id,
        critical: t.urgency === 3,
        payload: i === 0 ? { ...msg, url, tag } : { title: "", body: "", url, tag: "skip" },
      }),
    );
  }

  // Overdue nagging for urgent things (subscriptions renew on their own, so they don't nag).
  if (t.category !== "subscription" && now.getTime() > due + HOUR && t.urgency >= 2) {
    const step = t.urgency === 3 ? 4 * HOUR : DAY;
    const n = Math.floor((now.getTime() - due) / step);
    if (n >= 1) {
      // A reminder sending this same run already says it's overdue; don't say it twice.
      for (const c of out) if (c.key.startsWith("r:")) c.payload = { title: "", body: "", url, tag: "skip" };
      out.push({
        key: `o:${t.id}:${t.dueAt}:${n}`,
        taskId: t.id,
        critical: false, // nags wait for quiet hours to end
        payload: { ...reminderMessage(t, now, s.timeZone, trips), url, tag },
      });
    }
  }
  return out;
}

function tripCandidates(trips: Trip[], tasks: Task[], now: Date, s: Settings): Candidate[] {
  const today = localDateKey(now, s.timeZone);
  const out: Candidate[] = [];
  for (const trip of trips) {
    const days = daysBetween(today, trip.startDate);
    if (days < 0) continue;
    const hit = TRIP_OFFSETS.filter((d) => days <= d).sort((a, b) => a - b);
    if (!hit.length) continue;
    const open = tasks.filter((t) => t.status === "open" && t.tripId === trip.id);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const prep = open.length
      ? `${open.length} prep task${open.length === 1 ? "" : "s"} still open: ${open
          .slice(0, 3)
          .map((t) => t.title)
          .join(", ")}${open.length > 3 ? "…" : ""}.`
      : "No open prep tasks.";
    hit.forEach((d, i) =>
      out.push({
        key: `t:${trip.id}:${trip.startDate}:${d}`,
        taskId: null,
        critical: false,
        payload:
          i === 0
            ? {
                title: `${trip.name} starts ${when}`,
                body: `${formatDateKey(trip.startDate)} – ${formatDateKey(trip.endDate)}. ${prep}`,
                url: `/?trip=${trip.id}`,
                tag: `trip-${trip.id}`,
              }
            : { title: "", body: "", url: "/", tag: "skip" },
      }),
    );
  }
  return out;
}

export function eventCandidates(e: CalendarEvent, now: Date, s: Settings): Candidate[] {
  const start = Date.parse(e.startsAt);
  const from = Date.parse(e.remindersFrom);
  const url = `/?event=${e.id}`;
  const tag = `event-${e.id}`;
  const fired = e.reminders
    .map((m) => ({ m, at: start - m * 60_000 }))
    .filter((r) => r.at <= now.getTime() && r.at >= from - 60_000 && now.getTime() < start + (e.allDay ? DAY : HOUR))
    .sort((a, b) => b.at - a.at);
  if (!fired.length) return [];
  const near = Math.abs(start - now.getTime()) < 30 * 60_000 && !e.allDay;
  const rel = near ? "now" : relativeDue(new Date(start), now, s.timeZone, e.allDay);
  const title = rel === "now" ? `${e.title} is starting` : `${e.title} ${rel === "today" ? "is today" : rel}`;
  const body = join(formatDue(new Date(start), s.timeZone, e.allDay), e.location, e.notes && e.notes.slice(0, 80));
  return fired.map((r, i) => ({
    key: `e:${e.id}:${e.startsAt}:${r.m}`,
    taskId: null,
    critical: false,
    payload: i === 0 ? { title, body, url, tag } : { title: "", body: "", url, tag: "skip" },
  }));
}

export function bookingCandidates(b: Booking, now: Date, s: Settings): Candidate[] {
  if (!b.cancelBy || b.status !== "booked") return [];
  const days = daysBetween(localDateKey(now, s.timeZone), b.cancelBy);
  if (days < 0) return [];
  const hit = CANCEL_ALERT_DAYS.filter((d) => days <= d).sort((a, b) => a - b);
  const label = [b.name, b.number].filter(Boolean).join(" ") || bookingKind(b.kind).label;
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return hit.map((d, i) => ({
    key: `b:${b.id}:${b.cancelBy}:${d}`,
    taskId: null,
    critical: false,
    payload:
      i === 0
        ? {
            title: `Last day to cancel ${label} ${days === 0 ? "is today" : when}`,
            body: `Free cancellation ends ${formatDateKey(b.cancelBy!)}.`,
            url: `/?booking=${b.id}`,
            tag: `booking-${b.id}`,
          }
        : { title: "", body: "", url: "/", tag: "skip" },
  }));
}

export function giftCardCandidates(c: GiftCard, now: Date, s: Settings): Candidate[] {
  if (c.status !== "active" || !c.expiresOn || c.balance <= 0) return [];
  const days = daysBetween(localDateKey(now, s.timeZone), c.expiresOn);
  if (days < 0) return [];
  const hit = GIFT_CARD_ALERT_DAYS.filter((d) => days <= d).sort((a, b) => a - b);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return hit.map((d, i) => ({
    key: `g:${c.id}:${c.expiresOn}:${d}`,
    taskId: null,
    critical: false,
    payload:
      i === 0
        ? {
            title: `${c.store} gift card expires ${when}`,
            body: `${money(c.balance)} left to spend by ${formatDateKey(c.expiresOn!)}.`,
            url: `/?card=${c.id}`,
            tag: `card-${c.id}`,
          }
        : { title: "", body: "", url: "/", tag: "skip" },
  }));
}

function agoText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function contactCandidates(c: Contact, now: Date, s: Settings): Candidate[] {
  const due = contactDueOn(c);
  if (!due || !c.lastContactOn) return []; // never logged: shown in the app, but no nagging
  const today = localDateKey(now, s.timeZone);
  const late = daysBetween(due, today);
  if (late < 0) return [];
  const week = Math.floor(late / 7);
  return [
    {
      key: `k:${c.id}:${due}:${week}`,
      taskId: null,
      critical: false,
      payload: {
        title: `Time to reach out to ${c.name}`,
        body: join(`Last time: ${formatDateKey(c.lastContactOn)} (${agoText(daysBetween(c.lastContactOn, today))})`, frequencyLabel(c.everyDays).toLowerCase()),
        url: `/?person=${c.id}`,
        tag: `person-${c.id}`,
      },
    },
  ];
}

function digestCandidate(
  tasks: Task[],
  trips: Trip[],
  now: Date,
  s: Settings,
  events: CalendarEvent[] = [],
  contacts: Contact[] = [],
): Candidate | null {
  if (s.digestHour == null) return null;
  const p = zonedParts(now, s.timeZone);
  if (p.h < s.digestHour || p.h >= s.digestHour + 3) return null;
  const today = localDateKey(now, s.timeZone);
  const open = tasks.filter((t) => t.status === "open" && t.dueAt);
  const overdue = open.filter((t) => localDateKey(new Date(t.dueAt!), s.timeZone) < today);
  const dueToday = open.filter((t) => localDateKey(new Date(t.dueAt!), s.timeZone) === today);
  const tripToday = trips.filter((t) => t.startDate === today);
  const eventsToday = events.filter((e) => localDateKey(new Date(e.startsAt), s.timeZone) === today);
  const reachOut = contacts.filter((c) => c.lastContactOn && contactDueOn(c)! <= today);
  if (!overdue.length && !dueToday.length && !tripToday.length && !eventsToday.length && !reachOut.length) return null;
  const head = [
    dueToday.length && `${dueToday.length} due today`,
    overdue.length && `${overdue.length} overdue`,
    tripToday.length && `${tripToday[0].name} starts today`,
    eventsToday.length &&
      (eventsToday.length === 1
        ? `${eventsToday[0].title}${eventsToday[0].allDay ? "" : ` at ${new Date(eventsToday[0].startsAt).toLocaleTimeString("en-US", { timeZone: s.timeZone, hour: "numeric", minute: "2-digit" })}`}`
        : `${eventsToday.length} events`),
    reachOut.length &&
      `reach out to ${reachOut
        .slice(0, 2)
        .map((c) => c.name)
        .join(" and ")}${reachOut.length > 2 ? ` +${reachOut.length - 2}` : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
  const items = [...overdue, ...dueToday]
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 4)
    .map((t) => (t.amount != null ? `${t.title} (${money(t.amount)})` : t.title));
  return {
    key: `d:${today}`,
    taskId: null,
    critical: false,
    payload: { title: `Today: ${head[0].toUpperCase() + head.slice(1)}`, body: items.join(", ") || "Have a good day.", url: "/", tag: "digest" },
  };
}

/** Roll auto-renewing repeating tasks past their date forward, returning the "renewed" notes. */
async function autoRenew(owner: string, tasks: Task[], now: Date, s: Settings): Promise<Candidate[]> {
  const db = await getDb();
  const out: Candidate[] = [];
  for (const t of tasks) {
    if (t.status !== "open" || !t.autoRenew || t.repeat === "none" || !t.dueAt) continue;
    // Give the "renews now" reminder a moment to go out first.
    if (Date.parse(t.dueAt) > now.getTime() - 30 * 60_000) continue;
    const next = nextOccurrenceAfter(t.dueAt, t.repeat, t.repeatEvery, s.timeZone, now);
    const nowIso = now.toISOString();
    await db.execute({
      sql: `UPDATE tasks SET due_at = ?, last_done_at = ?, reminders_from = ?, updated_at = ? WHERE owner = ? AND id = ?`,
      args: [next, t.dueAt, nowIso, nowIso, owner, t.id],
    });
    const verb = t.category === "payment" ? "paid (autopay)" : "renewed";
    out.push({
      key: `a:${t.id}:${t.dueAt}`,
      taskId: t.id,
      critical: false,
      payload: {
        title: `${t.title} ${verb}`,
        body: join(amountText(t), `Next: ${formatDue(new Date(next), s.timeZone, t.allDay)}`),
        url: taskUrl(t),
        tag: `task-${t.id}`,
      },
    });
  }
  return out;
}

async function owners(): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute("SELECT DISTINCT owner FROM push_subscriptions");
  return rs.rows.map((r) => String(r.owner));
}

export type RunResult = { owner: string; sent: number; held: number }[];

export async function runNotifications(now = new Date()): Promise<RunResult> {
  const db = await getDb();
  const trips = await getTrips();
  const result: RunResult = [];
  for (const owner of await owners()) {
    const s = await getSettings(owner);
    let tasks = await listTasks(owner);
    const renewed = await autoRenew(owner, tasks, now, s);
    if (renewed.length) tasks = await listTasks(owner);
    const open = tasks.filter((t) => t.status === "open");

    const [events, cards, contacts, bookings] = await Promise.all([listEvents(owner), listGiftCards(owner), listContacts(owner), listBookings(owner)]);

    const candidates: Candidate[] = [
      ...renewed,
      ...open.flatMap((t) => taskCandidates(t, now, s, trips)),
      ...(s.tripAlerts ? tripCandidates(trips, open, now, s) : []),
      ...events.flatMap((e) => eventCandidates(e, now, s)),
      ...cards.flatMap((c) => giftCardCandidates(c, now, s)),
      ...bookings.flatMap((b) => bookingCandidates(b, now, s)),
      ...contacts.flatMap((c) => contactCandidates(c, now, s)),
    ];
    const digest = digestCandidate(open, trips, now, s, events, contacts);
    if (digest) candidates.push(digest);

    // Overdue + due today, for the Home Screen icon badge.
    const today = localDateKey(now, s.timeZone);
    const badge = open.filter((t) => t.dueAt && localDateKey(new Date(t.dueAt), s.timeZone) <= today).length;
    const quiet = inQuiet(zonedParts(now, s.timeZone).h, s);
    let sent = 0;
    let held = 0;
    for (const c of candidates) {
      if (quiet && !c.critical) {
        held++;
        continue;
      }
      const skip = c.payload.tag === "skip";
      const ins = await db.execute({
        sql: `INSERT OR IGNORE INTO notification_log (owner, key, task_id, title, body, url, sent, sent_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [owner, c.key, c.taskId, c.payload.title, c.payload.body, c.payload.url, skip ? 0 : 1, now.toISOString()],
      });
      if (ins.rowsAffected === 1 && !skip) {
        await sendToUser(owner, { ...c.payload, badge });
        sent++;
      }
    }
    result.push({ owner, sent, held });
  }
  await db.execute({
    sql: "DELETE FROM notification_log WHERE sent_at < ?",
    args: [new Date(now.getTime() - 120 * DAY).toISOString()],
  });
  return result;
}
