import { createHmac, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";

// Username + password login, the same scheme as travel.jascui.com. Logins live
// in the database (table task_users, scrypt "salt:hash"), set with
//   node scripts/set-password.mjs <user> [--env .env.prod]
// A user not in the table falls back to TASKS_USERS (JSON of the same hashes).
// Sessions are HMAC-signed with TASKS_SESSION_SECRET and last 180 days, so the
// home-screen app stays signed in.

export const SESSION_COOKIE = "tasks_session";
const MAX_AGE_S = 60 * 60 * 24 * 180;

function envUsers(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(process.env.TASKS_USERS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function storedHash(username: string): Promise<string | null> {
  try {
    const db = await getDb();
    const rs = await db.execute({ sql: "SELECT hash FROM task_users WHERE username = ?", args: [username] });
    if (rs.rows.length) return String(rs.rows[0].hash);
  } catch (err) {
    console.warn("task_users lookup failed; falling back to TASKS_USERS", err);
  }
  return envUsers()[username] ?? null;
}

function secret(): string | null {
  return process.env.TASKS_SESSION_SECRET || null;
}

function sign(payload: string): string {
  return createHmac("sha256", secret() ?? "").update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function configured(): boolean {
  return secret() != null;
}

export async function validateCredentials(username: string, password: string): Promise<boolean> {
  const stored = await storedHash(username);
  if (!stored) {
    console.warn(`Tasks sign-in: no login stored for "${username}"`);
    return false;
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const ok = safeEqualHex(scryptSync(password, salt, 64).toString("hex"), hash);
    if (!ok) console.warn(`Tasks sign-in: wrong password for "${username}"`);
    return ok;
  } catch {
    return false;
  }
}

export function createSession(username: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = `${username}.${exp}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token || !secret()) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = Buffer.from(token.slice(0, dot), "base64url").toString();
  if (!safeEqualHex(token.slice(dot + 1), sign(payload))) return null;
  const sep = payload.lastIndexOf(".");
  const exp = Number(payload.slice(sep + 1));
  if (!exp || exp * 1000 < Date.now()) return null;
  return payload.slice(0, sep) || null;
}

export function sessionCookie(value: string, maxAge = MAX_AGE_S): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

/** The signed-in user for a page or route handler. */
export async function currentUser(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
