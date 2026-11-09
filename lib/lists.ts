import type { Row } from "@libsql/client";
import { getDb } from "./db";
import type { CalendarEvent, CalendarEventInput, Contact, ContactInput, ContactLog, GiftCard, GiftCardInput } from "./types";

// Gift cards, events and stay-in-touch contacts: the lists beside tasks. Same rules as lib/tasks.ts —
// everything is scoped to its owner, input is cleaned here, and a bad value
// throws a message string the route turns into a 400.

const str = (v: unknown) => (v == null ? null : String(v));
const nowIso = () => new Date().toISOString();

function moneyOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw "Amounts must be zero or more.";
  return Math.round(n * 100) / 100;
}

function dateKeyOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw "That date doesn't look right.";
  return s;
}

// ---- gift cards ----

function rowToCard(r: Row): GiftCard {
  return {
    id: Number(r.id),
    store: String(r.store),
    balance: Number(r.balance) || 0,
    initialAmount: r.initial_amount == null ? null : Number(r.initial_amount),
    expiresOn: str(r.expires_on),
    location: String(r.location ?? ""),
    notes: String(r.notes ?? ""),
    status: String(r.status) === "used" ? "used" : "active",
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function cleanCardInput(body: Record<string, unknown>, partial: boolean): GiftCardInput {
  const out: GiftCardInput = {};
  if ("store" in body || !partial) {
    const store = String(body.store ?? "").trim().slice(0, 120);
    if (!store) throw "Which store is the card for?";
    out.store = store;
  }
  if ("balance" in body || !partial) out.balance = moneyOrNull(body.balance) ?? 0;
  if ("initialAmount" in body) out.initialAmount = moneyOrNull(body.initialAmount);
  if ("expiresOn" in body) out.expiresOn = dateKeyOrNull(body.expiresOn);
  if ("location" in body) out.location = String(body.location ?? "").trim().slice(0, 200);
  if ("notes" in body) out.notes = String(body.notes ?? "").slice(0, 5000);
  return out;
}

const CARD_COLUMNS: Record<keyof GiftCardInput, string> = {
  store: "store",
  balance: "balance",
  initialAmount: "initial_amount",
  expiresOn: "expires_on",
  location: "location",
  notes: "notes",
};

/** Active cards, plus ones used up in the last 90 days. */
export async function listGiftCards(owner: string): Promise<GiftCard[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT * FROM gift_cards WHERE owner = ? AND (status = 'active' OR updated_at >= ?)
          ORDER BY expires_on IS NULL, expires_on, id`,
    args: [owner, new Date(Date.now() - 90 * 86_400_000).toISOString()],
  });
  return rs.rows.map(rowToCard);
}

export async function getGiftCard(owner: string, id: number): Promise<GiftCard | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM gift_cards WHERE owner = ? AND id = ?", args: [owner, id] });
  return rs.rows.length ? rowToCard(rs.rows[0]) : null;
}

export async function createGiftCard(owner: string, input: GiftCardInput): Promise<GiftCard> {
  const db = await getDb();
  // A new card starts at its full value unless told otherwise.
  if (input.initialAmount === undefined) input.initialAmount = input.balance ?? null;
  const keys = Object.keys(input) as (keyof GiftCardInput)[];
  const now = nowIso();
  const rs = await db.execute({
    sql: `INSERT INTO gift_cards (owner, ${keys.map((k) => CARD_COLUMNS[k]).join(", ")}, status, created_at, updated_at)
          VALUES (?, ${keys.map(() => "?").join(", ")}, ?, ?, ?) RETURNING *`,
    args: [owner, ...keys.map((k) => input[k] ?? null), (input.balance ?? 0) > 0 ? "active" : "used", now, now],
  });
  return rowToCard(rs.rows[0]);
}

export async function updateGiftCard(owner: string, id: number, input: GiftCardInput): Promise<GiftCard | null> {
  const keys = Object.keys(input) as (keyof GiftCardInput)[];
  if (!keys.length) return getGiftCard(owner, id);
  const db = await getDb();
  const sets = keys.map((k) => `${CARD_COLUMNS[k]} = ?`);
  // Topping a card back up makes it active again; emptying it puts it away.
  if (input.balance !== undefined) sets.push(`status = '${input.balance! > 0 ? "active" : "used"}'`);
  const rs = await db.execute({
    sql: `UPDATE gift_cards SET ${sets.join(", ")}, updated_at = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [...keys.map((k) => input[k] ?? null), nowIso(), owner, id],
  });
  return rs.rows.length ? rowToCard(rs.rows[0]) : null;
}

/** Take a purchase off the balance. */
export async function spendGiftCard(owner: string, id: number, amount: number): Promise<GiftCard | null> {
  const card = await getGiftCard(owner, id);
  if (!card) return null;
  if (!(amount > 0)) throw "Enter how much you spent.";
  const balance = Math.max(0, Math.round((card.balance - amount) * 100) / 100);
  return updateGiftCard(owner, id, { balance });
}

