"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { daysBetween, formatDateKey, formatDue, localDateKey, money, monthlyCost, relativeDue } from "@/lib/time";
import {
  CATEGORIES,
  REPEATS,
  URGENCIES,
  categoryInfo,
  contactDueOn,
  type CalendarEvent,
  type CalendarEventInput,
  type Contact,
  type ContactInput,
  type GiftCard,
  type GiftCardInput,
  type Settings,
  type Task,
  type TaskInput,
  type Trip,
} from "@/lib/types";
import { api } from "./api-client";
import { ContactSheet, ContactsView, daysUntilDue } from "./Contacts";
import { EventSheet, EventsView } from "./Events";
import { GiftCardSheet, GiftCardsView } from "./GiftCards";
import TaskSheet from "./TaskSheet";
import SettingsSheet from "./SettingsSheet";
import { registerWorker, setBadge } from "./push-client";

type Props = {
  user: string;
  initialTasks: Task[];
  initialTrips: Trip[];
  initialSettings: Settings;
  initialCards: GiftCard[];
  initialEvents: CalendarEvent[];
  initialContacts: Contact[];
  vapidKey: string | null;
  travel: { configured: boolean; url: string };
};

export type Tab = "tasks" | "events" | "people" | "cards";
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: "tasks", label: "Tasks", title: "Tasks" },
  { id: "events", label: "Events", title: "Events" },
  { id: "people", label: "Stay in touch", title: "Stay in touch" },
  { id: "cards", label: "Gift cards", title: "Gift cards" },
];
const TAB_KEY = "tasks.tab";

type When = "all" | "overdue" | "today" | "week";
type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
};
const BUCKET_ORDER: Bucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function bucketOf(t: Task, now: Date, tz: string): Bucket {
  if (!t.dueAt) return "none";
  const due = new Date(t.dueAt);
  const today = localDateKey(now, tz);
  const key = localDateKey(due, tz);
  if (key < today || (!t.allDay && due < now)) return "overdue";
  const d = daysBetween(today, key);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 7) return "week";
  return "later";
}

function byDue(a: Task, b: Task) {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (!a.dueAt !== !b.dueAt) return a.dueAt ? -1 : 1;
  return b.urgency - a.urgency || a.id - b.id;
}

