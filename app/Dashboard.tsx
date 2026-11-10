"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { daysBetween, formatDateKey, formatDue, localDateKey, money } from "@/lib/time";
import {
  CATEGORIES,
  isReminder,
  contactDueOn,
  type Booking,
  type BookingInput,
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
  type TripItinerary,
} from "@/lib/types";
import { api } from "./api-client";
import { CalendarView } from "./CalendarView";
import { ContactSheet, ContactsView, daysUntilDue } from "./Contacts";
import { EventSheet, EventsView } from "./Events";
import { GiftCardSheet, GiftCardsView } from "./GiftCards";
import TaskSheet from "./TaskSheet";
import SettingsSheet from "./SettingsSheet";
import { BookingSheet } from "./BookingSheet";
import { ToBookView, TrackingView, trackingCount } from "./Tracking";
import { TripsView } from "./Trips";
import { UrgentCallout } from "./Urgent";
import { GridWorkspace } from "./Grid";
import { TasksTab, taskCounts } from "./TasksTab";
import { TodayList } from "./Today";
import { DayView } from "./DayView";
import { TopInfo } from "./TopInfo";
import { registerWorker, setBadge } from "./push-client";
import { bucketOf, type Actions, type Data, type Tab } from "./shared";

type Props = {
  user: string;
  initialTasks: Task[];
  initialTrips: Trip[];
  initialSettings: Settings;
  initialCards: GiftCard[];
  initialEvents: CalendarEvent[];
  initialContacts: Contact[];
  initialBookings: Booking[];
  vapidKey: string | null;
  travel: { configured: boolean; url: string };
};

// The phone view: a fixed set of tabs, today's to-do list first.
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tasks", label: "All tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "events", label: "Events" },
  { id: "trips", label: "Trips" },
  { id: "tracking", label: "Tracking" },
  { id: "people", label: "Stay in touch" },
  { id: "cards", label: "Gift cards" },
];
const TAB_KEY = "tasks.tab";

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type TaskSheetState = { task: Task | null; draft?: TaskInput };