export async function setGiftCardStatus(owner: string, id: number, status: "active" | "used"): Promise<GiftCard | null> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "UPDATE gift_cards SET status = ?, updated_at = ? WHERE owner = ? AND id = ? RETURNING *",
    args: [status, nowIso(), owner, id],
  });
  return rs.rows.length ? rowToCard(rs.rows[0]) : null;
}

export async function deleteGiftCard(owner: string, id: number): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM gift_cards WHERE owner = ? AND id = ?", args: [owner, id] });
}

// ---- events ----

function rowToEvent(r: Row): CalendarEvent {
  let reminders: number[] = [];
  try {
    reminders = JSON.parse(String(r.reminders));
  } catch {}
  return {
    id: Number(r.id),
    title: String(r.title),
    startsAt: String(r.starts_at),
    allDay: Boolean(Number(r.all_day)),
    location: String(r.location ?? ""),
    notes: String(r.notes ?? ""),
    reminders,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    remindersFrom: String(r.reminders_from),
  };
}

export function cleanEventInput(body: Record<string, unknown>, partial: boolean): CalendarEventInput {
  const out: CalendarEventInput = {};
  if ("title" in body || !partial) {
    const title = String(body.title ?? "").trim().slice(0, 300);
    if (!title) throw "An event needs a name.";
    out.title = title;
  }
  if ("startsAt" in body || !partial) {
    const t = Date.parse(String(body.startsAt ?? ""));
    if (Number.isNaN(t)) throw "An event needs a date.";
    out.startsAt = new Date(t).toISOString();
  }
  if ("allDay" in body) out.allDay = Boolean(body.allDay);
  if ("location" in body) out.location = String(body.location ?? "").trim().slice(0, 300);
  if ("notes" in body) out.notes = String(body.notes ?? "").slice(0, 5000);
  if ("reminders" in body) {
    const list = Array.isArray(body.reminders) ? body.reminders : [];
    out.reminders = [...new Set(list.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 60 * 24 * 60))]
      .map(Math.round)
      .sort((a, b) => b - a);
  }
  return out;
}

const EVENT_COLUMNS: Record<keyof CalendarEventInput, string> = {
  title: "title",
  startsAt: "starts_at",
  allDay: "all_day",
  location: "location",
  notes: "notes",
  reminders: "reminders",
};

function eventValue(k: keyof CalendarEventInput, v: unknown): string | number | null {
  if (v == null) return null;
  if (k === "reminders") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as string | number;
}

/** Upcoming events, plus the last 60 days for the "Past" view. */
export async function listEvents(owner: string): Promise<CalendarEvent[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT * FROM events WHERE owner = ? AND starts_at >= ? ORDER BY starts_at, id",
    args: [owner, new Date(Date.now() - 60 * 86_400_000).toISOString()],
  });
  return rs.rows.map(rowToEvent);
}

export async function getEvent(owner: string, id: number): Promise<CalendarEvent | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM events WHERE owner = ? AND id = ?", args: [owner, id] });
  return rs.rows.length ? rowToEvent(rs.rows[0]) : null;
}

export async function createEvent(owner: string, input: CalendarEventInput): Promise<CalendarEvent> {
  const db = await getDb();
  const keys = Object.keys(input) as (keyof CalendarEventInput)[];
  const now = nowIso();
  const rs = await db.execute({
    sql: `INSERT INTO events (owner, ${keys.map((k) => EVENT_COLUMNS[k]).join(", ")}, reminders_from, created_at, updated_at)
          VALUES (?, ${keys.map(() => "?").join(", ")}, ?, ?, ?) RETURNING *`,
    args: [owner, ...keys.map((k) => eventValue(k, input[k])), now, now, now],
  });
  return rowToEvent(rs.rows[0]);
}

