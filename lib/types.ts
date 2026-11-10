// Shared between the server and the browser: no Node imports here.

export type Urgency = 0 | 1 | 2 | 3;

export const URGENCIES: { value: Urgency; label: string; short: string }[] = [
  { value: 0, label: "Low", short: "Low" },
  { value: 1, label: "Normal", short: "Normal" },
  { value: 2, label: "High", short: "High" },
  { value: 3, label: "Critical", short: "Critical" },
];

export type RepeatUnit = "none" | "day" | "week" | "month" | "year";

export const REPEATS: { value: RepeatUnit; label: string; noun: string }[] = [
  { value: "none", label: "Doesn't repeat", noun: "" },
  { value: "day", label: "Daily", noun: "day" },
  { value: "week", label: "Weekly", noun: "week" },
  { value: "month", label: "Monthly", noun: "month" },
  { value: "year", label: "Yearly", noun: "year" },
];

/** Built-in categories. Any other text is a custom category, shown as typed. */
export const CATEGORIES: { id: string; label: string; color: string }[] = [
  { id: "work", label: "Work", color: "#4f6bed" },
  { id: "trip", label: "Trips", color: "#0f9d8a" },
  { id: "subscription", label: "Subscriptions", color: "#9b59d0" },
  { id: "payment", label: "Payments", color: "#d9822b" },
  { id: "personal", label: "Personal", color: "#d0558b" },
  { id: "home", label: "Home", color: "#6b8e23" },
  { id: "health", label: "Health", color: "#d64545" },
];

const CUSTOM_COLORS = ["#5b7c99", "#a0785a", "#7a6fb3", "#3d9970", "#b5651d", "#8e7cc3"];

export function categoryInfo(id: string): { id: string; label: string; color: string } {
  const known = CATEGORIES.find((c) => c.id === id);
  if (known) return known;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const label = id ? id[0].toUpperCase() + id.slice(1) : "Other";
  return { id, label, color: CUSTOM_COLORS[h % CUSTOM_COLORS.length] };
}

/** Reminder offsets, in minutes before the due time. */
export const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "When due" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 10080, label: "1 week before" },
];

export function defaultReminders(category: string): number[] {
  if (category === "payment") return [4320, 1440, 0];
  if (category === "subscription") return [4320, 0];
  if (category === "trip") return [10080, 1440];
  return [1440, 0];
}

export type Task = {
  id: number;
  title: string;
  notes: string;
  category: string;
  urgency: Urgency;
  /** UTC ISO instant. All-day tasks are stored at 9:00 local on that date. */
  dueAt: string | null;
  allDay: boolean;
  repeat: RepeatUnit;
  repeatEvery: number;
  amount: number | null;
  reminders: number[];
  /** A one-off reminder at a specific moment, independent of the due date. */
  remindAt: string | null;
  tripId: number | null;
  /** For repeating tasks (subscriptions, bills on autopay): roll forward on its own once the date passes. */
  autoRenew: boolean;
  status: "open" | "done";
  completedAt: string | null;
  lastDoneAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Reminders scheduled before this moment are skipped (they were already past when set). */
  remindersFrom: string;
};

export type TaskInput = Partial<
  Pick<
    Task,
    | "title"
    | "notes"
    | "category"
    | "urgency"
    | "dueAt"
    | "allDay"
    | "repeat"
    | "repeatEvery"
    | "amount"
    | "reminders"
    | "remindAt"
    | "tripId"
    | "autoRenew"
  >
>;

/** A trip from travel.jascui.com's read-only feed. */
export type Trip = {
  id: number;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  url: string;
};

export type Settings = {
  timeZone: string;
  /** Local hours; no non-critical notifications from quietStart up to quietEnd. Equal = off. */
  quietStart: number;
  quietEnd: number;
  /** Local hour for the morning summary, or null for none. */
  digestHour: number | null;
  tripAlerts: boolean;
};

export type SentNotification = {
  id: number;
  title: string;
  body: string;
  url: string;
  sentAt: string;
};

// ---- gift cards ----

/** A trip's packing list (named here; not tied to the travel app's trips). */
export type PackingItem = { id: number; listId: number; name: string; packed: boolean };
export type PackingList = { id: number; name: string; createdAt: string; items: PackingItem[] };

export type GiftCard = {
  id: number;
  /** Where it's spent: "Amazon", "Starbucks", "Visa gift card"… */
  store: string;
  balance: number;
  /** What was on it originally, for "spent $X of $Y". */
  initialAmount: number | null;
  /** "YYYY-MM-DD", or null if it doesn't expire. */
  expiresOn: string | null;
  /** Where the card is: "Wallet", "Email from Mom", "Amazon account"… */
  location: string;
  notes: string;
  status: "active" | "used";
  createdAt: string;
  updatedAt: string;
};

export type GiftCardInput = Partial<Pick<GiftCard, "store" | "balance" | "initialAmount" | "expiresOn" | "location" | "notes">>;

/** Days before a gift card expires to send a heads-up. */
export const GIFT_CARD_ALERT_DAYS = [30, 7, 1];

// ---- events ----