export default function Dashboard({ user, initialTasks, initialTrips, initialSettings, initialCards, initialEvents, initialContacts, vapidKey, travel }: Props) {
  const [tab, setTabState] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState(initialTasks);
  const [cards, setCards] = useState(initialCards);
  const [events, setEvents] = useState(initialEvents);
  const [cardSheet, setCardSheet] = useState<{ card: GiftCard | null; spend?: boolean } | null>(null);
  const [eventSheet, setEventSheet] = useState<{ event: CalendarEvent | null } | null>(null);
  const [contacts, setContacts] = useState(initialContacts);
  const [contactSheet, setContactSheet] = useState<{ contact: Contact | null } | null>(null);
  const [trips, setTrips] = useState(initialTrips);
  const [settings, setSettings] = useState(initialSettings);
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState(initialSettings.timeZone);
  const [category, setCategory] = useState<string>("all");
  const [when, setWhen] = useState<When>("all");
  const [minUrgency, setMinUrgency] = useState(0);
  const [sort, setSort] = useState<"due" | "urgency">("due");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<{ task: Task | null; draft?: TaskInput } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [quick, setQuick] = useState("");
  const [focusTrip, setFocusTrip] = useState<number | null>(null);

  // Keep relative times fresh, use this device's time zone, and refetch when the app comes back to the foreground.
  const refresh = useCallback(async () => {
    try {
      const [{ tasks }, { trips }, { cards }, { events }, { contacts }] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks", "GET"),
        api<{ trips: Trip[] }>("/api/trips", "GET"),
        api<{ cards: GiftCard[] }>("/api/gift-cards", "GET"),
        api<{ events: CalendarEvent[] }>("/api/events", "GET"),
        api<{ contacts: Contact[] }>("/api/contacts", "GET"),
      ]);
      setContacts(contacts);
      setTasks(tasks);
      setTrips(trips);
      setCards(cards);
      setEvents(events);
    } catch {}
    setNow(new Date());
  }, []);

  useEffect(() => {
    const local = browserTz();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server render can't know the device's zone
    setTz(local);
    if (local !== initialSettings.timeZone) {
      api<{ settings: Settings }>("/api/settings", "PUT", { timeZone: local }).then((r) => setSettings(r.settings)).catch(() => {});
    }
    registerWorker();
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialSettings.timeZone, refresh]);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {}
    window.scrollTo({ top: 0 });
  }, []);

  // Deep links from notifications: /?task=12 opens it, /?trip=3 shows that trip's prep,
  // /?event=4 and /?card=2 open those; /?tab=events picks a tab. Otherwise reopen the last tab used.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = Number(params.get("task"));
    const tripId = Number(params.get("trip"));
    const eventId = Number(params.get("event"));
    const cardId = Number(params.get("card"));
    const personId = Number(params.get("person"));
    const wanted = params.get("tab") as Tab | null;
    let next: Tab | null = TABS.some((t) => t.id === wanted) ? wanted : null;
    if (!next && !taskId && !tripId && !eventId && !cardId && !personId) {
      try {
        const saved = localStorage.getItem(TAB_KEY) as Tab | null;
        if (TABS.some((t) => t.id === saved)) next = saved;
      } catch {}
    }
    if (taskId) {
      const t = initialTasks.find((x) => x.id === taskId);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL only works after mount
      if (t) setEditing({ task: t });
      next = "tasks";
    }
    if (tripId) {
      setCategory("trip");
      setFocusTrip(tripId);
      next = "tasks";
    }
    if (eventId) {
      const e = initialEvents.find((x) => x.id === eventId);
      if (e) setEventSheet({ event: e });
      next = "events";
    }
    if (cardId) {
      const c = initialCards.find((x) => x.id === cardId);
      if (c) setCardSheet({ card: c });
      next = "cards";
    }
    if (personId) {
      const c = initialContacts.find((x) => x.id === personId);
      if (c) setContactSheet({ contact: c });
      next = "people";
    }
    if (next) setTabState(next);
    if (window.location.search) window.history.replaceState(null, "", "/");
  }, [initialTasks, initialEvents, initialCards, initialContacts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  useEffect(() => {
    setBadge(open.filter((t) => ["overdue", "today"].includes(bucketOf(t, now, tz))).length);
  }, [open, now, tz]);

  const counts = useMemo(() => {
    const c = { overdue: 0, today: 0, week: 0 };
    for (const t of open) {
      const b = bucketOf(t, now, tz);
      if (b === "overdue") c.overdue++;
      else if (b === "today") c.today++;
      else if (b === "tomorrow" || b === "week") c.week++;
    }
    return c;
  }, [open, now, tz]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of open) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, [open]);

  // Built-in categories in a fixed order, then any custom ones in use.
  const categoryList = useMemo(() => {
    const ids = CATEGORIES.map((c) => c.id);
    for (const t of tasks) if (!ids.includes(t.category)) ids.push(t.category);
    return ids;
  }, [tasks]);

  const visible = useMemo(() => {
    const pool = showDone ? tasks.filter((t) => t.status === "done") : open;
    return pool.filter((t) => {
      if (category !== "all" && t.category !== category && !(category === "trip" && t.tripId != null)) return false;
      if (focusTrip != null && t.tripId !== focusTrip) return false;
      if (t.urgency < minUrgency) return false;
      if (!showDone && when !== "all") {
        const b = bucketOf(t, now, tz);
        if (when === "overdue" && b !== "overdue") return false;
        if (when === "today" && b !== "today" && b !== "overdue") return false;
        if (when === "week" && !["overdue", "today", "tomorrow", "week"].includes(b)) return false;
      }
      return true;
    });
  }, [tasks, open, showDone, category, focusTrip, minUrgency, when, now, tz]);

  const groups = useMemo(() => {
    if (showDone) {
      const done = [...visible].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
      return done.length ? [{ key: "done", label: "Completed in the last 30 days", items: done }] : [];
    }
    if (sort === "urgency") {
      return [...URGENCIES]
        .reverse()
        .map((u) => ({ key: `u${u.value}`, label: u.label, items: visible.filter((t) => t.urgency === u.value).sort(byDue) }))
        .filter((g) => g.items.length);
    }
    return BUCKET_ORDER.map((b) => ({
      key: b,
      label: BUCKET_LABELS[b],
      items: visible
        .filter((t) => bucketOf(t, now, tz) === b)
        .sort((a, c) => (b === "none" ? c.urgency - a.urgency || a.id - c.id : byDue(a, c))),
    })).filter((g) => g.items.length);
  }, [visible, sort, showDone, now, tz]);

  const recurring = useMemo(() => {
    if (category !== "subscription" && category !== "payment") return null;
    const items = open.filter((t) => t.category === category && t.repeat !== "none" && t.amount != null);
    if (!items.length) return null;
    const perMonth = items.reduce((s, t) => s + monthlyCost(t.amount!, t.repeat, t.repeatEvery), 0);
    return { perMonth, count: items.length };
  }, [open, category]);

  const upcomingTrips = useMemo(
    () => trips.filter((t) => (focusTrip == null || t.id === focusTrip) && daysBetween(localDateKey(now, tz), t.endDate) >= 0).slice(0, 6),
    [trips, focusTrip, now, tz],
  );
  const contactsDue = contacts.filter((c) => {
    const d = daysUntilDue(c, localDateKey(now, tz));
    return d == null || d <= 0;
  }).length;
  const activeCards = cards.filter((c) => c.status === "active").length;
  const upcomingEventCount = useMemo(() => {
    const todayKey = localDateKey(now, tz);
    return events.filter((e) => {
      const d = daysBetween(todayKey, localDateKey(new Date(e.startsAt), tz));
      return d >= 0 && d <= 7;
    }).length;
  }, [events, now, tz]);
  const nextTrip = trips.find((t) => daysBetween(localDateKey(now, tz), t.startDate) >= 0);

  // ---- actions ----

  function replace(task: Task) {
    setTasks((list) => (list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? task : t)) : [...list, task]));
  }

  async function complete(task: Task) {
    // Optimistic: non-repeating tasks disappear at once.
    if (task.repeat === "none") replace({ ...task, status: "done", completedAt: new Date().toISOString() });
    try {
      const { task: next } = await api<{ task: Task }>(`/api/tasks/${task.id}`, "PATCH", { action: "complete" });
      replace(next);
      const repeating = next.status === "open" && next.dueAt;
      setToast({
        text: repeating ? `Done — next ${formatDue(new Date(next.dueAt!), tz, next.allDay)}` : `Completed “${task.title}”`,
        undo: async () => {
          const body = repeating ? { dueAt: task.dueAt } : { action: "reopen" };
          const { task: back } = await api<{ task: Task }>(`/api/tasks/${task.id}`, "PATCH", body);
          replace(back);
          setToast(null);
        },
      });
    } catch (err) {
      replace(task);
      setToast({ text: (err as Error).message });
    }
  }

  async function reopen(task: Task) {
    const { task: back } = await api<{ task: Task }>(`/api/tasks/${task.id}`, "PATCH", { action: "reopen" });
    replace(back);
  }

  async function save(input: TaskInput, existing: Task | null) {
    const { task } = existing
      ? await api<{ task: Task }>(`/api/tasks/${existing.id}`, "PATCH", input)
      : await api<{ task: Task }>("/api/tasks", "POST", input);
    replace(task);
    setEditing(null);
  }

  async function remove(task: Task) {
    await api(`/api/tasks/${task.id}`, "DELETE");
    setTasks((list) => list.filter((t) => t.id !== task.id));
    setEditing(null);
    setToast({
      text: `Deleted “${task.title}”`,
      undo: async () => {
        const input: TaskInput = {
          title: task.title, notes: task.notes, category: task.category, urgency: task.urgency, dueAt: task.dueAt,
          allDay: task.allDay, repeat: task.repeat, repeatEvery: task.repeatEvery, amount: task.amount,
          reminders: task.reminders, remindAt: task.remindAt, tripId: task.tripId, autoRenew: task.autoRenew,
        };
        const { task: back } = await api<{ task: Task }>("/api/tasks", "POST", input);
        replace(back);
        setToast(null);
      },
    });
  }

  async function snooze(task: Task, minutes: number) {
    const { task: next } = await api<{ task: Task }>(`/api/tasks/${task.id}`, "PATCH", { action: "snooze", minutes });
    replace(next);
    setEditing(null);
    setToast({ text: `Snoozed to ${formatDue(new Date(next.dueAt!), tz, false)}` });
  }

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    const input: TaskInput = { title, category: category === "all" ? "personal" : category };
    if (focusTrip != null) input.tripId = focusTrip;
    try {
      const { task } = await api<{ task: Task }>("/api/tasks", "POST", input);
      replace(task);
      setToast({ text: `Added “${task.title}” — tap it to set a date and reminders.` });
    } catch (err) {
      setToast({ text: (err as Error).message });
    }
  }

  // ---- gift cards ----

  function replaceCard(card: GiftCard) {
    setCards((list) => (list.some((c) => c.id === card.id) ? list.map((c) => (c.id === card.id ? card : c)) : [...list, card]));
  }

  async function saveCard(input: GiftCardInput, existing: GiftCard | null) {
    const { card } = existing
      ? await api<{ card: GiftCard }>(`/api/gift-cards/${existing.id}`, "PATCH", input)
      : await api<{ card: GiftCard }>("/api/gift-cards", "POST", input);
    replaceCard(card);
    setCardSheet(null);
  }

  async function spendCard(card: GiftCard, amount: number) {
    const { card: next } = await api<{ card: GiftCard }>(`/api/gift-cards/${card.id}`, "PATCH", { action: "spend", amount });
    replaceCard(next);
    setCardSheet(null);
    setToast({
      text: next.balance > 0 ? `${money(next.balance)} left on ${card.store}` : `${card.store} card used up`,
      undo: async () => {
        const { card: back } = await api<{ card: GiftCard }>(`/api/gift-cards/${card.id}`, "PATCH", { balance: card.balance });
        replaceCard(back);
        setToast(null);
      },
    });
  }

  async function cardStatus(card: GiftCard, action: "used" | "reactivate") {
    const { card: next } = await api<{ card: GiftCard }>(`/api/gift-cards/${card.id}`, "PATCH", { action });
    replaceCard(next);
    setCardSheet(null);
  }

  async function removeCard(card: GiftCard) {
    await api(`/api/gift-cards/${card.id}`, "DELETE");
    setCards((list) => list.filter((c) => c.id !== card.id));
    setCardSheet(null);
    setToast({
      text: `Deleted the ${card.store} card`,
      undo: async () => {
        const { card: back } = await api<{ card: GiftCard }>("/api/gift-cards", "POST", {
          store: card.store, balance: card.balance, initialAmount: card.initialAmount, expiresOn: card.expiresOn, location: card.location, notes: card.notes,
        });
        replaceCard(back);
        setToast(null);
      },
    });
  }

  // ---- events ----

  function replaceEvent(event: CalendarEvent) {
    setEvents((list) =>
      (list.some((e) => e.id === event.id) ? list.map((e) => (e.id === event.id ? event : e)) : [...list, event]).sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    );
  }

  async function saveEvent(input: CalendarEventInput, existing: CalendarEvent | null) {
    const { event } = existing
      ? await api<{ event: CalendarEvent }>(`/api/events/${existing.id}`, "PATCH", input)
      : await api<{ event: CalendarEvent }>("/api/events", "POST", input);
    replaceEvent(event);
    setEventSheet(null);
  }

  async function removeEvent(event: CalendarEvent) {
    await api(`/api/events/${event.id}`, "DELETE");
    setEvents((list) => list.filter((e) => e.id !== event.id));
    setEventSheet(null);
    setToast({
      text: `Deleted “${event.title}”`,
      undo: async () => {
        const { event: back } = await api<{ event: CalendarEvent }>("/api/events", "POST", {
          title: event.title, startsAt: event.startsAt, allDay: event.allDay, location: event.location, notes: event.notes, reminders: event.reminders,
        });
        replaceEvent(back);
        setToast(null);
      },
    });
  }

  // ---- stay in touch ----

  function replaceContact(contact: Contact) {
    setContacts((list) =>
      list.some((c) => c.id === contact.id) ? list.map((c) => (c.id === contact.id ? contact : c)) : [...list, contact],
    );
  }

  async function saveContact(input: ContactInput, existing: Contact | null) {
    const { contact } = existing
      ? await api<{ contact: Contact }>(`/api/contacts/${existing.id}`, "PATCH", input)
      : await api<{ contact: Contact }>("/api/contacts", "POST", input);
    replaceContact(contact);
    setContactSheet(null);
  }

  async function logContactToday(contact: Contact) {
    try {
      const { contact: next, logId } = await api<{ contact: Contact; logId: number }>(`/api/contacts/${contact.id}`, "PATCH", {
        action: "log",
        on: localDateKey(new Date(), tz),
      });
      replaceContact(next);
      setToast({
        text: `Logged ${contact.name} — next nudge ${formatDateKey(contactDueOn(next)!)}`,
        undo: async () => {
          const { contact: back } = await api<{ contact: Contact }>(`/api/contacts/${contact.id}`, "PATCH", { action: "unlog", logId });
          replaceContact(back);
          setToast(null);
        },
      });
    } catch (err) {
      setToast({ text: (err as Error).message });
    }
  }

  async function removeContact(contact: Contact) {
    await api(`/api/contacts/${contact.id}`, "DELETE");
    setContacts((list) => list.filter((c) => c.id !== contact.id));
    setContactSheet(null);
    setToast({ text: `Removed ${contact.name}` });
  }

  function newTask(draft: TaskInput = {}) {
    setEditing({
      task: null,
      draft: { category: category === "all" ? undefined : category, tripId: focusTrip ?? undefined, ...draft },
    });
  }

  const today = new Date(now).toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const filtering = category !== "all" || when !== "all" || minUrgency > 0 || focusTrip != null;

  return (
    <div className="shell">
      <header className="top">
        <div>
          <h1>{TABS.find((t) => t.id === tab)!.title}</h1>
          <p className="muted">{today}</p>
        </div>
        <div className="top-actions">
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Notifications and settings">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="btn primary"
            onClick={() =>
              tab === "cards"
                ? setCardSheet({ card: null })
                : tab === "events"
                  ? setEventSheet({ event: null })
                  : tab === "people"
                    ? setContactSheet({ contact: null })
                    : newTask()
            }
          >
            <span aria-hidden>+</span> New
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Lists">
        {TABS.map((t) => {
          const n =
            t.id === "tasks"
              ? counts.overdue + counts.today
              : t.id === "events"
                ? upcomingEventCount
                : t.id === "people"
                  ? contactsDue
                  : activeCards;
          return (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {n > 0 && <span className={`tab-count ${t.id === "tasks" && counts.overdue ? "alert" : ""}`}>{n}</span>}
            </button>
          );
        })}
      </nav>

      {tab === "people" && (
        <ContactsView
          contacts={contacts}
          now={now}
          tz={tz}
          onOpen={(contact) => setContactSheet({ contact })}
          onLog={logContactToday}
          onNew={() => setContactSheet({ contact: null })}
        />
      )}

      {tab === "cards" && (
        <GiftCardsView cards={cards} now={now} tz={tz} onOpen={(card, spend) => setCardSheet({ card, spend })} onNew={() => setCardSheet({ card: null })} />
      )}

      {tab === "events" && (
        <EventsView events={events} trips={trips} now={now} tz={tz} onOpen={(event) => setEventSheet({ event })} onNew={() => setEventSheet({ event: null })} />
      )}

      {tab === "tasks" && (
        <>
          <section className="stats" aria-label="Summary">
            <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? "critical" : undefined} active={when === "overdue"} onClick={() => setWhen(when === "overdue" ? "all" : "overdue")} />
            <Stat label="Today" value={counts.today} active={when === "today"} onClick={() => setWhen(when === "today" ? "all" : "today")} />
            <Stat label="Next 7 days" value={counts.week} active={when === "week"} onClick={() => setWhen(when === "week" ? "all" : "week")} />
            {travel.configured ? (
              <Stat
                label={nextTrip ? nextTrip.name : "Next trip"}
                value={nextTrip ? `${daysBetween(localDateKey(now, tz), nextTrip.startDate)}d` : "—"}
                active={category === "trip"}
                onClick={() => {
                  setCategory(category === "trip" ? "all" : "trip");
                  setFocusTrip(null);
                }}
              />
            ) : (
              <Stat label="Open" value={open.length} active={false} onClick={() => setWhen("all")} />
            )}
          </section>

          <form className="quick" onSubmit={quickAdd}>
            <input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              placeholder={`Add a task${category !== "all" ? ` to ${categoryInfo(category).label}` : ""}…`}
              aria-label="Quick add a task"
              enterKeyHint="done"
            />
            {quick.trim() && (
              <button type="button" className="link" onClick={() => { newTask({ title: quick.trim() }); setQuick(""); }}>
                Details
              </button>
            )}
          </form>

          <nav className="chips" aria-label="Categories">
            <Chip active={category === "all"} onClick={() => { setCategory("all"); setFocusTrip(null); }} label="All" count={open.length} />
            {categoryList.map((id) => {
              const info = categoryInfo(id);
              const n = categoryCounts.get(id) ?? 0;
              if (!n && category !== id && !["work", "trip", "subscription", "payment", "personal"].includes(id)) return null;
              return (
                <Chip
                  key={id}
                  active={category === id}
                  color={info.color}
                  onClick={() => { setCategory(category === id ? "all" : id); setFocusTrip(null); }}
                  label={info.label}
                  count={n}
                />
              );
            })}
          </nav>

          <div className="toolbar">
            <div className="seg" role="group" aria-label="Sort">
              <button className={sort === "due" ? "on" : ""} onClick={() => setSort("due")}>By date</button>
              <button className={sort === "urgency" ? "on" : ""} onClick={() => setSort("urgency")}>By urgency</button>
            </div>
            <select value={minUrgency} onChange={(e) => setMinUrgency(Number(e.target.value))} aria-label="Minimum urgency">
              <option value={0}>Any urgency</option>
              <option value={2}>High &amp; critical</option>
              <option value={3}>Critical only</option>
            </select>
            <label className="toggle">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Done
            </label>
            {filtering && (
              <button className="link" onClick={() => { setCategory("all"); setWhen("all"); setMinUrgency(0); setFocusTrip(null); }}>
                Clear filters
              </button>
            )}
          </div>

          {recurring && (
            <p className="recurring">
              {recurring.count} recurring {category === "subscription" ? "subscriptions" : "payments"} ≈{" "}
              <strong>{money(recurring.perMonth)}</strong>/month · {money(recurring.perMonth * 12)}/year
            </p>
          )}

          {(category === "all" || category === "trip") && !showDone && upcomingTrips.length > 0 && (
            <section className="trips" aria-label="Upcoming trips">
              {upcomingTrips.map((trip) => {
                const days = daysBetween(localDateKey(now, tz), trip.startDate);
                const prep = open.filter((t) => t.tripId === trip.id).length;
                return (
                  <article key={trip.id} className={`trip ${focusTrip === trip.id ? "focused" : ""}`}>
                    <button className="trip-main" onClick={() => { setCategory("trip"); setFocusTrip(focusTrip === trip.id ? null : trip.id); }}>
                      <span className="trip-when">{days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "starts today" : "underway"}</span>
                      <span className="trip-name">{trip.name}</span>
                      <span className="muted small">
                        {formatDateKey(trip.startDate)} – {formatDateKey(trip.endDate)}
                      </span>
                      <span className="small">{prep ? `${prep} prep task${prep === 1 ? "" : "s"} open` : "No prep tasks"}</span>
                    </button>
                    <div className="trip-actions">
                      <button className="link" onClick={() => newTask({ category: "trip", tripId: trip.id })}>+ Prep task</button>
                      <a className="link" href={trip.url} target="_blank" rel="noreferrer">Itinerary ↗</a>
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          <main className="list">
            {groups.length === 0 && (
              <div className="empty">
                <p>{showDone ? "Nothing completed recently." : filtering ? "Nothing matches these filters." : "All clear. Nothing outstanding."}</p>
                {!showDone && <button className="btn" onClick={() => newTask()}>Add a task</button>}
              </div>
            )}
            {groups.map((g) => (
              <section key={g.key} className="group">
                <h2 className={g.key === "overdue" ? "danger" : ""}>
                  {g.label} <span className="muted">{g.items.length}</span>
                </h2>
                <ul>
                  {g.items.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      now={now}
                      tz={tz}
                      trip={t.tripId != null ? trips.find((x) => x.id === t.tripId) : undefined}
                      onToggle={() => (t.status === "done" ? reopen(t) : complete(t))}
                      onOpen={() => setEditing({ task: t })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </main>
        </>
      )}

      {cardSheet && (
        <GiftCardSheet
          card={cardSheet.card}
          focusSpend={cardSheet.spend}
          onClose={() => setCardSheet(null)}
          onSave={saveCard}
          onSpend={spendCard}
          onStatus={cardStatus}
          onDelete={removeCard}
        />
      )}

      {contactSheet && (
        <ContactSheet
          contact={contactSheet.contact}
          onClose={() => setContactSheet(null)}
          onSave={saveContact}
          onDelete={removeContact}
          onChanged={replaceContact}
        />
      )}

      {eventSheet && <EventSheet event={eventSheet.event} onClose={() => setEventSheet(null)} onSave={saveEvent} onDelete={removeEvent} />}

      {editing && (
        <TaskSheet
          task={editing.task}
          draft={editing.draft}
          trips={trips}
          categories={categoryList}
          tz={tz}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
          onSnooze={snooze}
          onComplete={async (t) => { setEditing(null); await complete(t); }}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          user={user}
          settings={settings}
          vapidKey={vapidKey}
          travelConfigured={travel.configured}
          onChange={async (patch) => {
            const r = await api<{ settings: Settings }>("/api/settings", "PUT", patch);
            setSettings(r.settings);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, active, onClick }: { label: string; value: number | string; tone?: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`stat ${active ? "active" : ""} ${tone ?? ""}`} onClick={onClick} aria-pressed={active}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}

function Chip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
      {color && <span className="dot" style={{ background: color }} />}
      {label}
      {count > 0 && <span className="chip-count">{count}</span>}
    </button>
  );
}

function TaskRow({ task: t, now, tz, trip, onToggle, onOpen }: { task: Task; now: Date; tz: string; trip?: Trip; onToggle: () => void; onOpen: () => void }) {
  const info = categoryInfo(t.category);
  const due = t.dueAt ? new Date(t.dueAt) : null;
  const overdue = t.status === "open" && due && bucketOf(t, now, tz) === "overdue";
  const repeat = REPEATS.find((r) => r.value === t.repeat);
  return (
    <li className={`task u${t.urgency} ${t.status === "done" ? "done" : ""}`}>
      <button className="check" onClick={onToggle} aria-label={t.status === "done" ? "Mark as not done" : "Mark as done"}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="task-main" onClick={onOpen}>
        <span className="task-title">{t.title}</span>
        <span className="task-meta">
          <span className="cat">
            <span className="dot" style={{ background: info.color }} />
            {info.label}
          </span>
          {due && (
            <span className={overdue ? "danger" : ""}>
              {t.status === "done" ? formatDue(due, tz, t.allDay) : `${capitalize(relativeDue(due, now, tz, t.allDay))} · ${formatDue(due, tz, t.allDay)}`}
            </span>
          )}
          {t.repeat !== "none" && (
            <span title={t.autoRenew ? "Renews automatically" : "Repeats"}>
              ↻ {t.repeatEvery > 1 ? `Every ${t.repeatEvery} ${repeat?.noun}s` : repeat?.label}
            </span>
          )}
          {t.amount != null && <span>{money(t.amount)}</span>}
          {trip && <span>✈ {trip.name}</span>}
          {(t.reminders.length > 0 || t.remindAt) && due && t.status === "open" && <span className="bell" title="Reminders on">🔔</span>}
        </span>
      </button>
      {t.urgency !== 1 && <span className={`badge u${t.urgency}`}>{URGENCIES[t.urgency].label}</span>}
    </li>
  );
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
