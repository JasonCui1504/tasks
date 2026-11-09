"use client";

// Pieces every tab and side panel share: how tasks are bucketed by date,
// the task row, and the data + actions the dashboard hands to each view.

import { daysBetween, formatDue, localDateKey, money, relativeDue } from "@/lib/time";
import {
  REPEATS,
  URGENCIES,
  categoryInfo,
  type CalendarEvent,
  type CalendarEventInput,
  type Contact,
  type GiftCard,
  type Task,
  type TaskInput,
  type Trip,
  type TripItinerary,
} from "@/lib/types";

export type Tab = "today" | "tasks" | "calendar" | "events" | "trips" | "people" | "cards";

export type Bucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
};
export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

export function bucketOf(t: Task, now: Date, tz: string): Bucket {
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

export function byDue(a: Task, b: Task) {
  if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (!a.dueAt !== !b.dueAt) return a.dueAt ? -1 : 1;
  return b.urgency - a.urgency || a.id - b.id;
}

export function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Everything a view can read. */
export type Data = {
  tasks: Task[];
  trips: Trip[];
  events: CalendarEvent[];
  cards: GiftCard[];
  contacts: Contact[];
  now: Date;
  tz: string;
  travelConfigured: boolean;
  /** Task categories in display order (built-in, then custom ones in use). */
  categories: string[];
  /** A trip to highlight (from a notification or the urgent box). */
  focusTrip: number | null;
  /** Trip itineraries read from travel.jascui.com through the owner's sign-in there (empty until loaded / connected). */
  itineraries: TripItinerary[];
  /** Whether the tasks app is signed in to travel.jascui.com to read itineraries. */
  travelLink: { connected: boolean; username: string; error?: string };
  /** The day picked on a calendar, "YYYY-MM-DD" — what the Day view shows. */
  selectedDay: string;
};

/** Everything a view can do. Edits open the same sheets wherever they start. */
export type Actions = {
  openTask: (t: Task) => void;
  newTask: (draft?: TaskInput) => void;
  toggleTask: (t: Task) => void;
  /** Add a task straight away (quick-add boxes). */
  addTask: (input: TaskInput) => Promise<void>;
  openEvent: (e: CalendarEvent) => void;
  /** New event, optionally on a given "YYYY-MM-DD", optionally with "HH:MM" start/end. */
  newEvent: (date?: string, times?: { start: string; end?: string; title?: string }) => void;
  /** Save changes to a task or event straight away (e.g. dragged to a new time). */
  updateTask: (t: Task, input: TaskInput) => Promise<void>;
  updateEvent: (e: CalendarEvent, input: CalendarEventInput) => Promise<void>;
  createEvent: (input: CalendarEventInput) => Promise<void>;
  openCard: (c: GiftCard, spend?: boolean) => void;
  newCard: () => void;
  openContact: (c: Contact) => void;
  newContact: () => void;
  logContact: (c: Contact) => void;
  goTab: (tab: Tab, focus?: { trip?: number }) => void;
  /** Pick a day ("YYYY-MM-DD") for every calendar and the Day view. */
  selectDay: (date: string) => void;
  /** Sign in to travel.jascui.com once so trip days show itineraries (throws a readable Error). */
  connectTravel: (username: string, password: string) => Promise<void>;
  disconnectTravel: () => void;
};

export function Stat({ label, value, tone, active, onClick }: { label: string; value: number | string; tone?: string; active?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </>
  );
  return onClick ? (
    <button className={`stat ${active ? "active" : ""} ${tone ?? ""}`} onClick={onClick} aria-pressed={active}>
      {inner}
    </button>
  ) : (
    <div className={`stat static ${tone ?? ""}`}>{inner}</div>
  );
}

export function Chip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
      {color && <span className="dot" style={{ background: color }} />}
      {label}
      {count > 0 && <span className="chip-count">{count}</span>}
    </button>
  );
}

export function TaskRow({
  task: t,
  now,
  tz,
  trip,
  compact,
  hideCategory,
  onToggle,
  onOpen,
}: {
  task: Task;
  now: Date;
  tz: string;
  trip?: Trip;
  compact?: boolean;
  hideCategory?: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const info = categoryInfo(t.category);
  const due = t.dueAt ? new Date(t.dueAt) : null;
  const overdue = t.status === "open" && due && bucketOf(t, now, tz) === "overdue";
  const repeat = REPEATS.find((r) => r.value === t.repeat);
  return (
    <li className={`task u${t.urgency} ${t.status === "done" ? "done" : ""} ${compact ? "compact" : ""}`}>
      <button className="check" onClick={onToggle} aria-label={t.status === "done" ? "Mark as not done" : "Mark as done"}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="task-main" onClick={onOpen}>
        <span className="task-title">{t.title}</span>
        <span className="task-meta">
          {!hideCategory && (
            <span className="cat">
              <span className="dot" style={{ background: info.color }} />
              {info.label}
            </span>
          )}
          {due && (
            <span className={overdue ? "danger" : ""}>
              {t.status === "done" || compact
                ? capitalize(compact ? relativeDue(due, now, tz, t.allDay) : formatDue(due, tz, t.allDay))
                : `${capitalize(relativeDue(due, now, tz, t.allDay))} · ${formatDue(due, tz, t.allDay)}`}
            </span>
          )}
          {t.repeat !== "none" && !compact && (
            <span title={t.autoRenew ? "Renews automatically" : "Repeats"}>
              ↻ {t.repeatEvery > 1 ? `Every ${t.repeatEvery} ${repeat?.noun}s` : repeat?.label}
            </span>
          )}
          {t.amount != null && <span>{money(t.amount)}</span>}
          {trip && !compact && <span>✈ {trip.name}</span>}
          {(t.reminders.length > 0 || t.remindAt) && due && t.status === "open" && !compact && <span className="bell" title="Reminders on">🔔</span>}
        </span>
      </button>
      {t.urgency !== 1 && !compact && <span className={`badge u${t.urgency}`}>{URGENCIES[t.urgency].label}</span>}
      {t.urgency >= 2 && compact && <span className={`udot u${t.urgency}`} title={URGENCIES[t.urgency].label} />}
    </li>
  );
}
