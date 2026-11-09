"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { daysBetween, formatDateKey, formatDue, localDateKey, money, monthlyCost } from "@/lib/time";
import {
  CATEGORIES,
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
import { CalendarView } from "./CalendarView";
import { ContactSheet, ContactsView, daysUntilDue } from "./Contacts";
import { EventSheet, EventsView } from "./Events";
import { GiftCardSheet, GiftCardsView } from "./GiftCards";
import TaskSheet from "./TaskSheet";
import SettingsSheet from "./SettingsSheet";
import { TripsView } from "./Trips";
import { UrgentCallout } from "./Urgent";
import { SideColumn } from "./Workspace";
import { registerWorker, setBadge } from "./push-client";
import { BUCKET_LABELS, BUCKET_ORDER, Chip, Stat, TaskRow, bucketOf, byDue, type Actions, type Data, type Tab } from "./shared";

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

const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "events", label: "Events" },
  { id: "trips", label: "Trips" },
  { id: "people", label: "Stay in touch" },
  { id: "cards", label: "Gift cards" },
];
const TAB_KEY = "tasks.tab";

type When = "all" | "overdue" | "today" | "week";

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type TaskSheetState = { task: Task | null; draft?: TaskInput };

export default function Dashboard({ user, initialTasks, initialTrips, initialSettings, initialCards, initialEvents, initialContacts, vapidKey, travel }: Props) {
  const [tab, setTabState] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState(initialTasks);
  const [trips, setTrips] = useState(initialTrips);
  const [events, setEvents] = useState(initialEvents);
  const [cards, setCards] = useState(initialCards);
  const [contacts, setContacts] = useState(initialContacts);
  const [settings, setSettings] = useState(initialSettings);
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState(initialSettings.timeZone);

  const [editing, setEditing] = useState<TaskSheetState | null>(null);
  const [eventSheet, setEventSheet] = useState<{ event: CalendarEvent | null; date?: string } | null>(null);
  const [cardSheet, setCardSheet] = useState<{ card: GiftCard | null; spend?: boolean } | null>(null);
  const [contactSheet, setContactSheet] = useState<{ contact: Contact | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
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
      setTasks(tasks);
      setTrips(trips);
      setCards(cards);
      setEvents(events);
      setContacts(contacts);
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
  }, []);

  // Deep links from notifications: /?task=12, /?event=4, /?card=2, /?person=5 open those;
  // /?trip=3 shows that trip; /?tab=calendar picks a tab. Otherwise reopen the last tab used.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = (k: string) => Number(params.get(k)) || 0;
    const [taskId, tripId, eventId, cardId, personId] = ["task", "trip", "event", "card", "person"].map(id);
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
      setFocusTrip(tripId);
      next = "trips";
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

  // Bring a focused trip into view once its tab is showing.
  useEffect(() => {
    if (tab !== "trips" || focusTrip == null) return;
    requestAnimationFrame(() => document.getElementById(`trip-${focusTrip}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [tab, focusTrip]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  useEffect(() => {
    setBadge(open.filter((t) => ["overdue", "today"].includes(bucketOf(t, now, tz))).length);
  }, [open, now, tz]);

  // Built-in categories in a fixed order, then any custom ones in use.
  const categoryList = useMemo(() => {
    const ids = CATEGORIES.map((c) => c.id);
    for (const t of tasks) if (!ids.includes(t.category)) ids.push(t.category);
    return ids;
  }, [tasks]);

  // ---- tasks ----

  const replace = useCallback((task: Task) => {
    setTasks((list) => (list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? task : t)) : [...list, task]));
  }, []);

  const complete = useCallback(
    async (task: Task) => {
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
    },
    [replace, tz],
  );

  const reopen = useCallback(
    async (task: Task) => {
      const { task: back } = await api<{ task: Task }>(`/api/tasks/${task.id}`, "PATCH", { action: "reopen" });
      replace(back);
    },
    [replace],
  );

  async function saveTask(input: TaskInput, existing: Task | null) {
    const { task } = existing
      ? await api<{ task: Task }>(`/api/tasks/${existing.id}`, "PATCH", input)
      : await api<{ task: Task }>("/api/tasks", "POST", input);
    replace(task);
    setEditing(null);
  }

  async function removeTask(task: Task) {
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

  const addTask = useCallback(
    async (input: TaskInput) => {
      try {
        const { task } = await api<{ task: Task }>("/api/tasks", "POST", input);
        replace(task);
        setToast({ text: `Added “${task.title}” — tap it to set a date and reminders.` });
      } catch (err) {
        setToast({ text: (err as Error).message });
      }
    },
    [replace],
  );

  // ---- events ----

  function replaceEvent(event: CalendarEvent) {
    setEvents((list) =>
      (list.some((e) => e.id === event.id) ? list.map((e) => (e.id === event.id ? event : e)) : [...list, event]).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
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

  // ---- stay in touch ----

  const replaceContact = useCallback((contact: Contact) => {
    setContacts((list) => (list.some((c) => c.id === contact.id) ? list.map((c) => (c.id === contact.id ? contact : c)) : [...list, contact]));
  }, []);

  async function saveContact(input: ContactInput, existing: Contact | null) {
    const { contact } = existing
      ? await api<{ contact: Contact }>(`/api/contacts/${existing.id}`, "PATCH", input)
      : await api<{ contact: Contact }>("/api/contacts", "POST", input);
    replaceContact(contact);
    setContactSheet(null);
  }

  const logContactToday = useCallback(
    async (contact: Contact) => {
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
    },
    [replaceContact, tz],
  );

  async function removeContact(contact: Contact) {
    await api(`/api/contacts/${contact.id}`, "DELETE");
    setContacts((list) => list.filter((c) => c.id !== contact.id));
    setContactSheet(null);
    setToast({ text: `Removed ${contact.name}` });
  }

  // ---- what every view gets ----

  const data: Data = useMemo(
    () => ({ tasks, trips, events, cards, contacts, now, tz, travelConfigured: travel.configured, categories: categoryList }),
    [tasks, trips, events, cards, contacts, now, tz, travel.configured, categoryList],
  );

  const actions: Actions = useMemo(
    () => ({
      openTask: (task) => setEditing({ task }),
      newTask: (draft = {}) => setEditing({ task: null, draft }),
      toggleTask: (t) => (t.status === "done" ? reopen(t) : complete(t)),
      addTask,
      openEvent: (event) => setEventSheet({ event }),
      newEvent: (date) => setEventSheet({ event: null, date }),
      openCard: (card, spend) => setCardSheet({ card, spend }),
      newCard: () => setCardSheet({ card: null }),
      openContact: (contact) => setContactSheet({ contact }),
      newContact: () => setContactSheet({ contact: null }),
      logContact: logContactToday,
      goTab: (next, focus) => {
        setTab(next);
        if (focus?.trip != null) setFocusTrip(focus.trip);
      },
    }),
    [reopen, complete, addTask, logContactToday, setTab],
  );

  // ---- tab counts ----

  const today = localDateKey(now, tz);
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
  const tabCount: Record<Tab, number> = {
    tasks: counts.overdue + counts.today,
    calendar: 0,
    events: events.filter((e) => {
      const d = daysBetween(today, localDateKey(new Date(e.startsAt), tz));
      return d >= 0 && d <= 7;
    }).length,
    trips: trips.length,
    people: contacts.filter((c) => {
      const d = daysUntilDue(c, today);
      return d == null || d <= 0;
    }).length,
    cards: cards.filter((c) => c.status === "active").length,
  };

  function newForTab() {
    if (tab === "cards") actions.newCard();
    else if (tab === "events") actions.newEvent();
    else if (tab === "people") actions.newContact();
    else if (tab === "trips") actions.newTask({ category: "trip", tripId: focusTrip ?? trips[0]?.id });
    else actions.newTask();
  }

  const dateLine = new Date(now).toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="brand">
          <h1>Workspace</h1>
          <p className="muted small">{dateLine}</p>
        </div>
        <div className="top-actions">
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Notifications and settings">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="btn primary" onClick={newForTab}>
            <span aria-hidden>+</span> New
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {tabCount[t.id] > 0 && <span className={`tab-count ${t.id === "tasks" && counts.overdue ? "alert" : ""}`}>{tabCount[t.id]}</span>}
          </button>
        ))}
      </nav>

      <div className="ws-grid">
        <SideColumn side="left" data={data} actions={actions} />

        <main className="ws-main">
          <UrgentCallout data={data} actions={actions} />

          {tab === "tasks" && <TasksTab data={data} actions={actions} counts={counts} />}
          {tab === "calendar" && (
            <section className="card-surface">
              <CalendarView data={data} actions={actions} />
            </section>
          )}
          {tab === "events" && <EventsView events={events} now={now} tz={tz} onOpen={actions.openEvent} onNew={() => actions.newEvent()} />}
          {tab === "trips" && <TripsView data={data} actions={actions} focus={focusTrip} />}
          {tab === "people" && (
            <ContactsView contacts={contacts} now={now} tz={tz} onOpen={actions.openContact} onLog={actions.logContact} onNew={actions.newContact} />
          )}
          {tab === "cards" && <GiftCardsView cards={cards} now={now} tz={tz} onOpen={actions.openCard} onNew={actions.newCard} />}
        </main>

        <SideColumn side="right" data={data} actions={actions} />
      </div>

      {editing && (
        <TaskSheet
          task={editing.task}
          draft={editing.draft}
          trips={trips}
          categories={categoryList}
          tz={tz}
          onClose={() => setEditing(null)}
          onSave={saveTask}
          onDelete={removeTask}
          onSnooze={snooze}
          onComplete={async (t) => {
            setEditing(null);
            await complete(t);
          }}
        />
      )}

      {eventSheet && (
        <EventSheet event={eventSheet.event} draftDate={eventSheet.date} onClose={() => setEventSheet(null)} onSave={saveEvent} onDelete={removeEvent} />
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
        <ContactSheet contact={contactSheet.contact} onClose={() => setContactSheet(null)} onSave={saveContact} onDelete={removeContact} onChanged={replaceContact} />
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

// ---- the Tasks tab ----

function TasksTab({ data, actions, counts }: { data: Data; actions: Actions; counts: { overdue: number; today: number; week: number } }) {
  const { tasks, now, tz, trips, events, categories } = data;
  const [category, setCategory] = useState<string>("all");
  const [when, setWhen] = useState<When>("all");
  const [minUrgency, setMinUrgency] = useState(0);
  const [sort, setSort] = useState<"due" | "urgency">("due");
  const [showDone, setShowDone] = useState(false);
  const [quick, setQuick] = useState("");

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of open) m.set(t.category, (m.get(t.category) ?? 0) + 1);
    return m;
  }, [open]);

  const visible = useMemo(() => {
    const pool = showDone ? tasks.filter((t) => t.status === "done") : open;
    return pool.filter((t) => {
      if (category !== "all" && t.category !== category && !(category === "trip" && t.tripId != null)) return false;
      if (t.urgency < minUrgency) return false;
      if (!showDone && when !== "all") {
        const b = bucketOf(t, now, tz);
        if (when === "overdue" && b !== "overdue") return false;
        if (when === "today" && b !== "today" && b !== "overdue") return false;
        if (when === "week" && !["overdue", "today", "tomorrow", "week"].includes(b)) return false;
      }
      return true;
    });
  }, [tasks, open, showDone, category, minUrgency, when, now, tz]);

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
      items: visible.filter((t) => bucketOf(t, now, tz) === b).sort((a, c) => (b === "none" ? c.urgency - a.urgency || a.id - c.id : byDue(a, c))),
    })).filter((g) => g.items.length);
  }, [visible, sort, showDone, now, tz]);

  const recurring = useMemo(() => {
    if (category !== "subscription" && category !== "payment") return null;
    const items = open.filter((t) => t.category === category && t.repeat !== "none" && t.amount != null);
    if (!items.length) return null;
    const perMonth = items.reduce((s, t) => s + monthlyCost(t.amount!, t.repeat, t.repeatEvery), 0);
    return { perMonth, count: items.length };
  }, [open, category]);

  // The soonest event still ahead (or happening today).
  const today = localDateKey(now, tz);
  const nextEvent = events.find((e) => (e.allDay ? localDateKey(new Date(e.startsAt), tz) >= today : Date.parse(e.startsAt) > now.getTime()));
  const nextEventDays = nextEvent ? daysBetween(today, localDateKey(new Date(nextEvent.startsAt), tz)) : null;

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    await actions.addTask({ title, category: category === "all" ? "personal" : category });
  }

  const filtering = category !== "all" || when !== "all" || minUrgency > 0;

  return (
    <>
      <section className="stats" aria-label="Summary">
        <Stat label="Overdue" value={counts.overdue} tone={counts.overdue ? "critical" : undefined} active={when === "overdue"} onClick={() => setWhen(when === "overdue" ? "all" : "overdue")} />
        <Stat label="Today" value={counts.today} active={when === "today"} onClick={() => setWhen(when === "today" ? "all" : "today")} />
        <Stat label="Next 7 days" value={counts.week} active={when === "week"} onClick={() => setWhen(when === "week" ? "all" : "week")} />
        <Stat
          label={nextEvent ? `Until ${nextEvent.title}` : "Next event"}
          value={nextEventDays == null ? "—" : nextEventDays === 0 ? "Today" : `${nextEventDays}d`}
          onClick={() => actions.goTab("events")}
        />
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
          <button type="button" className="link" onClick={() => { actions.newTask({ title: quick.trim(), category: category === "all" ? undefined : category }); setQuick(""); }}>
            Details
          </button>
        )}
      </form>

      <nav className="chips" aria-label="Categories">
        <Chip active={category === "all"} onClick={() => setCategory("all")} label="All" count={open.length} />
        {categories.map((id) => {
          const info = categoryInfo(id);
          const n = categoryCounts.get(id) ?? 0;
          if (!n && category !== id && !["work", "trip", "subscription", "payment", "personal"].includes(id)) return null;
          return <Chip key={id} active={category === id} color={info.color} onClick={() => setCategory(category === id ? "all" : id)} label={info.label} count={n} />;
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
          <button className="link" onClick={() => { setCategory("all"); setWhen("all"); setMinUrgency(0); }}>
            Clear filters
          </button>
        )}
      </div>

      {recurring && (
        <p className="recurring">
          {recurring.count} recurring {category === "subscription" ? "subscriptions" : "payments"} ≈ <strong>{money(recurring.perMonth)}</strong>/month · {money(recurring.perMonth * 12)}/year
        </p>
      )}

      <div className="list">
        {groups.length === 0 && (
          <div className="empty">
            <p>{showDone ? "Nothing completed recently." : filtering ? "Nothing matches these filters." : "All clear. Nothing outstanding."}</p>
            {!showDone && <button className="btn" onClick={() => actions.newTask()}>Add a task</button>}
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
                  onToggle={() => actions.toggleTask(t)}
                  onOpen={() => actions.openTask(t)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
