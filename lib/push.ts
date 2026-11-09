import * as webpush from "web-push";
import { getDb } from "./db";

// Web Push with VAPID keys (generate with `npm run vapid`). iPhone delivers
// these only to the app once it's added to the Home Screen (iOS 16.4+).

export type PushPayload = { title: string; body: string; url: string; tag?: string; badge?: number };

let configuredKeys = false;

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function setup(): boolean {
  if (configuredKeys) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://tasks.jascui.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configuredKeys = true;
  return true;
}

export async function saveSubscription(
  owner: string,
  sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
  userAgent: string,
): Promise<boolean> {
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return false;
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO push_subscriptions (endpoint, owner, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, p256dh = excluded.p256dh, auth = excluded.auth,
            user_agent = excluded.user_agent`,
    args: [endpoint, owner, p256dh, auth, userAgent.slice(0, 300)],
  });
  return true;
}

export async function removeSubscription(owner: string, endpoint: string): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: "DELETE FROM push_subscriptions WHERE owner = ? AND endpoint = ?", args: [owner, endpoint] });
}

export async function deviceCount(owner: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner = ?", args: [owner] });
  return Number(rs.rows[0].n);
}

/** Sends to every device the user enabled. Returns how many accepted it. Dead subscriptions are dropped. */
export async function sendToUser(owner: string, payload: PushPayload): Promise<number> {
  if (!setup()) return 0;
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT * FROM push_subscriptions WHERE owner = ?", args: [owner] });
  let delivered = 0;
  await Promise.all(
    rs.rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: String(r.endpoint), keys: { p256dh: String(r.p256dh), auth: String(r.auth) } },
          JSON.stringify(payload),
          { TTL: 12 * 3600, urgency: "high", topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) },
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [String(r.endpoint)] });
        } else {
          console.warn("Push failed", status, (err as Error).message);
        }
      }
    }),
  );
  return delivered;
}