export type CalendarEvent = {
  id: number;
  title: string;
  /** UTC ISO instant. All-day events are stored at 9:00 local on that date. */
  startsAt: string;
  /** UTC ISO instant it ends, or null (shown as an hour long). */
  endsAt: string | null;
  allDay: boolean;
  location: string;
  notes: string;
  /** Minutes before the start, like task reminders. */
  reminders: number[];
  createdAt: string;
  updatedAt: string;
  /** Reminders scheduled before this moment are skipped (they were already past when set). */
  remindersFrom: string;
};

export type CalendarEventInput = Partial<Pick<CalendarEvent, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "notes" | "reminders">>;

export const DEFAULT_EVENT_REMINDERS = [1440, 60];

// ---- stay in touch ----

export type Contact = {
  id: number;
  name: string;
  /** Reach out about this often. */
  everyDays: number;
  /** "YYYY-MM-DD" of the last time you reached out, or null if never logged. */
  lastContactOn: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ContactInput = Partial<Pick<Contact, "name" | "everyDays" | "lastContactOn" | "notes">>;

/** One time you reached out. */
export type ContactLog = {
  id: number;
  contactId: number;
  /** "YYYY-MM-DD" */
  on: string;
  note: string;
};

export const CONTACT_FREQUENCIES: { days: number; label: string }[] = [
  { days: 7, label: "Every week" },
  { days: 14, label: "Every 2 weeks" },
  { days: 30, label: "Every month" },
  { days: 60, label: "Every 2 months" },
  { days: 90, label: "Every 3 months" },
  { days: 182, label: "Every 6 months" },
  { days: 365, label: "Every year" },
];

export function frequencyLabel(days: number): string {
  return CONTACT_FREQUENCIES.find((f) => f.days === days)?.label ?? `Every ${days} days`;
}

/** When to reach out next: "YYYY-MM-DD", or null meaning "now" (never logged). */
export function contactDueOn(c: Contact): string | null {
  if (!c.lastContactOn) return null;
  const d = new Date(c.lastContactOn + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + c.everyDays);
  return d.toISOString().slice(0, 10);
}

// ---- trip itineraries (read-only, from each trip's calendar link on travel.jascui.com) ----

export type ItineraryItem = {
  kind: "event" | "flight" | "stay" | "car" | "deadline";
  title: string;
  location: string;
  /** Extra lines: notes, links, flight times as printed on the ticket. */
  details: string[];
  /** "Booked", "Not booked", "Transit", "Booking unnecessary", or "". */
  status: string;
  /** "YYYY-MM-DD" on the trip's clock. */
  date: string;
  /** Hours from midnight on the trip's clock; absent for all-day items. end_hour can pass 24. */
  start_hour?: number;
  end_hour?: number;
};

export type TripItinerary = {
  id: number;
  /** IANA zone the hours are on ("" if the trip has none). */
  time_zone: string;
  url: string;
  items: ItineraryItem[];
  /** Set when the link stopped working (e.g. it was changed on the travel app). */
  error?: string;
};

// ---- tracking: bookings you enter yourself (flights, trains, cars, hotels…) ----

export type BookingKind = "flight" | "train" | "bus" | "car" | "hotel" | "other";

export const BOOKING_KINDS: { value: BookingKind; label: string; name: string; number: string; from: string; to: string; start: string; end: string }[] = [
  { value: "flight", label: "Flight", name: "Airline", number: "Flight number", from: "From (airport)", to: "To (airport)", start: "Departs", end: "Arrives" },
  { value: "train", label: "Train", name: "Train / operator", number: "Train number", from: "From (station)", to: "To (station)", start: "Departs", end: "Arrives" },
  { value: "bus", label: "Bus / ferry", name: "Company", number: "Route or number", from: "From", to: "To", start: "Departs", end: "Arrives" },
  { value: "car", label: "Rental car", name: "Rental company", number: "Car / class", from: "Pick-up location", to: "Drop-off location", start: "Pick up", end: "Drop off" },
  { value: "hotel", label: "Hotel", name: "Hotel / stay", number: "Room", from: "Address", to: "", start: "Check in", end: "Check out" },
  { value: "other", label: "Other", name: "What", number: "Reference", from: "Where", to: "", start: "Starts", end: "Ends" },
];

export function bookingKind(k: string) {
  return BOOKING_KINDS.find((b) => b.value === k) ?? BOOKING_KINDS[BOOKING_KINDS.length - 1];
}

export type Booking = {
  id: number;
  kind: BookingKind;
  /** Airline, train operator, rental company, hotel name… */
  name: string;
  /** Flight or train number, room, reference. */
  number: string;
  from: string;
  to: string;
  /** Local wall-clock date/time as on the ticket: "YYYY-MM-DD" and "HH:MM" (or ""). */
  startDate: string;
  startTime: string;
  endDate: string | null;
  endTime: string;
  confirmation: string;
  /** Last day to cancel for free, "YYYY-MM-DD". */
  cancelBy: string | null;
  /** "booked", or "to_book" (shows under Still to book). */
  status: "booked" | "to_book";
  /** A trip on travel.jascui.com this belongs to. */
  tripId: number | null;
  cost: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type BookingInput = Partial<
  Pick<Booking, "kind" | "name" | "number" | "from" | "to" | "startDate" | "startTime" | "endDate" | "endTime" | "confirmation" | "cancelBy" | "status" | "tripId" | "cost" | "notes">
>;

/** Days before a free-cancellation deadline to send a heads-up. */
export const CANCEL_ALERT_DAYS = [7, 2, 0];
