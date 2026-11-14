import { daysBetween, formatDateKey, localDateKey, money } from "./time";
import { bookingKind, contactDueOn, isQuiet, isReminderTask, isSubscription, isTodo, type Booking, type CalendarEvent, type Contact, type GiftCard, type Task, type Trip } from "./types";

// The daily brief: a summary of today and the week ahead, sent as a push at the
// morning and evening summary hours (lib/notify.ts) and shown in the app
// (app/Brief.tsx). Pure, so the server and the browser build the same thing.
//
// Morning: overdue, today, payments & renewals this week, coming up this week.
// Evening: what's left from today, tomorrow, payments & renewals, later this week.

export type BriefMode = "morning" | "evening";

export type BriefItem = {
  text: string;
  /** When, how much, where. */
  meta: string;
  /** What to open when tapped in the app. */
  ref: { kind: "task" | "event" | "card" | "person" | "booking" | "trip"; id: number };
  tone?: "danger" | "warn";
  /** Short day word for the notification ("Today", "Tomorrow", "Tue, Nov 18"). */
  day?: string;
  amount?: number | null;
  /** Local "YYYY-MM-DD" or "YYYY-MM-DD HH:MM", to put a section in time order. */
  at: string;
};

export type BriefSection = { key: string; label: string; items: BriefItem[]; total?: number };

export type Brief = { mode: BriefMode; title: string; sections: BriefSection[]; empty: boolean };

export type BriefInput = {
  tasks: Task[];
  events: CalendarEvent[];
  trips: Trip[];
  contacts: Contact[];
  cards: GiftCard[];
  bookings: Booking[];
  now: Date;
  tz: string;
};

const WEEK = 7;

