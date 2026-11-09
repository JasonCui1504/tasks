import { createHash, timingSafeEqual } from "crypto";
import { runNotifications } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends whatever reminders are due. Called every few minutes by the GitHub
// Actions schedule (.github/workflows/notify.yml), or by Vercel Cron, with
// "Authorization: Bearer $CRON_SECRET".
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runNotifications();
  return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