export default function Dashboard({ user, initialTasks, initialTrips, initialSettings, initialCards, initialEvents, initialContacts, initialBookings, vapidKey, travel }: Props) {
  const [tab, setTabState] = useState<Tab>("today");
  const [tasks, setTasks] = useState(initialTasks);
  const [trips, setTrips] = useState(initialTrips);
  const [events, setEvents] = useState(initialEvents);
  const [cards, setCards] = useState(initialCards);
  const [contacts, setContacts] = useState(initialContacts);
  const [bookings, setBookings] = useState(initialBookings);
  const [settings, setSettings] = useState(initialSettings);
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState(initialSettings.timeZone);

  const [editing, setEditing] = useState<TaskSheetState | null>(null);
  const [eventSheet, setEventSheet] = useState<{ event: CalendarEvent | null; date?: string; times?: { start: string; end?: string; title?: string } } | null>(null);
  const [cardSheet, setCardSheet] = useState<{ card: GiftCard | null; spend?: boolean } | null>(null);
  const [contactSheet, setContactSheet] = useState<{ contact: Contact | null } | null>(null);
  const [bookingSheet, setBookingSheet] = useState<{ booking: Booking | null; draft?: BookingInput } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [focusTrip, setFocusTrip] = useState<number | null>(null);
  const [itineraries, setItineraries] = useState<TripItinerary[]>([]);
  const [travelLink, setTravelLink] = useState<Data["travelLink"]>({ connected: false, username: "" });
  const [selectedDay, setSelectedDay] = useState(() => localDateKey(new Date(), initialSettings.timeZone));

  // Trip itineraries load after the page, so a slow travel app never holds it up.
  const loadItineraries = useCallback(async () => {
    try {
      const r = await api<{ itineraries: TripItinerary[]; status: Data["travelLink"] }>("/api/itinerary", "GET");
      setItineraries(r.itineraries);
      setTravelLink(r.status);
    } catch {}
  }, []);

  // Keep relative times fresh, use this device's time zone, and refetch when the app comes back to the foreground.
  const refresh = useCallback(async () => {
    try {
      const [{ tasks }, { trips }, { cards }, { events }, { contacts }, { bookings }] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks", "GET"),
        api<{ trips: Trip[] }>("/api/trips", "GET"),
        api<{ cards: GiftCard[] }>("/api/gift-cards", "GET"),
        api<{ events: CalendarEvent[] }>("/api/events", "GET"),
        api<{ contacts: Contact[] }>("/api/contacts", "GET"),
        api<{ bookings: Booking[] }>("/api/bookings", "GET"),
      ]);
      setTasks(tasks);
      setTrips(trips);
      setCards(cards);
      setEvents(events);
      setContacts(contacts);
      setBookings(bookings);
      loadItineraries();
    } catch {}
    setNow(new Date());
  }, [loadItineraries]);

  useEffect(() => {
    const local = browserTz();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server render can't know the device's zone
    setTz(local);
    if (local !== initialSettings.timeZone) {
      api<{ settings: Settings }>("/api/settings", "PUT", { timeZone: local }).then((r) => setSettings(r.settings)).catch(() => {});
    }
    registerWorker();
    loadItineraries();
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialSettings.timeZone, refresh, loadItineraries]);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {}
  }, []);

  // Deep links from notifications: /?task=12, /?event=4, /?card=2, /?person=5, /?booking=7 open those;
  // /?trip=3 shows that trip; /?tab=calendar picks a tab. Otherwise reopen the last tab used.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = (k: string) => Number(params.get(k)) || 0;
    const [taskId, tripId, eventId, cardId, personId, bookingId] = ["task", "trip", "event", "card", "person", "booking"].map(id);
    const wanted = params.get("tab") as Tab | null;
    let next: Tab | null = TABS.some((t) => t.id === wanted) ? wanted : null;
    if (!next && !taskId && !tripId && !eventId && !cardId && !personId && !bookingId) {
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
    if (bookingId) {
      const b = initialBookings.find((x) => x.id === bookingId);
      if (b) setBookingSheet({ booking: b });
      next = "tracking";
    }
    if (next) setTabState(next);
    if (window.location.search) window.history.replaceState(null, "", "/");
  }, [initialTasks, initialEvents, initialCards, initialContacts, initialBookings]);

  // Bring a focused trip into view once its tab is showing.
  useEffect(() => {
    if (focusTrip == null) return;
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>(".trip-card.focused")].find((el) => el.offsetParent !== null);
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [tab, focusTrip]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);

  useEffect(() => {
    setBadge(open.filter((t) => !isReminder(t) && ["overdue", "today"].includes(bucketOf(t, now, tz))).length);
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
        setToast({ text: task.dueAt ? `Added “${task.title}”` : `Added “${task.title}” — tap it to set a date and reminders.` });
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
          title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay, location: event.location, notes: event.notes, reminders: event.reminders,
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

  // ---- tracking (bookings) ----

  function sortBookings(list: Booking[]) {
    return [...list].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.startTime.localeCompare(b.startTime) || a.id - b.id);
  }

  async function saveBooking(input: BookingInput, existing: Booking | null) {
    const { booking } = existing
      ? await api<{ booking: Booking }>(`/api/bookings/${existing.id}`, "PATCH", input)
      : await api<{ booking: Booking }>("/api/bookings", "POST", input);
    setBookings((list) => sortBookings([...list.filter((b) => b.id !== booking.id), booking]));
    setBookingSheet(null);
  }

  async function removeBooking(booking: Booking) {
    await api(`/api/bookings/${booking.id}`, "DELETE");
    setBookings((list) => list.filter((b) => b.id !== booking.id));
    setBookingSheet(null);
    setToast({
      text: "Booking deleted",
      undo: async () => {
        const { kind, name, number, from, to, startDate, startTime, endDate, endTime, confirmation, cancelBy, status, tripId, cost, notes } = booking;
        const input: BookingInput = { kind, name, number, from, to, startDate, startTime, endDate, endTime, confirmation, cancelBy, status, tripId, cost, notes };
        const { booking: back } = await api<{ booking: Booking }>("/api/bookings", "POST", input);
        setBookings((list) => sortBookings([...list, back]));
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
    () => ({ tasks, trips, events, cards, contacts, bookings, now, tz, travelConfigured: travel.configured, categories: categoryList, focusTrip, itineraries, travelLink, selectedDay }),
    [tasks, trips, events, cards, contacts, bookings, now, tz, travel.configured, categoryList, focusTrip, itineraries, travelLink, selectedDay],
  );

  const actions: Actions = useMemo(
    () => ({
      openTask: (task) => setEditing({ task }),
      newTask: (draft = {}) => setEditing({ task: null, draft }),
      toggleTask: (t) => (t.status === "done" ? reopen(t) : complete(t)),
      addTask,
      openEvent: (event) => setEventSheet({ event }),
      newEvent: (date, times) => setEventSheet({ event: null, date, times }),
      updateTask: async (t, input) => {
        try {
          replace((await api<{ task: Task }>(`/api/tasks/${t.id}`, "PATCH", input)).task);
        } catch (err) {
          setToast({ text: (err as Error).message });
        }
      },
      updateEvent: async (e, input) => {
        try {
          const { event } = await api<{ event: CalendarEvent }>(`/api/events/${e.id}`, "PATCH", input);
          setEvents((list) => list.map((x) => (x.id === event.id ? event : x)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
        } catch (err) {
          setToast({ text: (err as Error).message });
        }
      },
      createEvent: async (input) => {
        try {
          const { event } = await api<{ event: CalendarEvent }>("/api/events", "POST", input);
          setEvents((list) => [...list, event].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
          setToast({ text: `Added “${event.title}”` });
        } catch (err) {
          setToast({ text: (err as Error).message });
        }
      },
      openCard: (card, spend) => setCardSheet({ card, spend }),
      newCard: () => setCardSheet({ card: null }),
      openBooking: (booking) => setBookingSheet({ booking }),
      newBooking: (draft) => setBookingSheet({ booking: null, draft }),
      openContact: (contact) => setContactSheet({ contact }),
      newContact: () => setContactSheet({ contact: null }),
      logContact: logContactToday,
      selectDay: setSelectedDay,
      connectTravel: async (username, password) => {
        const r = await api<{ itineraries: TripItinerary[]; status: Data["travelLink"] }>("/api/itinerary", "POST", { username, password });
        setItineraries(r.itineraries);
        setTravelLink(r.status);
        setToast({ text: "Connected — trip days now show the itinerary." });
      },
      disconnectTravel: () => {
        setItineraries([]);
        setTravelLink({ connected: false, username: "" });
        api("/api/itinerary", "DELETE").catch(() => {});
      },
      goTab: (next, focus) => {
        setTab(next);
        if (focus?.trip != null) setFocusTrip(focus.trip);
      },
    }),
    [reopen, complete, addTask, logContactToday, setTab, replace],
  );

  // ---- tab counts ----

  const today = localDateKey(now, tz);
  const counts = useMemo(() => taskCounts(data), [data]);
  const tabCount: Record<Tab, number> = {
    today: counts.overdue + counts.today,
    tasks: 0,
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
    tracking: trackingCount(data),
  };

  function newForTab() {
    if (tab === "cards") actions.newCard();
    else if (tab === "events") actions.newEvent();
    else if (tab === "people") actions.newContact();
    else if (tab === "tracking") actions.newBooking();
    else if (tab === "trips") actions.newTask({ category: "trip", tripId: focusTrip ?? trips[0]?.id });
    else actions.newTask();
  }

  const dateLine = new Date(now).toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const topActions = (
    <>
      <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Notifications and settings">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M18 16v-5a6 6 0 10-12 0v5l-2 2h16l-2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );

  return (
    <>
      {/* Computer: the grid workspace. */}
      <div className="desktop-only">
        <GridWorkspace
          data={data}
          actions={actions}
          onToast={(text, undo) => setToast({ text, undo })}
          topActions={
            <>
              {topActions}
              <button className="btn primary" onClick={() => actions.newTask()}>
                <span aria-hidden>+</span> New task
              </button>
            </>
          }
        />
      </div>

      {/* Phone: a set view — today's to-do list first, then a tab for everything else. */}
      <div className="workspace mobile-only">
        <header className="topbar">
          <div className="brand">
            <h1>{TABS.find((t) => t.id === tab)!.label}</h1>
            <p className="muted small">{dateLine}</p>
          </div>
          <div className="top-actions">
            {topActions}
            <button className="btn primary" onClick={newForTab}>
              <span aria-hidden>+</span> New
            </button>
          </div>
        </header>

        <TopInfo data={data} compact />

        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
              {tabCount[t.id] > 0 && <span className={`tab-count ${t.id === "today" && counts.overdue ? "alert" : ""}`}>{tabCount[t.id]}</span>}
            </button>
          ))}
        </nav>

        <main className="ws-main">
          <UrgentCallout data={data} actions={actions} />
          {tab === "today" && <TodayList data={data} actions={actions} />}
          {tab === "tasks" && <TasksTab data={data} actions={actions} />}
          {tab === "calendar" && (
            <>
              <section className="card-surface">
                <CalendarView data={data} actions={actions} noAgenda />
              </section>
              <section className="card-surface day-section">
                <DayView data={data} actions={actions} />
              </section>
            </>
          )}
          {tab === "events" && <EventsView events={events} now={now} tz={tz} onOpen={actions.openEvent} onNew={() => actions.newEvent()} />}
          {tab === "trips" && <TripsView data={data} actions={actions} />}
          {tab === "tracking" && (
            <>
              <section className="card-surface trk-card">
                <h3>Tracking</h3>
                <TrackingView data={data} actions={actions} />
              </section>
              <section className="card-surface trk-card">
                <h3>Still to book</h3>
                <ToBookView data={data} actions={actions} />
              </section>
            </>
          )}
          {tab === "people" && (
            <ContactsView contacts={contacts} now={now} tz={tz} onOpen={actions.openContact} onLog={actions.logContact} onNew={actions.newContact} />
          )}
          {tab === "cards" && <GiftCardsView cards={cards} now={now} tz={tz} onOpen={actions.openCard} onNew={actions.newCard} />}
        </main>
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
        <EventSheet event={eventSheet.event} draftDate={eventSheet.date} draftTimes={eventSheet.times} onClose={() => setEventSheet(null)} onSave={saveEvent} onDelete={removeEvent} />
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

      {bookingSheet && (
        <BookingSheet
          booking={bookingSheet.booking}
          draft={bookingSheet.draft}
          trips={trips}
          onClose={() => setBookingSheet(null)}
          onSave={saveBooking}
          onDelete={removeBooking}
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
    </>
  );
}