function clock24(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function time(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** "Today", "Tomorrow", or "Tue, Nov 18" for a day `d` days after `today`. */
function dayWord(key: string, today: string): string {
  const d = daysBetween(today, key);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return d === -1 ? "Yesterday" : `${-d} days ago`;
  return formatDateKey(key);
}

function hhmm(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
}

export function buildBrief(input: BriefInput, mode: BriefMode): Brief {
  const { tasks, events, trips, contacts, cards, bookings, now, tz } = input;
  const today = localDateKey(now, tz);
  const keyOf = (iso: string) => localDateKey(new Date(iso), tz);
  const dayOf = (key: string) => daysBetween(today, key);
  // The window "the day" covers: today in the morning, tomorrow in the evening.
  const focus = mode === "morning" ? 0 : 1;

  const open = tasks.filter((t) => t.status === "open" && t.dueAt);
  const taskItem = (t: Task, tone?: BriefItem["tone"]): BriefItem => {
    const key = keyOf(t.dueAt!);
    // A subscription whose date just passed is about to roll forward: still "today".
    const day = isSubscription(t) && key < today ? "Today" : dayWord(key, today);
    const parts = [t.allDay ? day : `${day} ${time(t.dueAt!, tz)}`];
    if (t.amount != null) parts.push(money(t.amount));
    return { text: t.title, meta: parts.join(" · "), ref: { kind: "task", id: t.id }, tone, day, amount: t.amount, at: t.allDay ? key : `${key} ${clock24(t.dueAt!, tz)}` };
  };
  const byDue = (a: Task, b: Task) => (a.dueAt! < b.dueAt! ? -1 : a.dueAt! > b.dueAt! ? 1 : b.urgency - a.urgency);

  // To-dos (payments count as to-dos when overdue; otherwise they're in the money section).
  const todos = open.filter((t) => isTodo(t) && !isQuiet(t, now));
  // Same rule as the app's Overdue bucket: a past day, or a time today that has gone by.
  const overdue = todos.filter((t) => keyOf(t.dueAt!) < today || (!t.allDay && Date.parse(t.dueAt!) < now.getTime())).sort(byDue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const plainOn = (d: number) => todos.filter((t) => !isReminderTask(t) && !overdueIds.has(t.id) && dayOf(keyOf(t.dueAt!)) === d).sort(byDue);

  const eventsOn = (from: number, to: number) =>
    events
      .filter((e) => {
        const d = dayOf(keyOf(e.startsAt));
        return d >= from && d <= to && (e.allDay || Date.parse(e.startsAt) > now.getTime() - 60 * 60_000 || d > 0);
      })
      .map<BriefItem>((e) => {
        const key = keyOf(e.startsAt);
        const when = e.allDay ? dayWord(key, today) : `${dayWord(key, today)} ${time(e.startsAt, tz)}`;
        return { text: e.title, meta: [when, e.location].filter(Boolean).join(" · "), ref: { kind: "event", id: e.id }, at: e.allDay ? key : `${key} ${clock24(e.startsAt, tz)}` };
      });

  const tripsOn = (from: number, to: number) =>
    trips
      .filter((t) => dayOf(t.startDate) >= from && dayOf(t.startDate) <= to)
      .map<BriefItem>((t) => ({ text: `✈ ${t.name}`, meta: `Starts ${dayOf(t.startDate) <= 1 ? dayWord(t.startDate, today).toLowerCase() : dayWord(t.startDate, today)}`, ref: { kind: "trip", id: t.id }, at: t.startDate }));

  const reachOut = (d: number) =>
    contacts
      .filter((c) => {
        const due = contactDueOn(c);
        return due != null && (d === 0 ? due <= today : dayOf(due) === d);
      })
      .map<BriefItem>((c) => ({ text: `Reach out to ${c.name}`, meta: d === 0 ? "Due" : dayWord(contactDueOn(c)!, today), ref: { kind: "person", id: c.id }, at: d === 0 ? today : contactDueOn(c)! }));

  const bookingsOn = (from: number, to: number) =>
    bookings
      .filter((b) => b.status === "booked" && dayOf(b.startDate) >= from && dayOf(b.startDate) <= to)
      .map<BriefItem>((b) => ({
        text: `${bookingKind(b.kind).label}: ${[b.name, b.number].filter(Boolean).join(" ")}${b.to ? ` → ${b.to}` : ""}`,
        meta: [dayWord(b.startDate, today), b.startTime && hhmm(b.startTime)].filter(Boolean).join(" "),
        ref: { kind: "booking", id: b.id },
        at: b.startTime ? `${b.startDate} ${b.startTime}` : b.startDate,
      }));

  // Deadlines that cost money if missed: free cancellation and gift cards running out.
  const deadlines = (from: number, to: number): BriefItem[] => [
    ...bookings
      .filter((b) => b.cancelBy && dayOf(b.cancelBy) >= from && dayOf(b.cancelBy) <= to)
      .map<BriefItem>((b) => ({ text: `Free cancellation ends: ${b.name || bookingKind(b.kind).label}`, meta: dayWord(b.cancelBy!, today), ref: { kind: "booking", id: b.id }, tone: "warn", at: b.cancelBy! })),
    ...cards
      .filter((c) => c.status === "active" && c.balance > 0 && c.expiresOn && dayOf(c.expiresOn) >= from && dayOf(c.expiresOn) <= to)
      .map<BriefItem>((c) => ({ text: `${c.store} gift card expires`, meta: `${dayWord(c.expiresOn!, today)} · ${money(c.balance)} left`, ref: { kind: "card", id: c.id }, tone: "warn", at: c.expiresOn! })),
  ];

  // Payments and subscription renewals in the next week (overdue payments are under Overdue).
  // A payment due today still shows in the evening; a subscription that renewed today doesn't.
  const bills = open
    .filter((t) => isReminderTask(t) && !overdueIds.has(t.id))
    .filter((t) => {
      const d = dayOf(keyOf(t.dueAt!));
      // A subscription whose date just passed is about to roll forward: show it as today.
      const from = isSubscription(t) ? (focus === 0 ? -1 : 1) : 0;
      return d >= from && d <= WEEK;
    })
    .sort(byDue)
    .map<BriefItem>((t) => ({ ...taskItem(t), text: isSubscription(t) ? `${t.title} renews` : t.title }));
  const billTotal = open
    .filter((t) => bills.some((b) => b.ref.id === t.id))
    .reduce((s, t) => Math.round((s + (t.amount ?? 0)) * 100) / 100, 0);

  const sections: BriefSection[] = [];
  const inOrder = (items: BriefItem[]) => [...items].sort((a, b) => a.at.localeCompare(b.at));
  const add = (key: string, label: string, items: BriefItem[], total?: number) => items.length && sections.push({ key, label, items, total });

  if (mode === "morning") {
    add("overdue", "Overdue", overdue.map((t) => taskItem(t, "danger")));
    add("today", "Today", inOrder([...tripsOn(0, 0), ...eventsOn(0, 0), ...bookingsOn(0, 0), ...plainOn(0).map((t) => taskItem(t)), ...deadlines(0, 0), ...reachOut(0)]));
    add("money", "Payments & renewals · next 7 days", bills, billTotal || undefined);
    add(
      "week",
      "Coming up this week",
      inOrder([...tripsOn(1, WEEK), ...eventsOn(1, WEEK), ...bookingsOn(1, WEEK), ...[1, 2, 3, 4, 5, 6, 7].flatMap((d) => plainOn(d).map((t) => taskItem(t))), ...deadlines(1, WEEK)]),
    );
  } else {
    add("left", "Still open from today", [...overdue.map((t) => taskItem(t, "danger")), ...plainOn(0).map((t) => taskItem(t, "warn")), ...reachOut(0)]);
    add("tomorrow", "Tomorrow", inOrder([...tripsOn(1, 1), ...eventsOn(1, 1), ...bookingsOn(1, 1), ...plainOn(1).map((t) => taskItem(t)), ...deadlines(1, 1), ...reachOut(1)]));
    add("money", "Payments & renewals · next 7 days", bills, billTotal || undefined);
    add(
      "week",
      "Later this week",
      inOrder([...tripsOn(2, WEEK), ...eventsOn(2, WEEK), ...bookingsOn(2, WEEK), ...[2, 3, 4, 5, 6, 7].flatMap((d) => plainOn(d).map((t) => taskItem(t))), ...deadlines(2, WEEK)]),
    );
  }

  const date = new Date(now).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  return { mode, title: mode === "morning" ? `Morning summary · ${date}` : `Evening summary · ${date}`, sections, empty: !sections.length };
}

/** The brief as notification text: one short line per section. */
export function briefPushText(b: Brief): { title: string; body: string } {
  if (b.empty) {
    return { title: b.title, body: b.mode === "morning" ? "Nothing due today and nothing coming up this week." : "All clear today, and nothing coming up tomorrow." };
  }
  const short: Record<string, string> = { overdue: "Overdue", today: "Today", left: "Still open", tomorrow: "Tomorrow", money: "Bills", week: b.mode === "morning" ? "This week" : "Later" };
  const lines = b.sections.map((s) => {
    // Bills read "Netflix $15.49 Thu, Nov 19"; everything else just by name.
    const names = s.items
      .slice(0, 3)
      .map((i) => (s.key === "money" ? [i.text.replace(/ renews$/, ""), i.amount != null && money(i.amount), i.day].filter(Boolean).join(" ") : i.text));
    const more = s.items.length > 3 ? ` +${s.items.length - 3}` : "";
    const total = s.total ? ` (${money(s.total)})` : "";
    return `${short[s.key]}${total}: ${names.join(", ")}${more}`;
  });
  return { title: b.title, body: lines.join("\n") };
}
