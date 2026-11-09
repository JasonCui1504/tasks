import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

// Local dev uses a SQLite file (gitignored). Production points
// TASKS_DATABASE_URL at a Turso/libSQL database, since Vercel's filesystem
// doesn't persist.
const DEFAULT_URL = "file:.data/tasks.db";

const SCHEMA = [
  // Logins: scrypt "salt:hash" per username (see lib/auth.ts).
  `CREATE TABLE IF NOT EXISTS task_users (
    username TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'personal',
    urgency INTEGER NOT NULL DEFAULT 1,
    due_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    repeat_unit TEXT NOT NULL DEFAULT 'none',
    repeat_every INTEGER NOT NULL DEFAULT 1,
    amount REAL,
    reminders TEXT NOT NULL DEFAULT '[]',
    remind_at TEXT,
    trip_id INTEGER,
    auto_renew INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    completed_at TEXT,
    last_done_at TEXT,
    -- Reminders scheduled before this moment are never sent (they were already
    -- in the past when the due date or reminders were set).
    reminders_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_owner_status ON tasks(owner, status)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    owner TEXT PRIMARY KEY,
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    quiet_start INTEGER NOT NULL DEFAULT 22,
    quiet_end INTEGER NOT NULL DEFAULT 7,
    digest_hour INTEGER DEFAULT 8,
    trip_alerts INTEGER NOT NULL DEFAULT 1
  )`,
  // Every notification decided on, keyed so each fires once. Doubles as the in-app history.
  `CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    key TEXT NOT NULL,
    task_id INTEGER,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '/',
    sent INTEGER NOT NULL DEFAULT 1,
    sent_at TEXT NOT NULL,
    UNIQUE (owner, key)
  )`,
  `CREATE TABLE IF NOT EXISTS gift_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    store TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    initial_amount REAL,
    expires_on TEXT,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS gift_cards_owner ON gift_cards(owner, status)`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reminders TEXT NOT NULL DEFAULT '[]',
    reminders_from TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_owner_start ON events(owner, starts_at)`,
  // Stay in touch: people to reach out to every so often, and each time you did.
  `CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    every_days INTEGER NOT NULL DEFAULT 30,
    last_contact_on TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS contacts_owner ON contacts(owner)`,
  `CREATE TABLE IF NOT EXISTS contact_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    contact_id INTEGER NOT NULL,
    contact_on TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS contact_log_contact ON contact_log(owner, contact_id, contact_on)`,
];

// Columns added after a table first shipped. Each fails harmlessly once the column exists.
const MIGRATIONS = [`ALTER TABLE gift_cards ADD COLUMN location TEXT NOT NULL DEFAULT ''`];

let clientPromise: Promise<Client> | null = null;

async function init(): Promise<Client> {
  const url = process.env.TASKS_DATABASE_URL || DEFAULT_URL;
  if (url.startsWith("file:")) mkdirSync(dirname(resolve(url.slice(5))), { recursive: true });
  const client = createClient({ url, authToken: process.env.TASKS_DATABASE_AUTH_TOKEN || undefined });
  await client.batch(SCHEMA, "write");
  for (const sql of MIGRATIONS) await client.execute(sql).catch(() => {});
  return client;
}

export function getDb(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = init().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}