export async function updateEvent(owner: string, id: number, input: CalendarEventInput): Promise<CalendarEvent | null> {
  const keys = Object.keys(input) as (keyof CalendarEventInput)[];
  if (!keys.length) return getEvent(owner, id);
  const db = await getDb();
  const now = nowIso();
  // Moving the event or changing its reminders re-arms them from now on.
  const rearm = keys.some((k) => k === "startsAt" || k === "reminders");
  const sets = keys.map((k) => `${EVENT_COLUMNS[k]} = ?`);
  if (rearm) sets.push("reminders_from = ?");
  const rs = await db.execute({
    sql: `UPDATE events SET ${sets.join(", ")}, updated_at = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [...keys.map((k) => eventValue(k, input[k])), ...(rearm ? [now] : []), now, owner, id],
  });
  return rs.rows.length ? rowToEvent(rs.rows[0]) : null;
}

export async function deleteEvent(owner: string, id: number): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM events WHERE owner = ? AND id = ?", args: [owner, id] });
}

// ---- stay in touch ----

function rowToContact(r: Row): Contact {
  return {
    id: Number(r.id),
    name: String(r.name),
    everyDays: Number(r.every_days) || 30,
    lastContactOn: str(r.last_contact_on),
    notes: String(r.notes ?? ""),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToLog(r: Row): ContactLog {
  return { id: Number(r.id), contactId: Number(r.contact_id), on: String(r.contact_on), note: String(r.note ?? "") };
}

export function cleanContactInput(body: Record<string, unknown>, partial: boolean): ContactInput {
  const out: ContactInput = {};
  if ("name" in body || !partial) {
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) throw "Who do you want to keep in touch with?";
    out.name = name;
  }
  if ("everyDays" in body) {
    const n = Math.round(Number(body.everyDays));
    if (!(n >= 1 && n <= 730)) throw "Pick how often to reach out.";
    out.everyDays = n;
  }
  if ("lastContactOn" in body) out.lastContactOn = dateKeyOrNull(body.lastContactOn);
  if ("notes" in body) out.notes = String(body.notes ?? "").slice(0, 5000);
  return out;
}

const CONTACT_COLUMNS: Record<keyof ContactInput, string> = {
  name: "name",
  everyDays: "every_days",
  lastContactOn: "last_contact_on",
  notes: "notes",
};

export async function listContacts(owner: string): Promise<Contact[]> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM contacts WHERE owner = ? ORDER BY name COLLATE NOCASE, id", args: [owner] });
  return rs.rows.map(rowToContact);
}

export async function getContact(owner: string, id: number): Promise<Contact | null> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM contacts WHERE owner = ? AND id = ?", args: [owner, id] });
  return rs.rows.length ? rowToContact(rs.rows[0]) : null;
}

/** Recent catch-ups for one person (or everyone), newest first. */
export async function listContactLog(owner: string, contactId?: number, limit = 50): Promise<ContactLog[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT * FROM contact_log WHERE owner = ? ${contactId != null ? "AND contact_id = ?" : ""}
          ORDER BY contact_on DESC, id DESC LIMIT ?`,
    args: contactId != null ? [owner, contactId, limit] : [owner, limit],
  });
  return rs.rows.map(rowToLog);
}

export async function createContact(owner: string, input: ContactInput): Promise<Contact> {
  const db = await getDb();
  const keys = Object.keys(input) as (keyof ContactInput)[];
  const now = nowIso();
  const rs = await db.execute({
    sql: `INSERT INTO contacts (owner, ${keys.map((k) => CONTACT_COLUMNS[k]).join(", ")}, created_at, updated_at)
          VALUES (?, ${keys.map(() => "?").join(", ")}, ?, ?) RETURNING *`,
    args: [owner, ...keys.map((k) => input[k] ?? null), now, now],
  });
  const contact = rowToContact(rs.rows[0]);
  // A starting "last reached out" date goes in the history too.
  if (contact.lastContactOn) {
    await db.execute({
      sql: "INSERT INTO contact_log (owner, contact_id, contact_on, note, created_at) VALUES (?, ?, ?, '', ?)",
      args: [owner, contact.id, contact.lastContactOn, now],
    });
  }
  return contact;
}

export async function updateContact(owner: string, id: number, input: ContactInput): Promise<Contact | null> {
  const keys = Object.keys(input) as (keyof ContactInput)[];
  if (!keys.length) return getContact(owner, id);
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE contacts SET ${keys.map((k) => `${CONTACT_COLUMNS[k]} = ?`).join(", ")}, updated_at = ?
          WHERE owner = ? AND id = ? RETURNING *`,
    args: [...keys.map((k) => input[k] ?? null), nowIso(), owner, id],
  });
  return rs.rows.length ? rowToContact(rs.rows[0]) : null;
}

/** Keep last_contact_on equal to the latest logged catch-up. */
async function syncLastContact(owner: string, id: number): Promise<Contact | null> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `UPDATE contacts SET last_contact_on = (SELECT MAX(contact_on) FROM contact_log WHERE owner = ? AND contact_id = ?),
          updated_at = ? WHERE owner = ? AND id = ? RETURNING *`,
    args: [owner, id, nowIso(), owner, id],
  });
  return rs.rows.length ? rowToContact(rs.rows[0]) : null;
}

/** Record that you reached out (on a date, with an optional note). */
export async function logContact(owner: string, id: number, on: unknown, note: unknown): Promise<{ contact: Contact; logId: number } | null> {
  const contact = await getContact(owner, id);
  if (!contact) return null;
  const date = dateKeyOrNull(on);
  if (!date) throw "When did you reach out?";
  const db = await getDb();
  const ins = await db.execute({
    sql: "INSERT INTO contact_log (owner, contact_id, contact_on, note, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [owner, id, date, String(note ?? "").trim().slice(0, 1000), nowIso()],
  });
  const updated = await syncLastContact(owner, id);
  return updated ? { contact: updated, logId: Number(ins.lastInsertRowid) } : null;
}

export async function deleteContactLog(owner: string, id: number, logId: number): Promise<Contact | null> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM contact_log WHERE owner = ? AND contact_id = ? AND id = ?", args: [owner, id, logId] });
  return syncLastContact(owner, id);
}

export async function deleteContact(owner: string, id: number): Promise<void> {
  const db = await getDb();
  await db.batch(
    [
      { sql: "DELETE FROM contact_log WHERE owner = ? AND contact_id = ?", args: [owner, id] },
      { sql: "DELETE FROM contacts WHERE owner = ? AND id = ?", args: [owner, id] },
    ],
    "write",
  );
}
