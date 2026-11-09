// Set (or change) a login:  node scripts/set-password.mjs <username> [--env .env.prod]
// Writes a scrypt "salt:hash" into the task_users table of the database named by
// TASKS_DATABASE_URL (from --env file or the shell), or the local .data/tasks.db.
// With --print it only prints the hash, for the TASKS_USERS env var instead.
import { createClient } from "@libsql/client";
import { randomBytes, scryptSync } from "crypto";
import { mkdirSync, readFileSync } from "fs";
import { createInterface } from "readline";

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--env");
const envIdx = args.indexOf("--env");
const printOnly = args.includes("--print");
if (!username) {
  console.error("Usage: node scripts/set-password.mjs <username> [--env .env.prod] [--print]");
  process.exit(1);
}
if (envIdx >= 0) {
  for (const line of readFileSync(args[envIdx + 1], "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => (rl.close(), res(a))));
}

const password = process.env.TASKS_PASSWORD || (await ask(`Password for ${username}: `));
if (password.length < 8) {
  console.error("Use at least 8 characters.");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;

if (printOnly) {
  console.log(JSON.stringify({ [username]: hash }));
  process.exit(0);
}

const url = process.env.TASKS_DATABASE_URL || "file:.data/tasks.db";
if (url.startsWith("file:")) mkdirSync(".data", { recursive: true });
const db = createClient({ url, authToken: process.env.TASKS_DATABASE_AUTH_TOKEN || undefined });
await db.execute(`CREATE TABLE IF NOT EXISTS task_users (
  username TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
await db.execute({
  sql: `INSERT INTO task_users (username, hash) VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET hash = excluded.hash, updated_at = datetime('now')`,
  args: [username, hash],
});
console.log(`Saved the login for "${username}" in ${url.startsWith("file:") ? url : "the production database"}.`);
