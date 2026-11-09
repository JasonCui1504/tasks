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

export type GiftCard = {
  id: number;
  /** Where it's spent: "Amazon", "Starbucks", "Visa gift card"… */
  store: string;
  balance: number;
  /** What was on it originally, for "spent $X of $Y". */
  initialAmount: number | null;
  /** "YYYY-MM-DD", or null if it doesn't expire. */
  expiresOn: string | null;
  /** Card number / PIN / claim code, free text. */
  code: string;
  notes: string;
  status: "active" | "used";
  createdAt: string;
  updatedAt: string;
};

export type GiftCardInput = Partial<Pick<GiftCard, "store" | "balance" | "initialAmount" | "expiresOn" | "code" | "notes">>;

/** Days before a gift card expires to send a heads-up. */
export const GIFT_CARD_ALERT_DAYS = [30, 7, 1];

// ---- events ----

export type CalendarEvent = {
  id: number;
  title: string;
  /** UTC ISO instant. All-day events are stored at 9:00 local on that date. */
  startsAt: string;
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

export type CalendarEventInput = Partial<Pick<CalendarEvent, "title" | "startsAt" | "allDay" | "location" | "notes" | "reminders">>;

export const DEFAULT_EVENT_REMINDERS = [1440, 60];
